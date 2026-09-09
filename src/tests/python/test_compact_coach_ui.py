from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
JS = SRC / "web" / "live.js"
CSS = SRC / "web" / "live.css"


class CompactCoachUiTests(unittest.TestCase):
    def test_pronunciation_uses_score_only_circle_after_coach(self):
        js = JS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")

        self.assertIn("result.overall_score ?? result.pronunciation_score", js)
        self.assertIn('class="pron-score has-tooltip"', js)
        self.assertIn('aria-label="Pronunciation score ${overall}"', js)
        self.assertNotIn('<span>Pronunciation <span class="pron-score', js)
        self.assertIn("Pronunciation ${score(result.pronunciation_score)} · Fluency ${score(result.fluency_score)} · Intonation ${score(result.intonation_score)}", js)
        self.assertIn("${scoreHtml}", js)

        self.assertIn(".pron-score", css)
        self.assertIn("border-radius: 50%;", css)
        self.assertIn("background: rgba(242, 204, 96, 0.14);", css)

    def test_coach_details_and_runtime_are_hover_only(self):
        js = JS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")

        self.assertIn("function coachDetailsHtml(turn)", js)
        self.assertIn('coach-trigger has-tooltip', js)
        self.assertIn('class="tooltip coach-tooltip"', js)
        self.assertIn('class="coach-runtime"', js)
        self.assertIn("toFixed(2)}s</div>", js)
        self.assertNotIn('<div class="coach">${coach}</div>', js)

        self.assertIn(".coach-summary", css)
        self.assertIn(".coach-tooltip", css)
        self.assertIn(".coach-runtime", css)
        self.assertIn("top: calc(100% + 8px);", css)

    def test_problem_words_are_highlighted_inside_user_transcript(self):
        js = JS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")

        self.assertIn("function highlightPronunciationProblems(text, result)", js)
        self.assertIn("const userHtml = pronunciation", js)
        self.assertIn('<div class="who who-you">You</div><div class="text">${userHtml}</div>', js)
        self.assertNotIn('class="pron-problems"', js)

        self.assertIn("problem?.severity === 'red' ? 'red' : 'yellow'", js)
        self.assertIn("pron-problem severity-${severity}", js)
        self.assertIn("text-decoration-skip-ink: none;", css)
        self.assertIn(".pron-problem.severity-yellow", css)
        self.assertIn(".pron-problem.severity-red", css)
        self.assertIn(".has-tooltip:hover > .tooltip", css)
        self.assertIn(".has-tooltip:focus > .tooltip", css)

    def test_role_labels_have_distinct_classes(self):
        js = JS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        for role in ("you", "ai", "coach"):
            self.assertIn(f"who-{role}", js)
            self.assertIn(f".who-{role}", css)


if __name__ == "__main__":
    unittest.main()
