from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[3] / "deploy" / "updater" / "update_status.py"
SPEC = importlib.util.spec_from_file_location("ekaiwa_update_status_test", MODULE_PATH)
assert SPEC and SPEC.loader
UPDATE_STATUS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATE_STATUS)


class UpdaterJournalTests(unittest.TestCase):
    def test_journal_is_append_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "updater.jsonl"
            writer = UPDATE_STATUS.JournalWriter(path)
            writer.write({"event": "state", "state": "testing", "progress": 45})
            writer.write({"event": "check_result", "check": "Python tests", "ok": True})

            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["state"], "testing")
            self.assertEqual(rows[1]["event"], "check_result")
            self.assertTrue(rows[1]["ok"])


if __name__ == "__main__":
    unittest.main()
