from __future__ import annotations

import json
import re
import wave
from datetime import datetime
from pathlib import Path
from threading import Lock

from .config import LOG_ROOT

_SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")


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


class SessionStore:
    def __init__(self, root: Path = LOG_ROOT):
        self.root = Path(root)
        self._sessions: dict[str, Path] = {}
        self._registry_lock = Lock()
        self._log_lock = Lock()

    def create(self, *, mode: str, model: str) -> tuple[str, Path]:
        now = datetime.now().astimezone()
        day_dir = self.root / now.strftime("%Y-%m-%d")
        base = f"{now:%Y%m%d_%H%M%S}_{mode}"
        session_dir = day_dir / base
        suffix = 2
        while session_dir.exists():
            session_dir = day_dir / f"{base}_{suffix}"
            suffix += 1

        session_dir.mkdir(parents=True, exist_ok=False)
        session_id = session_dir.name
        with self._registry_lock:
            self._sessions[session_id] = session_dir
        self.log(session_dir, "session_start", mode=mode, model=model)
        return session_id, session_dir

    def get(self, session_id: object) -> Path | None:
        value = str(session_id or "")
        if not valid_session_id(value):
            return None
        with self._registry_lock:
            return self._sessions.get(value)

    def log(self, session_dir: Path, event: str, **data: object) -> None:
        row = {"ts": now_iso(), "event": event, **data}
        log_path = Path(session_dir) / "conversation.jsonl"
        with self._log_lock:
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
