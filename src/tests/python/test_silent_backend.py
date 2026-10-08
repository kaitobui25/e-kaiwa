from __future__ import annotations

import base64
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from e_kaiwa.access import AccessPolicy
from e_kaiwa.coach import CoachService, StructuredCallResult
from e_kaiwa.server import make_handler
from e_kaiwa.sessions import SessionStore
from e_kaiwa.settings import SettingsStore
from e_kaiwa.silent_transcribe import MAX_PCM_BYTES, MODEL, transcribe_chunk


def request_audio(session_id: str, frames: int = 1600) -> dict:
    return {
        "session_id": session_id,
        "sample_rate": 16000,
        "pcm_b64": base64.b64encode(b"\x11\x00" * frames).decode("ascii"),
    }


class SilentTranscribeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sessions = SessionStore(Path(self.temp.name))
        self.session_id, _ = self.sessions.create(mode="silent", model=MODEL)

    def test_smart_audio_fallback_uses_wav_and_rotates_retryable_keys(self):
        def simulate(url, body, key, **kwargs):
            self.assertIn("gemini-3.5-transcribe:generateContent", url)
            self.assertEqual(body["generationConfig"]["audioTranscriptionConfig"]["mode"], "SMART")
            data = body["contents"][0]["parts"][0]["inlineData"]
            self.assertEqual(data["mimeType"], "audio/wav")
            with wave.open(io.BytesIO(base64.b64decode(data["data"])), "rb") as audio:
                self.assertEqual(audio.getframerate(), 16000)
                self.assertEqual(audio.getnframes(), 1600)
            if key == "failed-key":
                return 429, {}, 0.01, "RESOURCE_EXHAUSTED"
            return 200, {"candidates": [{"content": {"parts": [{"text": "Please finish your homework."}]}}]}, 0.01, ""

        with patch("e_kaiwa.silent_transcribe.post_json", side_effect=simulate) as post:
            result = transcribe_chunk([(1, "failed-key"), (2, "working-key")], self.sessions, request_audio(self.session_id))
        self.assertEqual(post.call_count, 2)
        self.assertEqual(result, {"text": "Please finish your homework.", "model": MODEL})

    def test_rejects_invalid_sessions_and_audio_payloads(self):
        for payload in [
            request_audio("wrong-session-id"),
            {**request_audio(self.session_id), "pcm_b64": "???"},
            {**request_audio(self.session_id), "sample_rate": 48000},
            {**request_audio(self.session_id), "pcm_b64": ""},
            {**request_audio(self.session_id), "pcm_b64": base64.b64encode(bytes(MAX_PCM_BYTES + 2)).decode()},
        ]:
            with self.subTest(payload=list(payload.keys())), self.assertRaises(ValueError):
                transcribe_chunk([(1, "test-key")], self.sessions, payload)

    @contextmanager
    def running_server(self, *, public=False):
        runtime = SimpleNamespace(
            keys=[(1, "key")],
            sessions=self.sessions,
            access=AccessPolicy(mode="public" if public else "dev"),
            coach=SimpleNamespace(run_turn=lambda payload, **kwargs: {"correction": "ok"}),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(runtime))
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_address[1]}"
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)

    def test_real_local_http_routes_support_token_and_smart_fallback(self):
        with (
            patch("e_kaiwa.server.create_ephemeral_token", return_value="fake-transcription-token"),
            patch("e_kaiwa.server.transcribe_chunk", return_value={"text": "Hello.", "model": MODEL}),
            self.running_server() as root,
        ):
            with urllib.request.urlopen(f"{root}/api/silent/session", timeout=3) as response:
                session = json.load(response)
                self.assertEqual(session["model"], "gemini-3.5-transcribe-live")
                self.assertEqual(session["token"], "fake-transcription-token")
                self.assertIsNotNone(self.sessions.get(session["session_id"]))
            request = urllib.request.Request(
                f"{root}/api/silent/transcribe",
                data=json.dumps(request_audio(session["session_id"])).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                self.assertEqual(json.load(response)["text"], "Hello.")

    def test_public_origin_guard_rejects_cross_site_recording_requests(self):
        with self.running_server(public=True) as root:
            request = urllib.request.Request(
                f"{root}/api/silent/transcribe",
                data=json.dumps(request_audio(self.session_id)).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://malicious.example"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(caught.exception.code, 403)

    def test_silent_coach_audio_and_transcript_are_not_persistently_logged(self):
        model_result = StructuredCallResult(
            {"correction": "Did you finish it?", "explanation": "Use the base verb."},
            0.01, "fake-model", 1, [], "",
        )
        audio_result = StructuredCallResult(
            {"overall_score": 80, "problems": []},
            0.01, "fake-model", 1, [], "",
        )
        service = CoachService(
            [(1, "fake-key")], self.sessions,
            SettingsStore(Path(self.temp.name) / "settings.yaml"),
        )
        with (
            patch("e_kaiwa.coach.correction", return_value=model_result),
            patch("e_kaiwa.coach.pronunciation", return_value=audio_result),
        ):
            result = service.run_turn(
                {
                    **request_audio(self.session_id),
                    "turn": 1,
                    "transcript": "Did you finished it?",
                    "target_language": "en",
                    "silent_private": True,
                },
                temporary_audio=True,
            )
        directory = self.sessions.get(self.session_id)
        self.assertEqual(result["correction"], "Did you finish it?")
        self.assertFalse((directory / "conversation.jsonl").exists())
        self.assertFalse((directory / "turn_001_user.wav").exists())
