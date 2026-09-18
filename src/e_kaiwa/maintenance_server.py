from __future__ import annotations

from http.server import ThreadingHTTPServer
from typing import Type
from urllib.parse import urlparse

from .access import SlidingWindowLimiter
from .config import DEFAULT_HOST, DEFAULT_PORT, WEB_DIR
from .server import Runtime, _client_settings_payload, build_runtime, parse_args
from .server import make_handler as make_base_handler
from .ui_events import UiEventLog
from .update_request import (
    UPDATE_API_PATH,
    UPDATE_LINK_PREFIX,
    is_update_link,
    request_update,
    update_link_authorized,
    updates_enabled,
)
from .version import app_version, git_revision

_UPDATE_LIMITER = SlidingWindowLimiter(3, 3600)
_UPDATE_STATUS_PATH = "/maintenance/status.json"


def make_handler(runtime: Runtime) -> Type:
    base_handler = make_base_handler(runtime)
    revision = git_revision()
    version = app_version()
    update_enabled = updates_enabled()
    ui_events = UiEventLog()

    class MaintenanceRequestHandler(base_handler):
        server_version = f"EKaiwaLive/{version}"

        def log_message(self, fmt: str, *args: object) -> None:
            if is_update_link(urlparse(self.path).path):
                print(
                    f'[HTTP] {self.address_string()} - '
                    f'"{self.command} {UPDATE_LINK_PREFIX}<redacted> {self.request_version}"'
                )
                return
            super().log_message(fmt, *args)

        def _allow_ui_event(self) -> bool:
            if not runtime.access.is_public:
                return True
            if not runtime.access.origin_allowed(self.headers):
                self.send_json(403, {"error": "origin not allowed"})
                return False
            if not runtime.access.allow("ui_event", self.client_key()):
                self.send_json(429, {"error": "UI event rate limit exceeded"})
                return False
            return True

        def _write_ui_event(self, payload: object) -> None:
            ui_events.write(payload, app_version=version, revision=revision)

        def _request_update(self, *, require_same_origin: bool) -> str | None:
            if not update_enabled:
                self.send_json(503, {"error": "self-update is not enabled on this host"})
                return None
            if runtime.access.is_public:
                if require_same_origin and not runtime.access.origin_allowed(self.headers):
                    self.send_json(403, {"error": "origin not allowed"})
                    return None
                if not _UPDATE_LIMITER.allow(self.client_key()):
                    self.send_json(429, {"error": "update rate limit exceeded"})
                    return None
            try:
                return request_update()
            except Exception as exc:
                self.send_json(503, {"error": str(exc)[:160]})
                return None

        def _redirect_to_update_status(self) -> None:
            self.send_response(303)
            self.send_header("Location", _UPDATE_STATUS_PATH)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
            self.end_headers()

        def do_GET(self) -> None:
            path = urlparse(self.path).path

            if is_update_link(path):
                if not update_link_authorized(path):
                    self.send_error(404)
                    return
                state = self._request_update(require_same_origin=False)
                if state is not None:
                    self._redirect_to_update_status()
                return

            static_routes = {
                "/maintenance/controller.js": (WEB_DIR / "maintenance/controller.js", "text/javascript; charset=utf-8"),
                "/maintenance/bootstrap.js": (WEB_DIR / "maintenance/bootstrap.js", "text/javascript; charset=utf-8"),
                "/maintenance/overlay.js": (WEB_DIR / "maintenance/overlay.js", "text/javascript; charset=utf-8"),
                "/maintenance/style.css": (WEB_DIR / "maintenance/style.css", "text/css; charset=utf-8"),
            }
            static = static_routes.get(path)
            if static:
                self.send_static(*static)
                return

            if path == "/health":
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "mode": runtime.access.mode,
                        "model": runtime.settings.realtime_model,
                        "version": version,
                        "revision": revision,
                        "update_enabled": update_enabled,
                    },
                )
                return

            if path == "/api/settings":
                payload = _client_settings_payload(runtime)
                payload["app_version"] = version
                payload["revision"] = revision
                payload["update_enabled"] = update_enabled
                self.send_json(200, payload)
                return

            super().do_GET()

        def do_POST(self) -> None:
            path = urlparse(self.path).path

            if path == "/api/ui-event":
                if not self._allow_ui_event():
                    return
                try:
                    self._write_ui_event(self.read_json())
                    self.send_json(200, {"ok": True})
                except Exception as exc:
                    self.send_json(400, {"error": str(exc)[:160]})
                return

            if path != UPDATE_API_PATH:
                super().do_POST()
                return

            state = self._request_update(require_same_origin=True)
            if state is not None:
                self.send_json(202, {"ok": True, "state": state})

    return MaintenanceRequestHandler


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, *, app_mode: str = "dev") -> int:
    runtime = build_runtime(app_mode=app_mode)
    handler = make_handler(runtime)
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True

    print("=" * 72)
    print("E-KAIWA LIVE - Gemini Live audio-to-audio + Coach sidecar")
    print("=" * 72)
    print(f"Version: {app_version()} ({git_revision()})")
    print(f"Mode  : {runtime.access.mode}")
    print(f"Model : {runtime.settings.realtime_model}")
    print(f"Config: {runtime.settings.path}")
    print(f"Local : http://{host}:{port}")
    print("Realtime audio path: browser <-> Gemini Live (direct WebSocket)")
    print("Coach path         : browser -> this server after each turn")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run_server(args.host, args.port, app_mode=args.mode)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}")
        return 2
