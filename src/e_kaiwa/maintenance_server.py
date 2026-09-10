from __future__ import annotations

from http.server import ThreadingHTTPServer
from typing import Type
from urllib.parse import urlparse

from .access import SlidingWindowLimiter
from .config import DEFAULT_HOST, DEFAULT_PORT, WEB_DIR
from .server import Runtime, _client_settings_payload, build_runtime, parse_args
from .server import make_handler as make_base_handler
from .update_request import create_update_request, updates_enabled
from .version import app_version, git_revision

_UPDATE_LIMITER = SlidingWindowLimiter(3, 3600)


def make_handler(runtime: Runtime) -> Type:
    base_handler = make_base_handler(runtime)
    revision = git_revision()
    version = app_version()
    update_enabled = updates_enabled()

    class MaintenanceRequestHandler(base_handler):
        server_version = f"EKaiwaLive/{version}"

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            static_routes = {
                "/maintenance.js": (WEB_DIR / "maintenance.js", "text/javascript; charset=utf-8"),
                "/ui_maintenance.js": (WEB_DIR / "ui_maintenance.js", "text/javascript; charset=utf-8"),
                "/maintenance_bootstrap.js": (WEB_DIR / "maintenance_bootstrap.js", "text/javascript; charset=utf-8"),
                "/maintenance.css": (WEB_DIR / "maintenance.css", "text/css; charset=utf-8"),
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
            if path != "/api/update":
                super().do_POST()
                return

            if not update_enabled:
                self.send_json(503, {"error": "self-update is not enabled on this host"})
                return
            if runtime.access.is_public:
                if not runtime.access.origin_allowed(self.headers):
                    self.send_json(403, {"error": "origin not allowed"})
                    return
                if not _UPDATE_LIMITER.allow(self.client_key()):
                    self.send_json(429, {"error": "update rate limit exceeded"})
                    return
            try:
                created = create_update_request()
            except Exception as exc:
                self.send_json(503, {"error": str(exc)[:160]})
                return
            self.send_json(202, {"ok": True, "state": "requested" if created else "already_pending"})

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
