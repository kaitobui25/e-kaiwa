"""Per-turn audio capture and 14-day retention tests (no Gemini API calls)."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from e_kaiwa.access import AccessPolicy
from e_kaiwa.recordings import MAX_PCM_BYTES, RETENTION_SECONDS, RecordingStore
from e_kaiwa.server import make_handler
from e_kaiwa.sessions import SessionStore


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sessions = SessionStore(Path(self.temp.name))
        self.recordings = RecordingStore(self.sessions)
        self.session_id, self.directory = self.sessions.create(mode="live", model="mock-live")
        self.pcm = b"\x01\x00" * 1600

    def test_save_one_wav_per_turn_and_retry_does_not_overwrite(self):
        self.sessions.log(self.directory, "live_turn", turn=1, user_text="Hello")
        first = self.recordings.save(self.session_id, 1, self.pcm)
        second = self.recordings.save(self.session_id, 2, self.pcm)
        ai = self.recordings.save(self.session_id, 1, self.pcm, role="ai")
        self.assertEqual(first.name, "turn_001_user.wav")
        self.assertEqual(second.name, "turn_002_user.wav")
        self.assertEqual(ai.name, "turn_001_ai.wav")
        self.assertEqual(self.recordings.save(self.session_id, 1, b"\x02\x00"), first)
        with wave.open(str(first), "rb") as wav:
            self.assertEqual(wav.getframerate(), 16000)
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getnframes(), 1600)
            self.assertEqual(wav.readframes(1600), self.pcm)
        self.assertTrue((self.directory / "conversation.jsonl").exists())
        with wave.open(str(ai), "rb") as wav:
            self.assertEqual(wav.getframerate(), 24000)
            self.assertEqual(wav.getnframes(), 1600)

    def test_rejects_unknown_sessions_and_invalid_pcm(self):
        silent, _ = self.sessions.create(mode="silent", model="mock")
        for session, turn, pcm in [
            ("bad", 1, self.pcm), (silent, 1, self.pcm),
            (self.session_id, 0, self.pcm), (self.session_id, True, self.pcm),
            (self.session_id, 1, b""), (self.session_id, 1, b"x"),
            (self.session_id, 1, b"\0" * (MAX_PCM_BYTES + 2)),
        ]:
            with self.subTest(session=session, turn=turn, size=len(pcm)):
                with self.assertRaises(ValueError):
                    self.recordings.save(session, turn, pcm)
        with self.assertRaises(ValueError):
            self.recordings.save(self.session_id, 1, self.pcm, role="system")

    def test_prunes_only_recordings_older_than_14_days(self):
        expired = self.recordings.save(self.session_id, 1, self.pcm)
        expired_ai = self.recordings.save(self.session_id, 1, self.pcm, role="ai")
        pending = self.directory / "turn_003_ai.pending.wav"
        pending.write_bytes(b"temporary audio")
        recent = self.recordings.save(self.session_id, 2, self.pcm)
        log = self.directory / "conversation.jsonl"
        log.write_text("keep\n", encoding="utf-8")
        other = self.directory / "unrelated.wav"
        other.write_bytes(b"keep")
        now = time.time()
        old_time = now - RETENTION_SECONDS - 10
        os.utime(expired, (old_time, old_time))
        os.utime(expired_ai, (old_time, old_time))
        os.utime(pending, (old_time, old_time))
        os.utime(other, (old_time, old_time))
        self.assertEqual(self.recordings.prune_expired(now=now), 3)
        self.assertFalse(expired.exists())
        self.assertFalse(expired_ai.exists())
        self.assertFalse(pending.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(other.exists())
        self.assertEqual(log.read_text(encoding="utf-8"), "keep\n")

    @contextmanager
    def server(self, *, public: bool = False):
        runtime = SimpleNamespace(
            sessions=self.sessions, recordings=self.recordings,
            access=AccessPolicy(mode="public" if public else "dev"),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(runtime))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def upload(self, root, pcm=None, *, origin=None, turn="1", role="user", sample_rate="16000"):
        headers = {
            "Content-Type": "application/octet-stream",
            "X-Session-ID": self.session_id,
            "X-Turn": turn,
            "X-Sample-Rate": "16000",
            "X-Audio-Role": role,
        }
        headers["X-Sample-Rate"] = sample_rate
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(
            f"{root}/api/recording", data=self.pcm if pcm is None else pcm,
            headers=headers, method="POST",
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_binary_http_upload_and_public_origin_guard(self):
        with self.server(public=True) as root:
            with self.upload(root) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.load(response)["file"], "turn_001_user.wav")
            self.assertEqual((self.directory / "turn_001_user.wav").stat().st_size, len(self.pcm) + 44)
            with self.upload(root, role="ai", sample_rate="24000") as response:
                self.assertEqual(json.load(response)["file"], "turn_001_ai.wav")
            with wave.open(str(self.directory / "turn_001_ai.wav"), "rb") as wav:
                self.assertEqual(wav.getframerate(), 24000)
            with self.assertRaises(urllib.error.HTTPError) as error:
                # Empty body avoids Windows closing unread request bytes with RST.
                self.upload(root, pcm=b"", origin="https://malicious.invalid", turn="2")
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.upload(root, pcm=b"x", turn="2")
            self.assertEqual(error.exception.code, 400)
            self.assertFalse((self.directory / "turn_002_user.wav").exists())
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.upload(root, turn="2", role="ai", sample_rate="16000")
            self.assertEqual(error.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
