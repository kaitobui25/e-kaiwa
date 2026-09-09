from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from e_kaiwa.model_policy import (
    COACH_MODELS,
    coach_attempt_order,
    coach_model_order,
    is_retryable_failure,
)
from e_kaiwa.settings import SettingsStore, default_config


class SettingsStoreTests(unittest.TestCase):
    def test_missing_config_is_created_from_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            store = SettingsStore(path)
            self.assertTrue(path.is_file())
            self.assertEqual(store.snapshot(), default_config())

    def test_partial_update_is_persisted_and_reloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            store = SettingsStore(path)
            store.update({
                "teacher": "Strict",
                "support_language": "ja",
                "ai_playback_rate": 1.1,
                "realtime_conversation_model": "gemini-2.5-flash-native-audio-preview-12-2025",
                "coach_model": "gemini-3.1-flash-lite",
            })

            reloaded = SettingsStore(path)
            data = reloaded.public_payload()
            self.assertEqual(data["settings"]["teacher"], "Strict")
            self.assertEqual(data["settings"]["support_language"], "ja")
            self.assertEqual(data["settings"]["ai_playback_rate"], 1.1)
            self.assertEqual(
                data["models"]["realtime_conversation"],
                "gemini-2.5-flash-native-audio-preview-12-2025",
            )
            self.assertEqual(data["models"]["coach_mode"], "manual")
            self.assertEqual(data["models"]["coach_model"], "gemini-3.1-flash-lite")

    def test_auto_coach_restores_default_model_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            store = SettingsStore(path)
            store.update({"coach_model": "gemini-3.6-flash"})
            data = store.update({"coach_model": "auto"})
            self.assertEqual(data["models"]["coach_mode"], "auto")
            self.assertEqual(data["models"]["coach_model"], "gemini-3.5-flash-lite")

    def test_invalid_update_is_rejected_without_mutating_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            store = SettingsStore(path)
            before = store.snapshot()
            with self.assertRaises(ValueError):
                store.update({"realtime_conversation_model": "not-a-live-model"})
            self.assertEqual(store.snapshot(), before)

    def test_invalid_yaml_field_is_normalized_but_valid_fields_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            raw = default_config()
            raw["settings"]["teacher"] = "Impossible"
            raw["settings"]["support_language"] = "ja"
            path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

            store = SettingsStore(path)
            self.assertEqual(store.snapshot()["settings"]["teacher"], "Normal")
            self.assertEqual(store.snapshot()["settings"]["support_language"], "ja")

    def test_unreadable_yaml_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            path.write_text("settings: [unterminated", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "config.yaml is unreadable"):
                SettingsStore(path)


class ModelPolicyTests(unittest.TestCase):
    def test_auto_rotates_all_keys_before_changing_model(self):
        keys = [(1, "k1"), (2, "k2"), (3, "k3"), (5, "k5")]
        attempts = coach_attempt_order(
            mode="auto",
            selected="gemini-3.5-flash-lite",
            fallbacks=("gemini-3.1-flash-lite", "gemini-3.6-flash"),
            keys=keys,
            turn_no=2,
        )
        self.assertEqual(
            attempts[:4],
            (
                ("gemini-3.5-flash-lite", 2, "k2"),
                ("gemini-3.5-flash-lite", 3, "k3"),
                ("gemini-3.5-flash-lite", 5, "k5"),
                ("gemini-3.5-flash-lite", 1, "k1"),
            ),
        )
        self.assertEqual(attempts[4][0], "gemini-3.1-flash-lite")
        self.assertNotIn(4, [slot for _, slot, _ in attempts])

    def test_manual_mode_never_rotates_model(self):
        self.assertEqual(
            coach_model_order("manual", "gemini-3.6-flash", COACH_MODELS),
            ("gemini-3.6-flash",),
        )

    def test_retryable_failure_classification(self):
        self.assertTrue(is_retryable_failure(429, "RESOURCE_EXHAUSTED"))
        self.assertTrue(is_retryable_failure(503, "UNAVAILABLE"))
        self.assertTrue(is_retryable_failure(0, "timed out"))
        self.assertFalse(is_retryable_failure(400, "INVALID_ARGUMENT"))


if __name__ == "__main__":
    unittest.main()
