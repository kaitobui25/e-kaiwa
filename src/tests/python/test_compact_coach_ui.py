from __future__ import annotations

import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[2]
WEB = SRC / "web"
UI = WEB / "ui" / "controller.js"
RENDER = WEB / "ui" / "render.js"
OVERLAY = WEB / "ui" / "overlay.js"
ICONS = WEB / "ui" / "icons.js"
LIVE = WEB / "live" / "main.js"
RECOVERY = WEB / "live" / "recovery.js"
CSS = WEB / "ui" / "base.css"
PUBLIC_CSS = WEB / "ui" / "public.css"
HTML = WEB / "live.html"
SERVER = SRC / "e_kaiwa" / "server.py"
MAINTENANCE_SERVER = SRC / "e_kaiwa" / "maintenance_server.py"


class ReferenceUiTests(unittest.TestCase):
    def test_plan06_ui_is_split_by_clear_responsibility(self):
        ui = UI.read_text(encoding="utf-8")
        render = RENDER.read_text(encoding="utf-8")
        overlay = OVERLAY.read_text(encoding="utf-8")
        icons = ICONS.read_text(encoding="utf-8")
        self.assertIn("from './render.js'", ui)
        self.assertIn("from './overlay.js'", ui)
        self.assertIn("from './icons.js'", ui)
        self.assertIn("export function publicTurnHtml", render)
        self.assertIn("export class UiOverlayController", overlay)
        self.assertIn("export function icon", icons)
        self.assertNotIn("generativelanguage.googleapis.com", render)
        self.assertNotIn("generativelanguage.googleapis.com", overlay)

    def test_server_serves_every_plan06_browser_module(self):
        server = SERVER.read_text(encoding="utf-8")
        for module in ("controller.js", "icons.js", "render.js", "overlay.js"):
            self.assertIn(f'"/ui/{module}"', server)
            self.assertIn(f'WEB_DIR / "ui/{module}"', server)

    def test_live_recovery_module_is_wired_through_production_server(self):
        live = LIVE.read_text(encoding="utf-8")
        recovery = RECOVERY.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn("from './recovery.js'", live)
        self.assertIn("export class LiveRecoveryCoordinator", recovery)
        self.assertIn('"/live/recovery.js"', server)
        self.assertIn('WEB_DIR / "live/recovery.js"', server)
        self.assertIn("sessionResumption: resumptionConfig", live)
        self.assertIn("contextWindowCompression: {slidingWindow: {}}", live)
        self.assertIn("socket.__ekaiwaSetupComplete = true", live)

    def test_public_visual_layer_is_linked_and_served(self):
        html = HTML.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")
        public_css = PUBLIC_CSS.read_text(encoding="utf-8")
        self.assertIn('href="/ui/public.css"', html)
        self.assertIn('"/ui/public.css"', server)
        self.assertIn('WEB_DIR / "ui/public.css"', server)
        self.assertIn('body[data-app-mode="public"]', public_css)

    def test_conversation_keeps_ai_left_user_right_and_score_only_action(self):
        render = RENDER.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('class="message-row user-row"', render)
        self.assertIn('class="message-row ai-row"', render)
        self.assertNotIn('data-ui-action="open-replay"', render)
        self.assertIn('data-ui-action="open-coach"', render)
        self.assertIn('class="avatar user-avatar"', render)
        self.assertIn('class="avatar ai-avatar"', render)
        self.assertIn(".user-row { justify-content: flex-end; }", css)
        self.assertIn(".ai-row { justify-content: flex-start; }", css)
        self.assertIn("vertical-align: middle;", css)

    def test_reference_shell_has_sticky_header_safe_dock_and_shared_overlay(self):
        html = HTML.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('id="overlay-root"', html)
        self.assertIn('id="overlay-backdrop"', html)
        self.assertIn('id="overlay-dynamic"', html)
        self.assertIn('class="voice-waves', html)
        self.assertIn('id="quick-language"', html)
        self.assertIn('id="quick-speed"', html)
        self.assertNotIn("⚙", html)
        self.assertIn("position: sticky;", css)
        self.assertIn("position: fixed;", css)
        self.assertIn("env(safe-area-inset-top)", css)
        self.assertIn("env(safe-area-inset-bottom)", css)
        self.assertIn("scroll-margin-bottom: 176px;", css)

    def test_visual_system_uses_semantic_tokens_and_local_svg_icons(self):
        css = CSS.read_text(encoding="utf-8")
        html = HTML.read_text(encoding="utf-8")
        for token in (
            "--bg", "--surface", "--surface-soft", "--text", "--text-muted",
            "--primary", "--success", "--warning", "--danger", "--shadow-sm", "--shadow-md"
        ):
            self.assertIn(token, css)
        self.assertIn("body[data-theme=\"dark\"]", css)
        self.assertIn("<svg", html)
        self.assertNotIn("fonts.googleapis.com", html)
        self.assertNotIn("cdnjs.cloudflare.com", html)

    def test_overlay_closes_on_backdrop_escape_and_reuses_one_active_state(self):
        overlay = OVERLAY.read_text(encoding="utf-8")
        self.assertIn("this.backdrop?.addEventListener('click', () => this.close())", overlay)
        self.assertIn("event.key === 'Escape'", overlay)
        self.assertIn("this.state.open(type", overlay)
        self.assertIn("this.state.close()", overlay)
        self.assertIn("openCoach(turn, {resetMetrics", overlay)
        self.assertIn("toggle-coach-metrics", overlay)
        self.assertIn("openCorrection(turn)", overlay)
        self.assertIn("openWord(turn", overlay)
        self.assertIn("openReplay(turn)", overlay)

    def test_public_and_dev_controls_remain_separate(self):
        html = HTML.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('class="dev-only"', html)
        self.assertIn("public-only", html)
        self.assertIn('body[data-app-mode="dev"]', css)
        self.assertIn('body[data-app-mode="public"]', css)
        self.assertIn('id="realtime-model"', html)
        self.assertIn('id="coach-model"', html)
        self.assertIn('body[data-app-mode="public"] .dev-only', css)


if __name__ == "__main__":
    unittest.main()
