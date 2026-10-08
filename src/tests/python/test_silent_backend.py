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
        rows = [json.loads(line) for line in (
            self.sessions.get(self.session_id) / "conversation.jsonl"
        ).read_text(encoding="utf-8").splitlines()]
        self.assertEqual([item["event"] for item in rows], [
            "silent_fallback_started", "silent_fallback_attempt", "silent_fallback_attempt",
            "silent_fallback_result",
        ])
        self.assertEqual(rows[1]["http_status"], 429)
        self.assertEqual(rows[2]["key_slot"], 2)
        self.assertEqual(rows[-1]["text"], "Please finish your homework.")

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

    def test_real_smart_response_uses_audio_transcription_part_not_text_part(self):
        response = {"candidates": [{"content": {"parts": [
            {"audioTranscription": {"text": "Hello, I am learning English."}}
        ]}}]}
        with patch("e_kaiwa.silent_transcribe.post_json", return_value=(200, response, 0.1, "")) as post:
            result = transcribe_chunk([(1, "test-key")], self.sessions, request_audio(self.session_id))
        self.assertEqual(result["text"], "Hello, I am learning English.")
        self.assertEqual(post.call_count, 1)

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
            request = urllib.request.Request(
                f"{root}/api/silent/log",
                data=json.dumps({"session_id": self.session_id, "event": "silent_start",
                                 "sequence": 1}).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://malicious.example"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(caught.exception.code, 403)

    def test_silent_coach_audio_is_temporary_but_transcript_and_models_are_logged(self):
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
        rows = [json.loads(line) for line in (directory / "conversation.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(rows[-1]["event"], "silent_coach")
        self.assertEqual(rows[-1]["user_text"], "Did you finished it?")
        self.assertEqual(rows[-1]["correction"], "Did you finish it?")
        self.assertEqual(rows[-1]["correction_effective_model"], "fake-model")
        self.assertEqual(rows[-1]["pronunciation"]["result"]["overall_score"], 80)
        self.assertFalse((directory / "turn_001_user.wav").exists())

    def test_browser_log_endpoint_stays_in_silent_session_and_rejects_secrets(self):
        from e_kaiwa.silent_logging import write_silent_event

        write_silent_event(self.sessions, {
            "session_id": self.session_id, "event": "silent_coach_result", "sequence": 1,
            "details": {
                "turn": 3, "text": "Did you finished?",
                "correction": "Did you finish?",
                "model": "test-model",
                "api_key": "DO-NOT-LOG", "token": "DO-NOT-LOG",
                "pcm_b64": "DO-NOT-LOG",
                "detail": {"apiKey": "DO-NOT-LOG", "latency": 1.3},
            },
        })
        path = self.sessions.get(self.session_id) / "conversation.jsonl"
        raw = path.read_text(encoding="utf-8")
        self.assertNotIn("DO-NOT-LOG", raw)
        row = json.loads(raw.splitlines()[0])
        self.assertEqual(row["sequence"], 1)
        self.assertEqual(row["turn"], 3)
        self.assertEqual(row["text"], "Did you finished?")
        self.assertNotIn("apiKey", row["detail"])

        invalid = [
            {"event": "silent_coach_result", "sequence": 2, "session_id": "not-a-session"},
            {"event": "arbitrary_injected_event", "sequence": 2, "session_id": self.session_id},
            {"event": "silent_coach_result", "sequence": 2, "session_id": self.session_id,
             "details": {"sequence": 4}},
        ]
        with self.assertRaises(ValueError):
            write_silent_event(self.sessions, invalid[0])
        with self.assertRaises(ValueError):
            write_silent_event(self.sessions, invalid[1])
        # Additional sequence values in details cannot overwrite authoritative sequence.
        write_silent_event(self.sessions, invalid[2])
        self.assertEqual(json.loads(path.read_text(encoding="utf-8").splitlines()[-1])["sequence"], 2)

    def test_session_reconnect_keeps_same_folder_and_http_events_are_logged(self):
        with (
            patch("e_kaiwa.server.create_ephemeral_token", return_value="fake-transcription-token"),
            self.running_server(public=True) as root,
        ):
            def get_session(path):
                with urllib.request.urlopen(f"{root}{path}", timeout=3) as resp:
                    return json.load(resp)
            first = get_session("/api/silent/session")
            second = get_session(f"/api/silent/session?session_id={first['session_id']}")
            self.assertEqual(first["session_id"], second["session_id"])
            request = urllib.request.Request(
                f"{root}/api/silent/log",
                data=json.dumps({
                    "session_id": first["session_id"],
                    "event": "silent_stop", "sequence": 4,
                    "details": {"captured": 10, "failed": 1, "fallback": True},
                }).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                self.assertTrue(json.load(response)["ok"])
            rows = [json.loads(line) for line in (
                self.sessions.get(first["session_id"]) / "conversation.jsonl"
            ).read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rows[0]["event"], "silent_session_created")
            self.assertEqual(rows[-1]["event"], "silent_stop")
            self.assertEqual(rows[-1]["captured"], 10)
            self.assertIn("silent_token_requested", [row["event"] for row in rows])
