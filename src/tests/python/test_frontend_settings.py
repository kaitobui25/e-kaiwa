from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
HTML = SRC / "web" / "live.html"
JS = SRC / "web" / "live.js"


class FrontendSettingsTests(unittest.TestCase):
    def test_ai_speed_options_use_point_one_steps_and_default_to_point_eight(self):
        html = HTML.read_text(encoding="utf-8")
        self.assertIn('id="ai-speed"', html)
        for value in ("0.5", "0.6", "0.7", "0.8", "0.9", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"):
            self.assertIn(f'value="{value}"', html)
        self.assertIn('<option value="0.8" selected>0.8×</option>', html)

    def test_ai_speed_is_persisted_and_applied_to_playback_queue(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("const DEFAULT_AI_SPEED = '0.8';", js)
        self.assertIn("localStorage.getItem('aiPlaybackRate')", js)
        self.assertIn("localStorage.setItem('aiPlaybackRate', value)", js)
        self.assertIn("source.playbackRate.value = rate;", js)
        self.assertIn("state.playAt += buffer.duration / rate;", js)


if __name__ == "__main__":
    unittest.main()
