from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
UI = SRC / "web" / "ui.js"
CSS = SRC / "web" / "live.css"
HTML = SRC / "web" / "live.html"


class CompactCoachUiTests(unittest.TestCase):
    def test_ai_and_user_are_rendered_on_opposite_sides(self):
        ui = UI.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('class="message-row user-row"', ui)
        self.assertIn('class="message-row ai-row"', ui)
        self.assertIn('class="avatar user-avatar"', ui)
        self.assertIn('class="avatar ai-avatar"', ui)
        self.assertIn(".user-row { justify-content: flex-end; }", css)
        self.assertIn(".ai-row { justify-content: flex-start; }", css)

    def test_public_coach_uses_compact_score_entry_and_mode_specific_audio_actions(self):
        ui = UI.read_text(encoding="utf-8")
        self.assertIn('class="coach-card coach-compact"', ui)
        self.assertIn('data-action="replay-user"', ui)
        self.assertIn('data-action="speak-correction"', ui)
        self.assertIn('data-action="speak-problem"', ui)
        self.assertIn('class="score-pill"', ui)
        self.assertNotIn('<span>${escapeHtml(t(\'coach\'))}</span>', ui)

    def test_problem_words_are_highlighted_inside_user_transcript(self):
        ui = UI.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("function highlightProblems(text, pronunciation)", ui)
        self.assertIn("pron-problem", ui)
        self.assertIn("text-decoration-skip-ink: none;", css)
        self.assertIn(".pron-problem.severity-yellow", css)
        self.assertIn(".pron-problem.severity-red", css)

    def test_public_layout_has_sticky_header_safe_dock_and_modal_backdrop(self):
        css = CSS.read_text(encoding="utf-8")
        ui = UI.read_text(encoding="utf-8")
        self.assertIn("position: sticky;", css)
        self.assertIn("scroll-margin-bottom: 160px;", css)
        self.assertIn("body.settings-open::before", css)
        self.assertIn("document.addEventListener('pointerdown'", ui)

    def test_dev_controls_remain_available_but_public_only_controls_are_separate(self):
        html = HTML.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('class="dev-only"', html)
        self.assertIn('class="public-only"', html)
        self.assertIn('body[data-app-mode="dev"]', css)
        self.assertIn('body[data-app-mode="public"]', css)


if __name__ == "__main__":
    unittest.main()
