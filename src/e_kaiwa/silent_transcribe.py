"""Bounded, audio-only SMART transcription fallback for Silent Coach."""

from __future__ import annotations

import base64
import io
import wave

from .config import API_BASE
from .gemini import extract_text, post_json
from .model_policy import is_retryable_failure, rotate_keys
from .sessions import SessionStore

MODEL = "gemini-3.5-transcribe"
MAX_PCM_BYTES = 16_000 * 2 * 25  # At most 25 seconds per request.


def transcribe_chunk(keys: list[tuple[int, str]], sessions: SessionStore, payload: dict) -> dict:
    record = sessions.record(payload.get("session_id"))
    if record is None or record.mode != "silent":
        raise ValueError("unknown session_id")
    if payload.get("sample_rate") != 16000:
        raise ValueError("sample_rate must be 16000")
    try:
        pcm = base64.b64decode(payload.get("pcm_b64", ""), validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid PCM data") from exc
    if not pcm or len(pcm) > MAX_PCM_BYTES or len(pcm) % 2:
        raise ValueError("invalid PCM length")

    wav = io.BytesIO()
    with wave.open(wav, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(pcm)

    body = {
        "contents": [{"parts": [{"inlineData": {
            "mimeType": "audio/wav",
            "data": base64.b64encode(wav.getvalue()).decode("ascii"),
        }}]}],
        "generationConfig": {"audioTranscriptionConfig": {"mode": "SMART"}},
    }
    endpoint = f"{API_BASE}/models/{MODEL}:generateContent"
    turn = payload.get("turn")
    turn = turn if type(turn) is int and turn > 0 else None
    sessions.log(record.directory, "silent_fallback_started", turn=turn, model=MODEL,
                 pcm_bytes=len(pcm), sample_rate=16000)
    last_error = "transcription unavailable"
    for slot, key in rotate_keys(keys, turn or 1):
        status, response, duration_s, error = post_json(endpoint, body, key)
        sessions.log(record.directory, "silent_fallback_attempt", turn=turn, model=MODEL,
                     key_slot=slot, http_status=status, latency_s=round(duration_s, 3),
                     error=error[:300] if status != 200 else "")
        if status == 200:
            text = extract_text(response).strip()
            if not text:
                candidates = response.get('candidates') or []
                if candidates:
                    parts = candidates[0].get('content', {}).get('parts', [])
                    text = ''.join(
                        part.get('audioTranscription', {}).get('text', '')
                        for part in parts if isinstance(part, dict)
                        and isinstance(part.get('audioTranscription'), dict)
                    ).strip()
            if text:
                sessions.log(record.directory, "silent_fallback_result", turn=turn, model=MODEL,
                             text=text[:4000], source="fallback")
                return {"text": text[:4000], "model": MODEL}
            last_error = "empty transcription"
            continue
        last_error = f"transcription HTTP {status or 'network'}"
        if not is_retryable_failure(status, error):
            break
    sessions.log(record.directory, "silent_fallback_error", turn=turn, model=MODEL,
                 error=last_error)
    raise RuntimeError(last_error)
