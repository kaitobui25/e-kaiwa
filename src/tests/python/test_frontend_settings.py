from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
HTML = SRC / "web" / "live.html"
JS = SRC / "web" / "live.js"
AUDIO = SRC / "web" / "audio.js"
PREFERENCES = SRC / "web" / "preferences.js"
SERVER = SRC / "e_kaiwa" / "server.py"


class FrontendSettingsTests(unittest.TestCase):
    def test_ai_speed_options_use_point_one_steps_and_default_to_point_eight(self):
        html = HTML.read_text(encoding="utf-8")
        self.assertIn('id="ai-speed"', html)
        for value in ("0.5", "0.6", "0.7", "0.8", "0.9", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"):
            self.assertIn(f'value="{value}"', html)
        self.assertIn('<option value="0.8" selected>0.8×</option>', html)

    def test_dev_settings_use_server_while_public_preferences_are_local(self):
        js = JS.read_text(encoding="utf-8")
        prefs = PREFERENCES.read_text(encoding="utf-8")
        self.assertIn("fetch('/api/settings', {cache: 'no-store'})", js)
        self.assertIn("method: 'POST'", js)
        self.assertIn("window.localStorage", js)
        self.assertIn("e-kaiwa.app-language", prefs)
        self.assertIn("e-kaiwa.theme", prefs)
        self.assertIn("if (state.appMode === 'public')", js)

    def test_playback_is_owned_by_coordinator(self):
        js = JS.read_text(encoding="utf-8")
        audio = AUDIO.read_text(encoding="utf-8")
        self.assertIn("new PlaybackCoordinator", js)
        self.assertIn("queueLivePcm", audio)
        self.assertIn("playUserPcm", audio)
        self.assertIn("speak(text", audio)
        self.assertIn("this._setBlocked(true, 'live')", audio)
        self.assertIn("this.livePlaybackRemainingMs + this._guardMs()", audio)

    def test_public_language_and_theme_controls_exist(self):
        html = HTML.read_text(encoding="utf-8")
        prefs = PREFERENCES.read_text(encoding="utf-8")
        self.assertIn('id="feedback-language"', html)
        self.assertIn('id="theme"', html)
        self.assertIn("SUPPORTED_APP_LANGUAGES", prefs)
        self.assertIn("SUPPORTED_THEMES", prefs)
        self.assertIn("SUPPORTED_TARGET_LANGUAGES", prefs)
        self.assertIn("TARGET_LANGUAGE = 'en'", prefs)

    def test_dev_model_selectors_still_exist(self):
        html = HTML.read_text(encoding="utf-8")
        js = JS.read_text(encoding="utf-8")
        self.assertIn('id="realtime-model"', html)
        self.assertIn('id="coach-model"', html)
        self.assertIn("choices.realtime_conversation", js)
        self.assertIn("choices.coach", js)
        self.assertIn("realtime_conversation_model", js)
        self.assertIn("coach_model", js)

    def test_public_server_settings_are_read_only_and_sanitized(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn("_client_settings_payload", server)
        self.assertIn('"app_mode": "public"', server)
        self.assertIn('"target_language": "en"', server)
        self.assertIn('"public settings are read-only"', server)
        self.assertIn("runtime.access.is_public", server)


if __name__ == "__main__":
    unittest.main()
