from __future__ import annotations

import json
import re
import secrets
import time
import wave
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock

from .config import LOG_ROOT

_SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{20,120}\Z")
DEFAULT_SESSION_TTL_S = 60 * 60


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def valid_session_id(session_id: object) -> bool:
    return bool(_SESSION_ID_RE.fullmatch(str(session_id or "")))


def save_pcm_wav(raw_pcm: bytes, path: Path, sample_rate: int = 16000) -> None:
    if not raw_pcm:
        raise ValueError("empty PCM audio")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(raw_pcm)


@dataclass(frozen=True)
class SessionRecord:
    directory: Path
    expires_at: float


class SessionStore:
    def __init__(self, root: Path = LOG_ROOT, *, ttl_s: int = DEFAULT_SESSION_TTL_S):
        self.root = Path(root)
        self.ttl_s = max(60, int(ttl_s))
        self._sessions: dict[str, SessionRecord] = {}
        self._registry_lock = Lock()
        self._log_lock = Lock()

    def _prune_locked(self, now: float) -> None:
        expired = [session_id for session_id, record in self._sessions.items() if record.expires_at <= now]
        for session_id in expired:
            self._sessions.pop(session_id, None)

    def create(self, *, mode: str, model: str) -> tuple[str, Path]:
        now_wall = datetime.now().astimezone()
        now_mono = time.monotonic()
        day_dir = self.root / now_wall.strftime("%Y-%m-%d")
        base = f"{now_wall:%Y%m%d_%H%M%S}_{mode}"

        with self._registry_lock:
            self._prune_locked(now_mono)
            session_dir = day_dir / base
            suffix = 2
            while session_dir.exists():
                session_dir = day_dir / f"{base}_{suffix}"
                suffix += 1
            session_dir.mkdir(parents=True, exist_ok=False)

            public_id = secrets.token_urlsafe(24)
            while public_id in self._sessions:
                public_id = secrets.token_urlsafe(24)
            self._sessions[public_id] = SessionRecord(
                directory=session_dir,
                expires_at=now_mono + self.ttl_s,
            )

        self.log(session_dir, "session_start", mode=mode, model=model)
        return public_id, session_dir

    def get(self, session_id: object) -> Path | None:
        value = str(session_id or "")
        if not valid_session_id(value):
            return None
        now = time.monotonic()
        with self._registry_lock:
            self._prune_locked(now)
            record = self._sessions.get(value)
            return record.directory if record is not None else None

    def active_count(self) -> int:
        now = time.monotonic()
        with self._registry_lock:
            self._prune_locked(now)
            return len(self._sessions)

    def log(self, session_dir: Path, event: str, **data: object) -> None:
        row = {"ts": now_iso(), "event": event, **data}
        log_path = Path(session_dir) / "conversation.jsonl"
        with self._log_lock:
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
