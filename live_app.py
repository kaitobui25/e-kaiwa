from __future__ import annotations

import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

PROJECT_ROOT = Path(__file__).resolve().parent
TESTS_DIR = PROJECT_ROOT / "tests"
WEB_DIR = PROJECT_ROOT / "web"
API_FILE = PROJECT_ROOT / "api.txt"
LOG_ROOT = PROJECT_ROOT / "runtime_logs"
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

import test_full_loop as full  # noqa: E402

MODEL = "gemini-3.1-flash-live-preview"
TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens"
SKIP_KEY_NUMBERS = {4}
TEACHER_UI = {"Easy": "1", "Normal": "2", "Strict": "3"}
SESSIONS: dict[str, Path] = {}
SESSIONS_LOCK = Lock()


def read_keys() -> list[tuple[int, str]]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")
    values: list[str] = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in values:
            values.append(key)
    active = [(i, key) for i, key in enumerate(values, 1) if i not in SKIP_KEY_NUMBERS]
    if not active:
        raise SystemExit("[ERROR] no active API keys")
    return active


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def log_event(session_dir: Path, event: str, **data) -> None:
    row = {"ts": now_iso(), "event": event, **data}
    with (session_dir / "conversation.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def create_session_dir() -> tuple[str, Path]:
    now = datetime.now().astimezone()
    day_dir = LOG_ROOT / now.strftime("%Y-%m-%d")
    base = f"{now:%Y%m%d_%H%M%S}_live"
    session_dir = day_dir / base
    suffix = 2
    while session_dir.exists():
        session_dir = day_dir / f"{base}_{suffix}"
        suffix += 1
    session_dir.mkdir(parents=True, exist_ok=False)
    session_id = session_dir.name
    with SESSIONS_LOCK:
        SESSIONS[session_id] = session_dir
    log_event(session_dir, "session_start", mode="gemini_live_a2a", model=MODEL)
    return session_id, session_dir


def get_session_dir(session_id: str) -> Path | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", session_id or ""):
        return None
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)


def create_ephemeral_token(api_key: str) -> str:
    now = datetime.now(timezone.utc)
    body = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        "newSessionExpireTime": (now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        "liveConnectConstraints": {
            "model": f"models/{MODEL}",
            "config": {"responseModalities": ["AUDIO"]},
        },
    }
    req = urllib.request.Request(
        TOKEN_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"token HTTP {exc.code}: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"token request failed: {exc}") from exc
    token = str(payload.get("name", "")).strip()
    if not token:
        raise RuntimeError(f"token response missing name: {payload}")
    return token


def save_pcm_wav(raw_pcm: bytes, path: Path, sample_rate: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(raw_pcm)


def coach_turn(payload: dict) -> dict:
    session_id = str(payload.get("session_id", ""))
    session_dir = get_session_dir(session_id)
    if session_dir is None:
        raise ValueError("unknown session_id")

    turn_no = max(1, int(payload.get("turn", 1)))
    transcript = str(payload.get("transcript", "")).strip()
    teacher_name = str(payload.get("teacher", "Normal"))
    teacher_choice = TEACHER_UI.get(teacher_name, "2")
    resolved_teacher, teacher_rule = full.TEACHER_MODES[teacher_choice]
    pronunciation_enabled = bool(payload.get("pronunciation_enabled", True))
    sample_rate = int(payload.get("sample_rate", 16000))
    raw_pcm = base64.b64decode(str(payload.get("pcm_b64", "")), validate=True)
    if not raw_pcm:
        raise ValueError("empty PCM audio")

    user_wav = session_dir / f"turn_{turn_no:03d}_user.wav"
    save_pcm_wav(raw_pcm, user_wav, sample_rate)
    key_no, key = KEYS[(turn_no - 1) % len(KEYS)]
    started = time.perf_counter()

    def correction_job():
        return full.make_turn(key, transcript, resolved_teacher, teacher_rule, [])

    def pronunciation_job():
        if not pronunciation_enabled:
            return None, 0.0, None
        return full.run_pronunciation(key, user_wav, transcript, teacher_choice)

    with ThreadPoolExecutor(max_workers=2) as pool:
        correction_future = pool.submit(correction_job)
        pronunciation_future = pool.submit(pronunciation_job)
        turn, llm_latency, llm_error = correction_future.result()
        pron_result, pron_latency, pron_model = pronunciation_future.result()

    coach_wall = time.perf_counter() - started
    correction = transcript
    explanation_ja = ""
    if turn:
        correction = turn.get("correction") or transcript
        explanation_ja = turn.get("explanation_ja") or ""

    log_event(
        session_dir,
        "coach",
        turn=turn_no,
        user_audio=user_wav.name,
        user_text=transcript,
        teacher=resolved_teacher,
        key_slot=key_no,
        correction=correction,
        explanation_ja=explanation_ja,
        pronunciation={
            "enabled": pronunciation_enabled,
            "model": pron_model,
            "latency_s": round(pron_latency, 3),
            "result": pron_result,
        },
        correction_llm={
            "model": full.LLM_MODEL,
            "latency_s": round(llm_latency, 3),
            "error": llm_error,
        },
        coach_wall_s=round(coach_wall, 3),
    )
    return {
        "correction": correction,
        "explanation_ja": explanation_ja,
        "pronunciation": pron_result,
        "coach_wall_s": round(coach_wall, 3),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "EKaiwaLive/0.1"

    def log_message(self, fmt, *args):
        print(f"[HTTP] {self.address_string()} - {fmt % args}")

    def send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def send_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
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
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 8_000_000:
            raise ValueError("invalid request size")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path in {"/", "/index.html"}:
            self.send_file(WEB_DIR / "live.html", "text/html; charset=utf-8")
            return
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": MODEL})
            return
        if self.path == "/api/session":
            try:
                token = create_ephemeral_token(KEYS[0][1])
                session_id, session_dir = create_session_dir()
                self.send_json(
                    200,
                    {"token": token, "session_id": session_id, "model": MODEL},
                )
                print(f"LIVE : session={session_id} log={session_dir}")
            except Exception as exc:
                print(f"[TOKEN ERROR] {exc}")
                self.send_json(502, {"error": str(exc)})
            return
        self.send_error(404)

    def do_POST(self):
        if self.path == "/api/coach":
            try:
                payload = self.read_json()
                result = coach_turn(payload)
                self.send_json(200, result)
            except Exception as exc:
                print(f"[COACH ERROR] {exc}")
                self.send_json(400, {"error": str(exc)})
            return
        if self.path == "/api/metric":
            try:
                payload = self.read_json()
                session_dir = get_session_dir(str(payload.get("session_id", "")))
                if session_dir is None:
                    raise ValueError("unknown session_id")
                log_event(
                    session_dir,
                    "live_turn",
                    turn=int(payload.get("turn", 1)),
                    user_text=str(payload.get("user_text", "")),
                    ai_text=str(payload.get("ai_text", "")),
                    first_audio_ms=payload.get("first_audio_ms"),
                )
                self.send_json(200, {"ok": True})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            return
        self.send_error(404)


def main() -> int:
    host = "127.0.0.1"
    port = 7860
    print("=" * 72)
    print("E-KAIWA LIVE - Gemini 3.1 Flash Live audio-to-audio + coach sidecar")
    print("=" * 72)
    print(f"Model : {MODEL}")
    print(f"Local : http://{host}:{port}")
    print("Realtime audio path: browser <-> Gemini Live (direct WebSocket)")
    print("Coach path         : browser -> this server after each turn")
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


KEYS = read_keys()

if __name__ == "__main__":
    raise SystemExit(main())
