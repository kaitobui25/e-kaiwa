from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Type
from urllib.parse import parse_qs, urlparse

from .access import AccessPolicy, normalize_app_mode
from .coach import CoachService
from .config import (
    API_FILE,
    CONFIG_FILE,
    DEFAULT_HOST,
    DEFAULT_PORT,
    LOG_ROOT,
    REQUEST_MAX_BYTES,
    WEB_DIR,
    load_api_keys,
    normalize_feedback_language,
)
from .gemini import create_ephemeral_token
from .sessions import SessionStore
from .settings import ALLOWED_SUPPORT_LANGUAGES, SettingsStore


@dataclass
class Runtime:
    keys: list[tuple[int, str]]
    sessions: SessionStore
    settings: SettingsStore
    coach: CoachService
    access: AccessPolicy


def build_runtime(
    *,
    api_file: Path = API_FILE,
    log_root: Path = LOG_ROOT,
    config_file: Path = CONFIG_FILE,
    app_mode: str = "dev",
) -> Runtime:
    keys = load_api_keys(api_file)
    sessions = SessionStore(log_root)
    settings = SettingsStore(config_file)
    access = AccessPolicy.from_environment(app_mode)
    return Runtime(
        keys=keys,
        sessions=sessions,
        settings=settings,
        coach=CoachService(keys, sessions, settings),
        access=access,
    )


def _positive_turn(value: object) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


def _optional_number(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _short_text(value: object, max_length: int = 80) -> str | None:
    text = str(value or "").strip()
    return text[:max_length] or None


def _short_string_list(value: object, *, max_items: int = 8, max_length: int = 32) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value[:max_items]:
        text = str(item or "").strip()
        if text:
            result.append(text[:max_length])
    return result


def _language_mode(value: object) -> str:
    mode = str(value or "").strip()
    return mode if mode in {"english", "non_english", "unknown"} else "unknown"


def _mic_audio_settings(value: object) -> dict:
    data = value if isinstance(value, dict) else {}
    return {
        "echoCancellation": _optional_bool(data.get("echoCancellation")),
        "noiseSuppression": _optional_bool(data.get("noiseSuppression")),
        "autoGainControl": _optional_bool(data.get("autoGainControl")),
    }


def _client_settings_payload(runtime: Runtime) -> dict:
    if not runtime.access.is_public:
        payload = runtime.settings.public_payload()
        payload["app_mode"] = "dev"
        payload["target_language"] = "en"
        return payload

    config = runtime.settings.snapshot()
    settings = config["settings"]
    return {
        "version": config["version"],
        "app_mode": "public",
        "target_language": "en",
        "settings": {
            "support_language": settings["support_language"],
            "pronunciation_enabled": settings["pronunciation_enabled"],
            "silence_duration_ms": settings["silence_duration_ms"],
            "ai_playback_rate": settings["ai_playback_rate"],
            "echo_guard_ms": settings["echo_guard_ms"],
        },
        "choices": {
            "app_language": list(ALLOWED_SUPPORT_LANGUAGES),
            "theme": ["light", "dark"],
        },
    }


def make_handler(runtime: Runtime) -> Type[BaseHTTPRequestHandler]:
    class LiveRequestHandler(BaseHTTPRequestHandler):
        server_version = "EKaiwaLive/0.4"

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"[HTTP] {self.address_string()} - {fmt % args}")

        def send_json(self, status: int, payload: dict) -> None:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def send_static(self, path: Path, content_type: str) -> None:
            if not path.is_file():
                self.send_error(404)
                return
            raw = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def read_json(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as exc:
                raise ValueError("invalid Content-Length") from exc
            if length <= 0 or length > REQUEST_MAX_BYTES:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request JSON must be an object")
            return payload

        def client_key(self) -> str:
            socket_ip = self.client_address[0] if self.client_address else "unknown"
            return runtime.access.client_ip(self.headers, socket_ip)

        def allow_public_request(self, endpoint: str) -> bool:
            if not runtime.access.is_public:
                return True
            if not runtime.access.origin_allowed(self.headers):
                self.send_json(403, {"error": "origin not allowed"})
                return False
            if not runtime.access.allow(endpoint, self.client_key()):
                self.send_json(429, {"error": "rate limit exceeded"})
                return False
            return True

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            static_routes = {
                "/": (WEB_DIR / "live.html", "text/html; charset=utf-8"),
                "/index.html": (WEB_DIR / "live.html", "text/html; charset=utf-8"),
                "/live.css": (WEB_DIR / "live.css", "text/css; charset=utf-8"),
                "/live.js": (WEB_DIR / "live.js", "text/javascript; charset=utf-8"),
                "/language_policy.js": (WEB_DIR / "language_policy.js", "text/javascript; charset=utf-8"),
                "/preferences.js": (WEB_DIR / "preferences.js", "text/javascript; charset=utf-8"),
                "/audio.js": (WEB_DIR / "audio.js", "text/javascript; charset=utf-8"),
                "/ui.js": (WEB_DIR / "ui.js", "text/javascript; charset=utf-8"),
                "/ui_icons.js": (WEB_DIR / "ui_icons.js", "text/javascript; charset=utf-8"),
                "/ui_render.js": (WEB_DIR / "ui_render.js", "text/javascript; charset=utf-8"),
                "/ui_overlay.js": (WEB_DIR / "ui_overlay.js", "text/javascript; charset=utf-8"),
            }
            static = static_routes.get(path)
            if static:
                self.send_static(*static)
                return

            if path == "/health":
                self.send_json(200, {"ok": True, "mode": runtime.access.mode, "model": runtime.settings.realtime_model})
                return

            if path == "/api/settings":
                self.send_json(200, _client_settings_payload(runtime))
                return

            if path == "/api/session":
                if not self.allow_public_request("session"):
                    return
                use_fallback = query.get("fallback", ["0"])[0] == "1"
                requested_model = runtime.settings.realtime_model
                fallback_model = runtime.settings.realtime_fallback
                effective_model = fallback_model if use_fallback else requested_model
                persisted = runtime.settings.snapshot()["settings"]
                try:
                    token = create_ephemeral_token(runtime.keys[0][1])
                    session_id, session_dir = runtime.sessions.create(mode="live", model=effective_model)
                    runtime.sessions.log(
                        session_dir,
                        "realtime_model",
                        requested_model=requested_model,
                        effective_model=effective_model,
                        fallback_model=fallback_model,
                        fallback_used=use_fallback,
                        fallback_reason=("client_setup_retry" if use_fallback else None),
                        support_language=persisted["support_language"],
                        silence_duration_ms=persisted["silence_duration_ms"],
                        echo_guard_ms=persisted["echo_guard_ms"],
                        public_mode=runtime.access.is_public,
                    )
                    self.send_json(
                        200,
                        {
                            "token": token,
                            "session_id": session_id,
                            "model": effective_model,
                            "requested_model": requested_model,
                            "fallback_model": fallback_model,
                            "fallback_used": use_fallback,
                            "silence_duration_ms": persisted["silence_duration_ms"],
                            "echo_guard_ms": persisted["echo_guard_ms"],
                        },
                    )
                    print(f"LIVE : model={effective_model} fallback={use_fallback} log={session_dir}")
                except Exception as exc:
                    print(f"[TOKEN ERROR] {exc}")
                    self.send_json(502, {"error": "could not create live session" if runtime.access.is_public else str(exc)})
                return

            self.send_error(404)

        def do_POST(self) -> None:
            path = urlparse(self.path).path

            if path == "/api/settings":
                if runtime.access.is_public:
                    self.send_json(403, {"error": "public settings are read-only"})
                    return
                try:
                    result = runtime.settings.update(self.read_json())
                    result["app_mode"] = "dev"
                    result["target_language"] = "en"
                    self.send_json(200, result)
                except Exception as exc:
                    self.send_json(400, {"error": str(exc)})
                return

            if path == "/api/coach":
                if not self.allow_public_request("coach"):
                    return
                try:
                    result = runtime.coach.run_turn(
                        self.read_json(),
                        allow_client_preferences=runtime.access.is_public,
                        temporary_audio=runtime.access.is_public,
                    )
                    self.send_json(200, result)
                except Exception as exc:
                    print(f"[COACH ERROR] {exc}")
                    self.send_json(400, {"error": str(exc)})
                return

            if path == "/api/metric":
                if not self.allow_public_request("metric"):
                    return
                try:
                    payload = self.read_json()
                    session_dir = runtime.sessions.get(payload.get("session_id"))
                    if session_dir is None:
                        raise ValueError("unknown session_id")

                    frontend_state = payload.get("frontend_state") if isinstance(payload.get("frontend_state"), dict) else {}
                    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
                    runtime.sessions.log(
                        session_dir,
                        "live_turn",
                        turn=_positive_turn(payload.get("turn")),
                        user_text=str(payload.get("user_text", ""))[:4000],
                        ai_text=str(payload.get("ai_text", ""))[:4000],
                        first_audio_ms=_optional_number(payload.get("first_audio_ms")),
                        input_language_codes=_short_string_list(payload.get("input_language_codes")),
                        output_language_codes=_short_string_list(payload.get("output_language_codes")),
                        language_mode=_language_mode(payload.get("language_mode")),
                        support_language=normalize_feedback_language(payload.get("support_language")),
                        language_policy_version=_short_text(payload.get("language_policy_version")),
                        coach_eligible=_optional_bool(payload.get("coach_eligible")),
                        coach_called=_optional_bool(payload.get("coach_called")),
                        coach_skip_reason=_short_text(payload.get("coach_skip_reason")),
                        mic_audio_settings=_mic_audio_settings(payload.get("mic_audio_settings")),
                        settings={
                            "teacher": _short_text(settings.get("teacher"), 16),
                            "pronunciation_enabled": _optional_bool(settings.get("pronunciation_enabled")),
                            "silence_duration_ms": _optional_number(settings.get("silence_duration_ms")),
                            "ai_playback_rate": _optional_number(settings.get("ai_playback_rate")),
                            "echo_guard_ms": _optional_number(settings.get("echo_guard_ms")),
                            "realtime_model": _short_text(settings.get("realtime_model"), 80),
                            "coach_model": _short_text(settings.get("coach_model"), 80),
                        },
                        frontend_state={
                            "recording": frontend_state.get("recording"),
                            "activeTurn": frontend_state.get("activeTurn"),
                            "buttonEnabled": frontend_state.get("buttonEnabled"),
                            "setupReady": frontend_state.get("setupReady"),
                        },
                    )
                    self.send_json(200, {"ok": True})
                except Exception as exc:
                    self.send_json(400, {"error": str(exc)})
                return

            self.send_error(404)

    return LiveRequestHandler


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, *, app_mode: str = "dev") -> int:
    runtime = build_runtime(app_mode=app_mode)
    handler = make_handler(runtime)
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True

    print("=" * 72)
    print("E-KAIWA LIVE - Gemini Live audio-to-audio + Coach sidecar")
    print("=" * 72)
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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E-KAIWA realtime web server")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--mode",
        choices=("dev", "public"),
        default=normalize_app_mode(os.environ.get("E_KAIWA_MODE", "dev")),
        help="dev keeps engineering controls; public enables mobile UI and endpoint hardening",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run_server(args.host, args.port, app_mode=args.mode)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}")
        return 2
