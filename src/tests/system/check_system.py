from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "src"
APP = SRC / "app.py"
API_FILE = ROOT / "api.txt"
HOST = "127.0.0.1"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def get(url: str, *, timeout: float = 10.0) -> tuple[int, bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "e-kaiwa-system-check"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read(), response.headers.get("Content-Type", "")


def wait_until_ready(base_url: str, process: subprocess.Popen[str], timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"server exited early with code {process.returncode}")
        try:
            status, body, _ = get(f"{base_url}/health", timeout=1.0)
            payload = json.loads(body.decode("utf-8"))
            if status == 200 and payload.get("ok") is True:
                return
        except Exception as exc:  # server may still be starting
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"server did not become ready: {last_error}")


def assert_endpoint(base_url: str, path: str, needle: bytes) -> None:
    status, body, _ = get(f"{base_url}{path}")
    if status != 200:
        raise RuntimeError(f"{path} returned HTTP {status}")
    if needle not in body:
        raise RuntimeError(f"{path} did not contain expected marker {needle!r}")
    print(f"[PASS] GET {path}")


def run() -> int:
    if not APP.is_file():
        print(f"[FAIL] app entrypoint not found: {APP}")
        return 2
    if not API_FILE.is_file():
        print(f"[FAIL] api.txt not found: {API_FILE}")
        print("       System test intentionally uses a real Gemini ephemeral-token request.")
        return 2

    port = free_port()
    base_url = f"http://{HOST}:{port}"
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = str(SRC)

    print("=" * 68)
    print("E-KAIWA SYSTEM TEST")
    print("=" * 68)
    print("Checks: app startup, local HTTP, frontend assets, Gemini token API")
    print(f"Server: {base_url}")
    print()

    process = subprocess.Popen(
        [sys.executable, str(APP), "--host", HOST, "--port", str(port)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    failure: Exception | None = None
    try:
        wait_until_ready(base_url, process)
        print("[PASS] app process started and /health is ready")

        status, body, content_type = get(f"{base_url}/health")
        health = json.loads(body.decode("utf-8"))
        if status != 200 or health.get("ok") is not True or not health.get("model"):
            raise RuntimeError(f"invalid /health response: {health}")
        if "application/json" not in content_type:
            raise RuntimeError(f"unexpected /health content type: {content_type}")
        print(f"[PASS] /health model={health['model']}")

        assert_endpoint(base_url, "/", b"E-KAIWA")
        assert_endpoint(base_url, "/live.css", b"body")
        assert_endpoint(base_url, "/live.js", b"WebSocket")

        print("[....] requesting a real Gemini ephemeral session token")
        status, body, _ = get(f"{base_url}/api/session", timeout=30.0)
        session = json.loads(body.decode("utf-8"))
        if status != 200:
            raise RuntimeError(f"/api/session returned HTTP {status}: {session}")
        missing = [key for key in ("token", "session_id", "model") if not session.get(key)]
        if missing:
            raise RuntimeError(f"/api/session missing fields: {missing}")
        print(f"[PASS] Gemini ephemeral token created; session={session['session_id']}")

        print()
        print("SYSTEM TEST PASSED")
        print("Note: browser microphone + Gemini Live audio/WebSocket remains a manual phone test.")
        return 0
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        failure = RuntimeError(f"HTTP {exc.code} for {exc.url}: {detail}")
    except Exception as exc:
        failure = exc
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate(timeout=5)
        if failure is not None:
            print()
            print(f"[FAIL] {failure}")
            if output.strip():
                print("\n--- server output ---")
                print(output.rstrip())
                print("--- end server output ---")

    return 1


if __name__ == "__main__":
    raise SystemExit(run())
