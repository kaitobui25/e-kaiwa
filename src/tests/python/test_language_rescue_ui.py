from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
HTML = SRC / "web" / "live.html"
JS = SRC / "web" / "live.js"
POLICY = SRC / "web" / "language_policy.js"
PREFERENCES = SRC / "web" / "preferences.js"
SERVER = SRC / "e_kaiwa" / "server.py"


class LanguageRescueUiTests(unittest.TestCase):
    def test_language_policy_remains_a_separate_browser_module(self):
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

    def test_app_language_controls_live_rescue_and_coach_feedback(self):
        js = JS.read_text(encoding="utf-8")
        prefs = PREFERENCES.read_text(encoding="utf-8")
        self.assertIn("state.supportLanguage = selectedSupportLanguage(elements.feedbackLanguage.value);", js)
        self.assertIn("buildLiveLanguageInstruction(state.supportLanguage, state.targetLanguage)", js)
        self.assertIn("feedback_language: elements.feedbackLanguage.value", js)
        self.assertIn("setAppLanguage", js)
        self.assertIn("SUPPORTED_APP_LANGUAGES", prefs)

    def test_target_language_is_separate_and_supports_all_profiles(self):
        prefs = PREFERENCES.read_text(encoding="utf-8")
        self.assertIn("SUPPORTED_TARGET_LANGUAGES = POLICY_TARGET_LANGUAGES", prefs)
        self.assertIn("TARGET_LANGUAGE = 'en'", prefs)
        self.assertIn("targetSpeechLocale", prefs)
        self.assertIn("e-kaiwa.target-language", prefs)

    def test_target_switch_waits_for_an_active_turn_and_settings_keep_session_target(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("selectedTargetLanguage", js)
        self.assertIn("inputBusy() || state.activeTurn", js)
        self.assertIn("state.selectedTargetLanguage !== state.targetLanguage", js)
        self.assertIn("state.targetLanguage = state.selectedTargetLanguage", js)

    def test_turn_metrics_include_language_and_coach_debug_state(self):
        js = JS.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")
        for field in (
            "input_language_codes",
            "output_language_codes",
            "language_mode",
            "support_language",
            "target_language",
            "language_policy_version",
            "coach_eligible",
            "coach_called",
            "coach_skip_reason",
        ):
            self.assertIn(field, js)
            self.assertIn(field, server)


if __name__ == "__main__":
    unittest.main()
