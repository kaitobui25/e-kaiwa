"""Validated, bounded Silent Coach diagnostics stored in normal session JSONL."""

from __future__ import annotations

import math
import re

from .sessions import SessionStore

# An explicit event registry avoids arbitrary event/log injection from public clients.
CLIENT_EVENTS = frozenset({
    "silent_mode_enter", "silent_mode_exit", "silent_start", "silent_stop",
    "silent_cancel", "silent_fatal", "silent_mic_error", "silent_mic_ready",
    "silent_connection_attempt", "silent_ws_open", "silent_setup_complete",
    "silent_ws_close", "silent_ws_error", "silent_ws_message_error",
    "silent_network_offline", "silent_network_online",
    "silent_segment_captured", "silent_segment_stored", "silent_storage_error",
    "silent_audio_backpressure", "silent_transcript_final",
    "silent_transcript_unmatched", "silent_segment_matched",
    "silent_fallback_enabled", "silent_rotation",
    "silent_fallback_request", "silent_coach_request", "silent_coach_result",
    "silent_segment_skipped", "silent_segment_error",
    "silent_review_complete", "silent_audio_playback", "silent_audio_playback_error",
})

SAFE_FIELDS = frozenset({
    "turn", "connection", "reason", "status", "phase", "error",
    "model", "source", "code", "was_ready", "retry", "attempt",
    "duration_ms", "elapsed_ms", "audio_ms", "frames", "sample_rate",
    "pcm_bytes", "socket_buffered_bytes", "captured", "analyzed", "pending",
    "fallback", "fallback_model", "text", "language_code",
    "correction", "explanation", "pronunciation", "pronunciation_score",
    "pronunciation_enabled", "teacher", "target_language", "feedback_language",
    "coach_model", "coach_wall_s", "result", "failed", "corrected", "score",
    "summary", "http_status", "queue_depth", "detail", "message",
    "recording", "connected", "processed", "skipped",
})

_SENSITIVE_NAMES = re.compile(r"token|api.?key|secret|password|authorization|pcm_b64|raw_audio|inline_data", re.I)


def _safe_value(value: object, *, depth: int = 0) -> object:
    if depth > 3:
        return None
    if isinstance(value, str):
        return value[:4000] if depth == 0 else value[:600]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return value if abs(value) <= 1_000_000_000_000 else None
    if isinstance(value, float):
        if not math.isfinite(value) or abs(value) > 1e12:
            return None
        return value
    if isinstance(value, list):
        return [_safe_value(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:60]: _safe_value(item, depth=depth + 1)
            for key, item in list(value.items())[:32]
            if not _SENSITIVE_NAMES.search(str(key))
        }
    return None


def write_silent_event(sessions: SessionStore, payload: dict) -> None:
    record = sessions.record(payload.get("session_id"))
    if record is None or record.mode != "silent":
        raise ValueError("unknown Silent Coach session")
    event = payload.get("event")
    if not isinstance(event, str) or event not in CLIENT_EVENTS:
        raise ValueError("invalid Silent Coach event")
    details = payload.get("details", {})
    if not isinstance(details, dict):
        raise ValueError("details must be an object")
    safe = {
        key: _safe_value(value)
        for key, value in details.items()
        if key in SAFE_FIELDS
    }
    seq = payload.get("sequence")
    if type(seq) is not int or not 1 <= seq <= 1_000_000:
        raise ValueError("invalid event sequence")
    sessions.log(
        record.directory, event,
        origin="browser", sequence=seq, **safe,
    )
