from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Type

from .coach import CoachService
from .config import (
    API_FILE,
    DEFAULT_HOST,
    DEFAULT_PORT,
    LIVE_MODEL,
    LOG_ROOT,
    REQUEST_MAX_BYTES,
    WEB_DIR,
    load_api_keys,
)
from .gemini import create_ephemeral_token
from .sessions import SessionStore


@dataclass
class Runtime:
    keys: list[tuple[int, str]]
    sessions: SessionStore
    coach: CoachService


def build_runtime(*, api_file: Path = API_FILE, log_root: Path = LOG_ROOT) -> Runtime:
    keys = load_api_keys(api_file)
    sessions = SessionStore(log_root)
    return Runtime(keys=keys, sessions=sessions, coach=CoachService(keys, sessions))


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


def make_handler(runtime: Runtime) -> Type[BaseHTTPRequestHandler]:
    class LiveRequestHandler(BaseHTTPRequestHandler):
        server_version = "EKaiwaLive/0.2"

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"[HTTP] {self.address_string()} - {fmt % args}")

        def send_json(self, status: int, payload: dict) -> None:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
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

        def do_GET(self) -> None:
            static_routes = {
                "/": (WEB_DIR / "live.html", "text/html; charset=utf-8"),
                "/index.html": (WEB_DIR / "live.html", "text/html; charset=utf-8"),
                "/live.css": (WEB_DIR / "live.css", "text/css; charset=utf-8"),
                "/live.js": (WEB_DIR / "live.js", "text/javascript; charset=utf-8"),
            }
            static = static_routes.get(self.path)
            if static:
                self.send_static(*static)
                return

            if self.path == "/health":
                self.send_json(200, {"ok": True, "model": LIVE_MODEL})
                return

            if self.path == "/api/session":
                try:
                    token = create_ephemeral_token(runtime.keys[0][1])
                    session_id, session_dir = runtime.sessions.create(
                        mode="live",
                        model=LIVE_MODEL,
                    )
                    self.send_json(
                        200,
                        {"token": token, "session_id": session_id, "model": LIVE_MODEL},
                    )
                    print(f"LIVE : session={session_id} log={session_dir}")
                except Exception as exc:
                    print(f"[TOKEN ERROR] {exc}")
                    self.send_json(502, {"error": str(exc)})
                return

            self.send_error(404)

        def do_POST(self) -> None:
            if self.path == "/api/coach":
                try:
                    result = runtime.coach.run_turn(self.read_json())
                    self.send_json(200, result)
                except Exception as exc:
                    print(f"[COACH ERROR] {exc}")
                    self.send_json(400, {"error": str(exc)})
                return

            if self.path == "/api/metric":
                try:
                    payload = self.read_json()
                    session_dir = runtime.sessions.get(payload.get("session_id"))
                    if session_dir is None:
                        raise ValueError("unknown session_id")

                    frontend_state = payload.get("frontend_state")
                    if not isinstance(frontend_state, dict):
                        frontend_state = {}

                    runtime.sessions.log(
                        session_dir,
                        "live_turn",
                        turn=_positive_turn(payload.get("turn")),
                        user_text=str(payload.get("user_text", "")),
                        ai_text=str(payload.get("ai_text", "")),
                        first_audio_ms=_optional_number(payload.get("first_audio_ms")),
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


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> int:
    runtime = build_runtime()
    handler = make_handler(runtime)
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True

    print("=" * 72)
    print("E-KAIWA LIVE - Gemini Live audio-to-audio + coach sidecar")
    print("=" * 72)
    print(f"Model : {LIVE_MODEL}")
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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run_server(args.host, args.port)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}")
        return 2
