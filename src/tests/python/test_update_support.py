from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from deploy.updater.update_checks import CheckResult, run_command, run_js_syntax
from deploy.updater.update_runner import read_version_text
from deploy.updater.update_status import StatusWriter


class UpdateSupportTests(unittest.TestCase):
    def test_version_reader_accepts_short_release_version(self):
        self.assertEqual(read_version_text('__version__ = "0.3"\n'), "0.3")

    def test_status_writer_replaces_with_valid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "status.json"
            writer = StatusWriter(path)
            writer.write({"state": "testing", "progress": 60})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["progress"], 60)
            writer.write({"state": "complete", "progress": 100})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["state"], "complete")

    def test_failed_command_is_a_result_not_an_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_command(
                "failure",
                [sys.executable, "-c", "import sys; sys.exit(7)"],
                cwd=Path(tmp),
            )
            self.assertFalse(result.ok)

    def test_js_syntax_check_recurses_feature_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp)
            live = repo_root / "src" / "web" / "live"
            ui = repo_root / "src" / "web" / "ui"
            live.mkdir(parents=True)
            ui.mkdir(parents=True)
            (live / "main.js").write_text("export const live = true;\n", encoding="utf-8")
            (ui / "controller.js").write_text("export const ui = true;\n", encoding="utf-8")

            checked: list[str] = []

            def fake_run(name, _args, **_kwargs):
                checked.append(name)
                return CheckResult(name, True, "")

            with patch("deploy.updater.update_checks.run_command", side_effect=fake_run):
                result = run_js_syntax(repo_root)

            self.assertTrue(result.ok)
            self.assertEqual(
                checked,
                ["JS syntax live/main.js", "JS syntax ui/controller.js"],
            )

    def test_js_syntax_check_fails_when_no_browser_js_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp)
            (repo_root / "src" / "web").mkdir(parents=True)

            result = run_js_syntax(repo_root)

            self.assertFalse(result.ok)
            self.assertIn("no JavaScript files found", result.summary)


if __name__ == "__main__":
    unittest.main()
