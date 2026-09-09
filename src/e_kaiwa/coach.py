from __future__ import annotations

import base64
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from .config import (
    API_BASE,
    SUPPORTED_SAMPLE_RATES,
    TeacherMode,
    feedback_language_name,
    resolve_teacher,
)
from .gemini import extract_text, parse_json_text, post_json
from .model_policy import coach_attempt_order, is_retryable_failure
from .sessions import SessionStore, save_pcm_wav
from .settings import SettingsStore


@dataclass
class StructuredCallResult:
    value: dict | None
    latency_s: float
    model: str | None
    key_slot: int | None
    attempts: list[dict]
    error: str


def _positive_turn(value: object) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


def _structured_request(
    *,
    keys: list[tuple[int, str]],
    mode: str,
    selected_model: str,
    fallback_models: tuple[str, ...],
    turn_no: int,
    body: dict,
) -> StructuredCallResult:
    attempts: list[dict] = []
    total_latency = 0.0
    parse_failures = 0
    final_error = ""

    for model, key_slot, api_key in coach_attempt_order(
        mode=mode,
        selected=selected_model,
        fallbacks=fallback_models,
        keys=keys,
        turn_no=turn_no,
    ):
        status, payload, latency, error = post_json(
            f"{API_BASE}/models/{model}:generateContent",
            body,
            api_key,
        )
        total_latency += latency
        attempt = {
            "model": model,
            "key_slot": key_slot,
            "status": status,
            "latency_s": round(latency, 3),
        }

        if status != 200:
            final_error = f"HTTP {status or 'network'} - {error}"
            attempt["error"] = final_error[:240]
            attempts.append(attempt)
            if is_retryable_failure(status, error):
                continue
            break

        text = extract_text(payload)
        try:
            value = parse_json_text(text)
        except Exception:
            parse_failures += 1
            final_error = f"invalid JSON: {text[:160]!r}"
            attempt["error"] = final_error
            attempts.append(attempt)
            if parse_failures <= 1:
                continue
            break

        attempts.append(attempt)
        return StructuredCallResult(
            value=value,
            latency_s=total_latency,
            model=model,
            key_slot=key_slot,
            attempts=attempts,
            error="",
        )

    return StructuredCallResult(
        value=None,
        latency_s=total_latency,
        model=None,
        key_slot=None,
        attempts=attempts,
        error=final_error or "all Coach attempts failed",
    )


def correction(
    keys: list[tuple[int, str]],
    user_text: str,
    teacher: TeacherMode,
    feedback_language: object,
    *,
    mode: str,
    selected_model: str,
    fallback_models: tuple[str, ...],
    turn_no: int,
) -> StructuredCallResult:
    lang_code, lang_name = feedback_language_name(feedback_language)
    prompt = f'''You are an English coach.
The learner said: "{user_text}"
Teacher strictness: {teacher.name}
Correction rule: {teacher.correction_rule}

Return ONLY one JSON object with these string fields:
- correction: corrected natural English version according to the correction rule; if no correction is needed, copy it unchanged
- explanation: one very short {lang_name} explanation of the most useful correction; use an empty string if correction is unchanged

Keep the explanation concise and practical.'''
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 140,
            "responseMimeType": "application/json",
        },
    }
    result = _structured_request(
        keys=keys,
        mode=mode,
        selected_model=selected_model,
        fallback_models=fallback_models,
        turn_no=turn_no,
        body=body,
    )
    if result.value is not None:
        result.value = {
            "correction": str(result.value.get("correction", "")).strip() or user_text,
            "explanation": str(result.value.get("explanation", "")).strip(),
            "feedback_language": lang_code,
        }
    return result


def pronunciation(
    keys: list[tuple[int, str]],
    wav_path: Path,
    reference: str,
    teacher: TeacherMode,
    feedback_language: object,
    *,
    mode: str,
    selected_model: str,
    fallback_models: tuple[str, ...],
    turn_no: int,
) -> StructuredCallResult:
    lang_code, lang_name = feedback_language_name(feedback_language)
    prompt = f'''You are an English pronunciation coach.
Teacher mode: {teacher.name}.
Reference sentence: "{reference}"

{teacher.pronunciation_instruction}

Listen to the audio and judge ONLY what is clearly audible. Do not invent accent stereotypes.
Assess pronunciation, word stress, fluency/rhythm, and intonation. Do not judge grammar or meaning.
For pronunciation, compare the actual sounds to natural standard English, not merely whether STT recognized the word.

Return ONLY JSON:
{{"recognized_text":"...","overall_score":0,"pronunciation_score":0,"fluency_score":0,"intonation_score":0,
"problems":[{{"word":"...","severity":"yellow|red","sound":"short issue","heard_like":"...","tip":"short concrete advice in {lang_name}"}}],
"summary":"short coaching note in {lang_name}"}}
Use 0-100 scores. List at most {teacher.max_pronunciation_problems} clearly audible problems. If no clear problem exists, return an empty problems array.'''

    audio_b64 = base64.b64encode(wav_path.read_bytes()).decode("ascii")
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": "audio/wav", "data": audio_b64}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 900,
            "responseMimeType": "application/json",
        },
    }
    result = _structured_request(
        keys=keys,
        mode=mode,
        selected_model=selected_model,
        fallback_models=fallback_models,
        turn_no=turn_no,
        body=body,
    )
    if result.value is not None:
        result.value["feedback_language"] = lang_code
    return result


class CoachService:
    def __init__(
        self,
        keys: list[tuple[int, str]],
        sessions: SessionStore,
        settings: SettingsStore,
    ):
        if not keys:
            raise ValueError("CoachService requires at least one API key")
        self.keys = list(keys)
        self.sessions = sessions
        self.settings = settings

    def run_turn(self, payload: dict) -> dict:
        session_dir = self.sessions.get(payload.get("session_id"))
        if session_dir is None:
            raise ValueError("unknown session_id")

        turn_no = _positive_turn(payload.get("turn"))
        transcript = str(payload.get("transcript", "")).strip()
        if not transcript:
            raise ValueError("empty transcript")
        if len(transcript) > 4000:
            raise ValueError("transcript too long")

        persisted = self.settings.snapshot()["settings"]
        teacher = resolve_teacher(persisted["teacher"])
        feedback_language = persisted["support_language"]
        pronunciation_enabled = bool(persisted["pronunciation_enabled"])
        coach_mode, requested_model, fallback_models = self.settings.coach_policy()

        try:
            sample_rate = int(payload.get("sample_rate", 16000))
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid sample_rate") from exc
        if sample_rate not in SUPPORTED_SAMPLE_RATES:
            raise ValueError(f"unsupported sample_rate: {sample_rate}")

        try:
            raw_pcm = base64.b64decode(str(payload.get("pcm_b64", "")), validate=True)
        except Exception as exc:
            raise ValueError("invalid base64 PCM") from exc
        if not raw_pcm:
            raise ValueError("empty PCM audio")
        if len(raw_pcm) % 2:
            raise ValueError("PCM16 payload must contain an even number of bytes")

        user_wav = session_dir / f"turn_{turn_no:03d}_user.wav"
        save_pcm_wav(raw_pcm, user_wav, sample_rate)
        started = time.perf_counter()

        def correction_job() -> StructuredCallResult:
            return correction(
                self.keys,
                transcript,
                teacher,
                feedback_language,
                mode=coach_mode,
                selected_model=requested_model,
                fallback_models=fallback_models,
                turn_no=turn_no,
            )

        def pronunciation_job() -> StructuredCallResult:
            if not pronunciation_enabled:
                return StructuredCallResult(None, 0.0, None, None, [], "")
            return pronunciation(
                self.keys,
                user_wav,
                transcript,
                teacher,
                feedback_language,
                mode=coach_mode,
                selected_model=requested_model,
                fallback_models=fallback_models,
                turn_no=turn_no,
            )

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="coach") as pool:
            correction_future = pool.submit(correction_job)
            pronunciation_future = pool.submit(pronunciation_job)
            correction_result = correction_future.result()
            pronunciation_result = pronunciation_future.result()

        coach_wall = time.perf_counter() - started
        correction_text = transcript
        explanation = ""
        normalized_language, _ = feedback_language_name(feedback_language)
        if correction_result.value:
            correction_text = correction_result.value.get("correction") or transcript
            explanation = correction_result.value.get("explanation") or ""
            normalized_language = correction_result.value.get("feedback_language") or normalized_language

        pron_value = pronunciation_result.value if pronunciation_enabled else None

        self.sessions.log(
            session_dir,
            "coach",
            turn=turn_no,
            user_audio=user_wav.name,
            user_text=transcript,
            teacher=teacher.name,
            feedback_language=normalized_language,
            coach_model_mode=coach_mode,
            coach_requested_model=requested_model,
            correction=correction_text,
            explanation=explanation,
            correction_effective_model=correction_result.model,
            correction_key_slot=correction_result.key_slot,
            correction_llm={
                "model": correction_result.model,
                "key_slot": correction_result.key_slot,
                "latency_s": round(correction_result.latency_s, 3),
                "attempts": correction_result.attempts,
                "error": correction_result.error,
            },
            pronunciation_effective_model=pronunciation_result.model,
            pronunciation_key_slot=pronunciation_result.key_slot,
            pronunciation={
                "enabled": pronunciation_enabled,
                "model": pronunciation_result.model,
                "key_slot": pronunciation_result.key_slot,
                "latency_s": round(pronunciation_result.latency_s, 3),
                "attempts": pronunciation_result.attempts,
                "error": pronunciation_result.error,
                "result": pron_value,
            },
            coach_wall_s=round(coach_wall, 3),
        )

        return {
            "correction": correction_text,
            "explanation": explanation,
            "feedback_language": normalized_language,
            "pronunciation": pron_value,
            "coach_wall_s": round(coach_wall, 3),
            "coach_model_mode": coach_mode,
            "coach_requested_model": requested_model,
            "correction_effective_model": correction_result.model,
            "pronunciation_effective_model": pronunciation_result.model,
        }
