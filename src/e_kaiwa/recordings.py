"""Bounded, per-turn PCM16 recordings with short server-side retention."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from threading import Lock

from .sessions import SessionStore, save_pcm_wav


SAMPLE_RATES = {"user": 16000, "ai": 24000}
MAX_PCM_BYTES = 3_840_000  # At most two minutes of mono PCM16 per turn.
MAX_SESSION_BYTES = 64 * 1024 * 1024
RETENTION_SECONDS = 14 * 24 * 60 * 60
_NAME = re.compile(r"turn_[0-9]{3,6}_(?:user|ai)(?:\.pending)?\.wav\Z")


class RecordingStore:
    def __init__(self, sessions: SessionStore):
        self.sessions = sessions
        self._lock = Lock()

    def save(self, session_id: str, turn: int, pcm: bytes, *, role: str = "user") -> Path:
        record = self.sessions.record(session_id)
        if record is None or record.mode != "live":
            raise ValueError("invalid Live session")
        if not isinstance(turn, int) or isinstance(turn, bool) or not (1 <= turn <= 999999):
            raise ValueError("invalid turn number")
        if role not in SAMPLE_RATES:
            raise ValueError("invalid recording role")
        if not pcm or len(pcm) % 2 or len(pcm) > MAX_PCM_BYTES:
            raise ValueError("invalid PCM16 recording size")

        target = record.directory / f"turn_{turn:03d}_{role}.wav"
        with self._lock:
            if target.exists():
                return target  # An identical/retried request must not overwrite an existing recording.
            total_bytes = sum(file.stat().st_size for file in record.directory.glob("turn_*.wav"))
            if total_bytes + len(pcm) + 44 > MAX_SESSION_BYTES:
                raise ValueError("recording session storage limit reached")
            # Create the WAV header and payload atomically to avoid partial recordings.
            temporary = target.with_suffix(".pending.wav")
            try:
                save_pcm_wav(pcm, temporary, SAMPLE_RATES[role])
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        return target

    def prune_expired(self, *, now: float | None = None) -> int:
        """Remove only per-turn WAVs; preserve JSONL and unrelated files."""
        cutoff = (time.time() if now is None else now) - RETENTION_SECONDS
        deleted = 0
        with self._lock:
            for path in self.sessions.root.glob("????-??-??/*/turn_*.wav"):
                if not _NAME.fullmatch(path.name) or path.is_symlink():
                    continue
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                        deleted += 1
                except OSError:
                    # Retention is retried hourly; a locked file must not stop the server.
                    continue
        return deleted
