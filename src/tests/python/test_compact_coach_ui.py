from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
JS = SRC / "web" / "live.js"
CSS = SRC / "web" / "live.css"


class CompactCoachUiTests(unittest.TestCase):
    def test_pronunciation_uses_one_visible_overall_score(self):
        js = JS.read_text(encoding="utf-8")
        self.assertIn("result.overall_score ?? result.pronunciation_score", js)
        self.assertIn('class="pron-score has-tooltip"', js)
        self.assertIn("Pronunciation ${score(result.pronunciation_score)} · Fluency ${score(result.fluency_score)} · Intonation ${score(result.intonation_score)}", js)

    def test_problem_words_use_severity_underlines_and_tooltips(self):
        js = JS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("problem.severity === 'red' ? 'red' : 'yellow'", js)
        self.assertIn("pron-problem severity-${severity}", js)
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
