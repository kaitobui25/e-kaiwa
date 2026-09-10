from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
HTML = WEB / "live.html"
CSS = WEB / "public.css"
UI = WEB / "ui.js"
LIVE = WEB / "live.js"


class MobileSettingsUiTests(unittest.TestCase):
    def test_public_settings_follow_expected_order(self):
        html = HTML.read_text(encoding="utf-8")
        controls = [
            'id="target-language"',
            'id="feedback-language"',
            'id="theme"',
            'id="ai-speed"',
            'id="talk-mode"',
            'id="pron"',
            'id="update-button"',
        ]
        positions = [html.index(control) for control in controls]
        self.assertEqual(positions, sorted(positions))

    def test_update_keeps_long_press_logic_but_short_visible_label(self):
        html = HTML.read_text(encoding="utf-8")
        self.assertIn('data-i18n-aria-label="updateHold"', html)
        self.assertIn('data-i18n="updateAction">Update</span>', html)
        self.assertNotIn('data-i18n="updateHoldShort"', html)

    def test_public_settings_body_is_independently_scrollable(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('.settings-scroll {', css)
        self.assertIn('overflow-y: auto;', css)
        self.assertIn('-webkit-overflow-scrolling: touch;', css)
        self.assertIn('flex-direction: row;', css)

    def test_learning_language_has_stronger_hierarchy(self):
        html = HTML.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('setting-control-row-primary', html)
        self.assertIn('.setting-control-row-primary > label', css)
        self.assertIn('.setting-control-row-primary select', css)
        self.assertIn('min-height: 52px;', css)
        self.assertIn('font-size: 16px;', css)

    def test_settings_close_control_is_compact_and_right_aligned(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('grid-template-columns: minmax(0, 1fr) 36px;', css)
        self.assertIn('.settings-head .overlay-icon {', css)
        self.assertIn('width: 36px;', css)
        self.assertIn('justify-self: end;', css)
        self.assertIn('transform: translateY(1px);', css)

    def test_setting_selects_have_comfortable_mobile_height(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('min-height: 48px;', css)
        self.assertIn('padding: 9px 30px 9px 12px;', css)
        self.assertIn('.setting-control-row select option', css)

    def test_ai_speed_keeps_one_decimal_select_values(self):
        html = HTML.read_text(encoding="utf-8")
        live = LIVE.read_text(encoding="utf-8")
        self.assertIn('<option value="1.0">1.0×</option>', html)
        self.assertIn('function aiSpeedValue(value, fallback = DEFAULT_AI_SPEED)', live)
        self.assertIn('Number(normalized).toFixed(1)', live)
        self.assertIn('elements.aiSpeed.value = aiSpeedValue(preferences.playbackRate);', live)
        self.assertIn('const value = aiSpeedValue(elements.aiSpeed.value);', live)
        self.assertNotIn('String(normalizePlaybackRate(elements.aiSpeed.value', live)

    def test_vietnamese_settings_copy_is_compact(self):
        ui = UI.read_text(encoding="utf-8")
        self.assertIn("language: 'Ngôn ngữ'", ui)
        self.assertIn("targetLanguage: 'Ngôn ngữ học'", ui)
        self.assertIn("pronunciation: 'Chấm phát âm'", ui)
        self.assertIn("updateAction: 'Update'", ui)
        self.assertNotIn("language: 'Ngôn ngữ UI & Coach'", ui)
        self.assertNotIn("targetLanguage: 'Ngôn ngữ đang học'", ui)


if __name__ == "__main__":
    unittest.main()
