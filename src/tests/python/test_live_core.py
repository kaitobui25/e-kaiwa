from __future__ import annotations

import tempfile
import unittest
import wave
from pathlib import Path

from e_kaiwa.config import load_api_keys, normalize_feedback_language, resolve_teacher
from e_kaiwa.gemini import parse_json_text
from e_kaiwa.sessions import SessionStore, save_pcm_wav, valid_session_id


class ConfigTests(unittest.TestCase):
    def test_load_api_keys_deduplicates_and_skips_dead_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            api_file = Path(tmp) / "api.txt"
            api_file.write_text(
                "# local keys\nkey-1\nkey-2\nkey-2\nkey-3\nkey-4\nkey-5\n",
                encoding="utf-8",
            )
            self.assertEqual(
                load_api_keys(api_file),
                [(1, "key-1"), (2, "key-2"), (3, "key-3"), (5, "key-5")],
            )

    def test_teacher_resolution_has_safe_normal_fallback(self):
        self.assertEqual(resolve_teacher("Strict").key, "3")
        self.assertEqual(resolve_teacher("1").name, "Easy")
        self.assertEqual(resolve_teacher("unknown").name, "Normal")

    def test_feedback_language_is_allowlisted(self):
        self.assertEqual(normalize_feedback_language("ja"), "ja")
        self.assertEqual(normalize_feedback_language("JA"), "ja")
        self.assertEqual(normalize_feedback_language("en"), "vi")
        self.assertEqual(normalize_feedback_language(None), "vi")


class SessionTests(unittest.TestCase):
    def test_session_id_validation_rejects_paths(self):
        self.assertTrue(valid_session_id("20260908_120000_live"))
        self.assertFalse(valid_session_id("../runtime_logs"))
        self.assertFalse(valid_session_id("a/b"))
        self.assertFalse(valid_session_id(""))

    def test_store_creates_log_and_resolves_registered_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SessionStore(Path(tmp))
            session_id, session_dir = store.create(mode="live", model="test-model")
            self.assertEqual(store.get(session_id), session_dir)
            self.assertTrue((session_dir / "conversation.jsonl").is_file())
            self.assertIsNone(store.get("../bad"))

    def test_pcm_writer_creates_mono_pcm16_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / "sample.wav"
            save_pcm_wav(b"\x00\x00" * 160, wav_path, 16000)
            with wave.open(str(wav_path), "rb") as wav_file:
                self.assertEqual(wav_file.getnchannels(), 1)
                self.assertEqual(wav_file.getsampwidth(), 2)
                self.assertEqual(wav_file.getframerate(), 16000)
                self.assertEqual(wav_file.getnframes(), 160)


class GeminiHelperTests(unittest.TestCase):
    def test_parse_json_text_accepts_plain_and_fenced_objects(self):
        self.assertEqual(parse_json_text('{"ok": true}'), {"ok": True})
        self.assertEqual(
            parse_json_text('```json\n{"ok": true}\n```'),
            {"ok": True},
        )


if __name__ == "__main__":
    unittest.main()
