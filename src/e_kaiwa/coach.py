from __future__ import annotations

import base64
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import (
    API_BASE,
    COACH_LLM_MODEL,
    PRONUNCIATION_MODELS,
    SUPPORTED_SAMPLE_RATES,
    TeacherMode,
    feedback_language_name,
    resolve_teacher,
)
from .gemini import extract_text, parse_json_text, post_json
from .sessions import SessionStore, save_pcm_wav


def _as_bool(value: object, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() not in {"0", "false", "no", "off", "n"}


def _positive_turn(value: object) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


def correction(
    api_key: str,
    user_text: str,
    teacher: TeacherMode,
    feedback_language: object,
) -> tuple[dict | None, float, str]:
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
    status, payload, latency, error = post_json(
        f"{API_BASE}/models/{COACH_LLM_MODEL}:generateContent",
        body,
        api_key,
    )
    if status != 200:
        return None, latency, f"HTTP {status or 'network'} - {error}"

    text = extract_text(payload)
    try:
        obj = parse_json_text(text)
    except Exception:
        return None, latency, f"invalid JSON: {text[:160]!r}"

    return {
        "correction": str(obj.get("correction", "")).strip() or user_text,
        "explanation": str(obj.get("explanation", "")).strip(),
        "feedback_language": lang_code,
    }, latency, ""


def pronunciation(
    api_key: str,
    wav_path: Path,
    reference: str,
    teacher: TeacherMode,
    feedback_language: object,
) -> tuple[dict | None, float, str | None]:
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

    total_latency = 0.0
    for model in PRONUNCIATION_MODELS:
        status, payload, latency, _ = post_json(
            f"{API_BASE}/models/{model}:generateContent",
            body,
            api_key,
        )
        total_latency += latency
        if status != 200:
            continue
        text = extract_text(payload)
        try:
            result = parse_json_text(text)
        except Exception:
            continue
        result["feedback_language"] = lang_code
        return result, total_latency, model

    return None, total_latency, None


class CoachService:
    def __init__(self, keys: list[tuple[int, str]], sessions: SessionStore):
        if not keys:
            raise ValueError("CoachService requires at least one API key")
        self.keys = list(keys)
        self.sessions = sessions

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

        teacher = resolve_teacher(payload.get("teacher"))
        feedback_language = payload.get("feedback_language", "vi")
        pronunciation_enabled = _as_bool(payload.get("pronunciation_enabled"), True)

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
        key_slot, api_key = self.keys[(turn_no - 1) % len(self.keys)]
        started = time.perf_counter()

        def correction_job():
            return correction(api_key, transcript, teacher, feedback_language)

        def pronunciation_job():
            if not pronunciation_enabled:
                return None, 0.0, None
            return pronunciation(api_key, user_wav, transcript, teacher, feedback_language)

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="coach") as pool:
            correction_future = pool.submit(correction_job)
            pronunciation_future = pool.submit(pronunciation_job)
            turn, llm_latency, llm_error = correction_future.result()
            pron_result, pron_latency, pron_model = pronunciation_future.result()

        coach_wall = time.perf_counter() - started
        correction_text = transcript
        explanation = ""
        normalized_language, _ = feedback_language_name(feedback_language)
        if turn:
            correction_text = turn.get("correction") or transcript
            explanation = turn.get("explanation") or ""
            normalized_language = turn.get("feedback_language") or normalized_language

        self.sessions.log(
            session_dir,
            "coach",
            turn=turn_no,
            user_audio=user_wav.name,
            user_text=transcript,
            teacher=teacher.name,
            feedback_language=normalized_language,
            key_slot=key_slot,
            correction=correction_text,
            explanation=explanation,
            pronunciation={
                "enabled": pronunciation_enabled,
                "model": pron_model,
                "latency_s": round(pron_latency, 3),
                "result": pron_result,
            },
            correction_llm={
                "model": COACH_LLM_MODEL,
                "latency_s": round(llm_latency, 3),
                "error": llm_error,
            },
            coach_wall_s=round(coach_wall, 3),
        )

        return {
            "correction": correction_text,
            "explanation": explanation,
            "feedback_language": normalized_language,
            "pronunciation": pron_result,
            "coach_wall_s": round(coach_wall, 3),
        }
