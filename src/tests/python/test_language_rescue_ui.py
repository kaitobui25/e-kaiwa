from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
HTML = SRC / "web" / "live.html"
JS = SRC / "web" / "live.js"
POLICY = SRC / "web" / "language_policy.js"
SERVER = SRC / "e_kaiwa" / "server.py"


class LanguageRescueUiTests(unittest.TestCase):
    def test_language_policy_is_a_separate_browser_module(self):
        html = HTML.read_text(encoding="utf-8")
        js = JS.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")

        self.assertIn('<script type="module" src="/live.js"></script>', html)
        self.assertIn("from './language_policy.js';", js)
        self.assertIn("export const LANGUAGE_POLICY_VERSION", policy)
        self.assertIn('"/language_policy.js"', server)

    def test_live_collects_language_codes_and_gates_coach(self):
        js = JS.read_text(encoding="utf-8")

        self.assertIn("content.inputTranscription?.languageCode", js)
        self.assertIn("content.outputTranscription?.languageCode", js)
        self.assertIn("finalizeLanguageMode(turn);", js)
        self.assertIn("if (isCoachEligible(turn)) runCoach(turn);", js)
        self.assertIn("if (isCoachEligible(turn)) {", js)
        self.assertIn("${coachSection}", js)

    def test_live_setup_uses_selected_support_language_policy(self):
        js = JS.read_text(encoding="utf-8")
        html = HTML.read_text(encoding="utf-8")

        self.assertIn("state.supportLanguage = selectedSupportLanguage(feedbackLanguageEl.value);", js)
        self.assertIn("buildLiveLanguageInstruction(state.supportLanguage)", js)
        self.assertIn("systemInstruction", js)
        self.assertIn("Support / correction language", html)
        self.assertIn("Reconnect to apply to AI rescue", js)

    def test_turn_metrics_include_language_and_coach_debug_state(self):
        js = JS.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")

        for field in (
            "input_language_codes",
            "output_language_codes",
            "language_mode",
            "support_language",
            "language_policy_version",
            "coach_eligible",
            "coach_called",
            "coach_skip_reason",
        ):
            self.assertIn(field, js)
            self.assertIn(field, server)

        self.assertIn("pronunciation_enabled", js)
        self.assertIn("silence_duration_ms", js)
        self.assertIn("ai_playback_rate", js)


if __name__ == "__main__":
    unittest.main()
