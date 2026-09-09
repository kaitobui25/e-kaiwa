from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
HTML = SRC / "web" / "live.html"
JS = SRC / "web" / "live.js"
SERVER = SRC / "e_kaiwa" / "server.py"


class FrontendSettingsTests(unittest.TestCase):
    def test_ai_speed_options_use_point_one_steps_and_default_to_point_eight(self):
        html = HTML.read_text(encoding="utf-8")
        self.assertIn('id="ai-speed"', html)
        for value in ("0.5", "0.6", "0.7", "0.8", "0.9", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"):
            self.assertIn(f'value="{value}"', html)
        self.assertIn('<option value="0.8" selected>0.8×</option>', html)

    def test_settings_are_loaded_and_persisted_through_server_api(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("fetch('/api/settings', {cache: 'no-store'})", js)
        self.assertIn("fetch('/api/settings', {", js)
        self.assertIn("method: 'POST'", js)
        self.assertNotIn("localStorage.getItem", js)
        self.assertNotIn("localStorage.setItem", js)

    def test_ai_speed_is_applied_to_playback_queue(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("const DEFAULT_AI_SPEED = '0.8';", js)
        self.assertIn("source.playbackRate.value = rate;", js)
        self.assertIn("state.playAt += buffer.duration / rate;", js)

    def test_echo_guard_is_loaded_from_runtime_config_and_used_after_playback(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("settings.echo_guard_ms", js)
        self.assertIn("state.echoGuardMs", js)
        self.assertIn("const remainingMs = playbackMs + state.echoGuardMs;", js)
        self.assertNotIn("* 1000 + 100", js)

    def test_ai_playback_pauses_mic_forwarding_and_supports_interruption(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("function pauseInputForAiPlayback()", js)
        self.assertIn("state.inputForwarding = false;", js)
        self.assertIn("state.playbackSources.add(source);", js)
        self.assertIn("if (content.interrupted) clearAiPlayback();", js)
        self.assertIn("mic_audio_settings", js)

    def test_realtime_and_coach_model_selectors_exist(self):
        html = HTML.read_text(encoding="utf-8")
        js = JS.read_text(encoding="utf-8")
        self.assertIn('id="realtime-model"', html)
        self.assertIn('id="coach-model"', html)
        self.assertIn("choices.realtime_conversation", js)
        self.assertIn("choices.coach", js)
        self.assertIn("realtime_conversation_model", js)
        self.assertIn("coach_model", js)

    def test_live_setup_uses_model_returned_by_server(self):
        js = JS.read_text(encoding="utf-8")
        self.assertNotIn("const MODEL =", js)
        self.assertIn("model: `models/${data.model}`", js)
        self.assertIn("data.requested_model", js)
        self.assertIn("data.fallback_model", js)

    def test_server_exposes_settings_api(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('path == "/api/settings"', server)
        self.assertIn("runtime.settings.public_payload()", server)
        self.assertIn("runtime.settings.update(self.read_json())", server)
        self.assertIn('"echo_guard_ms"', server)
        self.assertIn("_mic_audio_settings", server)


if __name__ == "__main__":
    unittest.main()
