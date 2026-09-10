from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from e_kaiwa.ui_events import UiEventLog, normalize_ui_event


class UiEventLoggingTests(unittest.TestCase):
    def test_normalize_accepts_operational_update_events_only(self):
        event = normalize_ui_event(
            {
                "event": "update_press_cancel",
                "client_id": "client-1",
                "target": "update_button",
                "input": "pointer",
                "reason": "pointerup",
                "elapsed_ms": 2134.4,
                "ignored": "not persisted",
            }
        )
        self.assertEqual(event["event"], "update_press_cancel")
        self.assertEqual(event["elapsed_ms"], 2134)
        self.assertNotIn("ignored", event)

        debug = normalize_ui_event(
            {
                "event": "update_press_debug",
                "client_id": "client-1",
                "target": "update_button",
                "phase": "pointercancel_received",
                "pointer_id": 9,
                "expected_pointer_id": 9,
                "elapsed_ms": 1600,
            }
        )
        self.assertEqual(debug["event"], "update_press_debug")
        self.assertEqual(debug["phase"], "pointercancel_received")
        self.assertEqual(debug["pointer_id"], 9)
        self.assertEqual(debug["expected_pointer_id"], 9)
        self.assertEqual(debug["elapsed_ms"], 1600)

        with self.assertRaises(ValueError):
            normalize_ui_event({"event": "arbitrary_click", "target": "anything"})

    def test_ui_log_is_separate_from_conversation_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            logger = UiEventLog(root)
            path = logger.write(
                {
                    "event": "update_press_complete",
                    "client_id": "client-1",
                    "target": "update_button",
                    "input": "pointer",
                    "elapsed_ms": 5004,
                },
                app_version="0.5",
                revision="abcdef1234567890",
            )

            self.assertEqual(path.name, "ui_events.jsonl")
            self.assertFalse((path.parent / "conversation.jsonl").exists())
            row = json.loads(path.read_text(encoding="utf-8").strip())
            self.assertEqual(row["event"], "update_press_complete")
            self.assertEqual(row["elapsed_ms"], 5004)
            self.assertEqual(row["app_version"], "0.5")
            self.assertEqual(row["revision"], "abcdef123456")


if __name__ == "__main__":
    unittest.main()
