from __future__ import annotations

import base64
import json
import time
from pathlib import Path


def _lang(code: str) -> tuple[str, str]:
    if str(code).lower() == "ja":
        return "ja", "Japanese"
    return "vi", "Vietnamese"


def correction(full, key: str, user_text: str, teacher_name: str, teacher_rule: str, feedback_language: str):
    lang_code, lang_name = _lang(feedback_language)
    prompt = f'''You are an English coach.
The learner said: "{user_text}"
Teacher strictness: {teacher_name}
Correction rule: {teacher_rule}

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
    status, payload, latency, error = full.test_tts.post_json(
        f"{full.test_tts.API_BASE}/models/{full.LLM_MODEL}:generateContent", body, key
    )
    if status != 200:
        return None, latency, f"HTTP {status or 'network'} - {error}"
    text = full.test_tts.extract_text(payload).strip().strip("`").strip()
    try:
        obj = json.loads(text)
    except Exception:
        return None, latency, f"invalid JSON: {text[:160]!r}"
    return {
        "correction": str(obj.get("correction", "")).strip() or user_text,
        "explanation": str(obj.get("explanation", "")).strip(),
        "feedback_language": lang_code,
    }, latency, ""


def pronunciation(full, key: str, wav: Path, reference: str, teacher_choice: str, feedback_language: str):
    lang_code, lang_name = _lang(feedback_language)
    mode = full.test_pronunciation.STRICTNESS[teacher_choice]
    prompt = f'''You are an English pronunciation coach.
Teacher mode: {mode["name"]}.
Reference sentence: "{reference}"

{mode["instruction"]}

Listen to the audio and judge ONLY what is clearly audible. Do not invent accent stereotypes.
Assess pronunciation, word stress, fluency/rhythm, and intonation. Do not judge grammar or meaning.
For pronunciation, compare the actual sounds to natural standard English, not merely whether STT recognized the word.

Return ONLY JSON:
{{"recognized_text":"...","overall_score":0,"pronunciation_score":0,"fluency_score":0,"intonation_score":0,
"problems":[{{"word":"...","severity":"yellow|red","sound":"short issue","heard_like":"...","tip":"short concrete advice in {lang_name}"}}],
"summary":"short coaching note in {lang_name}"}}
Use 0-100 scores. List at most {mode["max_problems"]} clearly audible problems. If no clear problem exists, return an empty problems array.'''
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": prompt},
            {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav.read_bytes()).decode("ascii")}},
        ]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 900,
            "responseMimeType": "application/json",
        },
    }
    total = 0.0
    for model in full.test_pronunciation.MODELS:
        started = time.perf_counter()
        status, payload, latency, error = full.test_tts.post_json(
            f"{full.test_tts.API_BASE}/models/{model}:generateContent", body, key
        )
        total += latency if latency is not None else time.perf_counter() - started
        if status != 200:
            continue
        text = full.test_tts.extract_text(payload).strip().strip("`").strip()
        try:
            obj = json.loads(text)
        except Exception:
            continue
        obj["feedback_language"] = lang_code
        return obj, total, model
    return None, total, None
