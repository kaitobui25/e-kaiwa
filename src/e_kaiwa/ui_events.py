from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from threading import Lock

from .config import LOG_ROOT

UI_EVENT_NAMES = frozenset(
    {
        "settings_open",
        "settings_close",
        "update_press_start",
        "update_press_debug",
        "update_press_cancel",
        "update_press_complete",
        "update_request_sent",
        "update_request_response",
        "update_request_failed",
        "maintenance_status_seen",
        "maintenance_pause",
        "maintenance_result",
        "ws_open",
        "ws_setup_complete",
        "ws_error",
        "ws_close",
        "gemini_error",
        "session_resumption_update",
        "go_away",
        "go_away_reconnect_due",
        "reconnect_attempt",
        "reconnect_result",
        "response_timeout",
        "browser_offline",
        "browser_online",
        "ptt_start",
        "ptt_end",
        "session_request_failed",
        "startup_error",
    }
)

_TEXT_FIELDS = {
    "client_id": 80,
    "session_id": 80,
    "target": 48,
    "input": 24,
    "phase": 64,
    "reason": 160,
    "error": 240,
    "state": 48,
    "update_id": 80,
}
_NUMBER_FIELDS = frozenset(
    {
        "elapsed_ms",
        "http_status",
        "progress",
        "pointer_id",
        "expected_pointer_id",
        "active_turn",
        "turn",
        "code",
        "timeout_ms",
        "time_left_ms",
        "reconnect_delay_ms",
    }
)
_BOOL_FIELDS = frozenset(
    {
        "resume_attempted",
        "resume_requested",
        "resumed",
        "resumable",
        "handle_stored",
        "setup_ready",
        "was_ready",
        "socket_ready",
        "ok",
    }
)


def _now() -> datetime:
    return datetime.now().astimezone()


def _short_text(value: object, limit: int) -> str | None:
    text = str(value or "").strip()
    return text[:limit] or None


def _bounded_number(value: object, *, minimum: float = 0, maximum: float = 86_400_000) -> int | None:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(int(minimum), min(int(maximum), number))


def normalize_ui_event(payload: object) -> dict:
    data = payload if isinstance(payload, dict) else {}
    event = _short_text(data.get("event"), 64)
    if event not in UI_EVENT_NAMES:
        raise ValueError("unsupported UI event")

    result: dict[str, object] = {"event": event}
    for field, limit in _TEXT_FIELDS.items():
        value = _short_text(data.get(field), limit)
        if value is not None:
            result[field] = value
    for field in _NUMBER_FIELDS:
        value = _bounded_number(data.get(field))
        if value is not None:
            result[field] = value
    for field in _BOOL_FIELDS:
        value = data.get(field)
        if isinstance(value, bool):
            result[field] = value
    return result


class UiEventLog:
    """Small structured operational UI log, intentionally separate from conversation logs."""

    def __init__(self, root: Path = LOG_ROOT):
        self.root = Path(root)
        self._lock = Lock()

    def write(self, payload: object, *, app_version: str, revision: str) -> Path:
        event = normalize_ui_event(payload)
        now = _now()
        day_dir = self.root / now.strftime("%Y-%m-%d")
        log_path = day_dir / "ui_events.jsonl"
        row = {
            "ts": now.isoformat(timespec="milliseconds"),
            **event,
            "app_version": str(app_version or "")[:32],
            "revision": str(revision or "")[:12],
        }
        with self._lock:
            day_dir.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        return log_path
