from __future__ import annotations

import json
import sys
import time
import urllib.parse
from pathlib import Path

try:
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect
except ImportError:
    raise SystemExit(
        "[ERROR] websockets package is missing. Run: .venv\\Scripts\\pip install -r requirements.txt"
    )

PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_FILE = PROJECT_ROOT / "api.txt"
WS_BASE = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
)
TIMEOUT = 8.0

MODELS = [
    (
        "Live Transcribe",
        "gemini-3.5-transcribe-live",
        {
            "responseModalities": ["TEXT"],
        },
        {"languageCodes": []},
    ),
    (
        "Audio-to-Audio",
        "gemini-3.1-flash-live-preview",
        {
            "responseModalities": ["AUDIO"],
        },
        {},
    ),
]


def read_keys() -> list[tuple[int, str]]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")
    rows: list[tuple[int, str]] = []
    slot = 0
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if not key or key.startswith("#"):
            continue
        slot += 1
        rows.append((slot, key))
    if not rows:
        raise SystemExit("[ERROR] api.txt contains no API keys")
    return rows


def mask(key: str) -> str:
    if len(key) < 10:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def describe_message(payload: dict) -> str:
    if payload.get("setupComplete") is not None:
        return "setupComplete"
    error = payload.get("error")
    if isinstance(error, dict):
        status = error.get("status") or error.get("code") or "ERROR"
        message = error.get("message") or "unknown error"
        return f"{status}: {message}"
    return json.dumps(payload, ensure_ascii=False)[:220]


def test_model(key: str, model: str, generation_config: dict, transcription_config: dict) -> tuple[bool, float, str]:
    url = f"{WS_BASE}?key={urllib.parse.quote(key, safe='')}"
    setup = {
        "setup": {
            "model": f"models/{model}",
            "generationConfig": generation_config,
            "inputAudioTranscription": transcription_config,
        }
    }
    started = time.perf_counter()
    try:
        with connect(url, open_timeout=TIMEOUT, close_timeout=2) as ws:
            ws.send(json.dumps(setup))
            deadline = time.perf_counter() + TIMEOUT
            while True:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    return False, time.perf_counter() - started, "timeout waiting for setupComplete"
                raw = ws.recv(timeout=remaining)
                payload = json.loads(raw)
                if payload.get("setupComplete") is not None:
                    return True, time.perf_counter() - started, "setupComplete"
                if payload.get("error"):
                    return False, time.perf_counter() - started, describe_message(payload)
    except TimeoutError:
        return False, time.perf_counter() - started, "timeout"
    except ConnectionClosed as exc:
        reason = exc.reason or "connection closed"
        return False, time.perf_counter() - started, f"closed {exc.code}: {reason}"
    except Exception as exc:
        return False, time.perf_counter() - started, str(exc)


def main() -> int:
    keys = read_keys()
    print("=" * 86)
    print("E-KAIWA - GEMINI LIVE ACCESS TEST")
    print("=" * 86)
    print(f"Keys: {len(keys)} (all keys are tested; nothing is skipped)\n")

    overall_ok = True
    for slot, key in keys:
        print(f"KEY #{slot} [{mask(key)}]")
        for label, model, generation_config, transcription_config in MODELS:
            ok, dt, detail = test_model(key, model, generation_config, transcription_config)
            state = "OK" if ok else "FAIL"
            print(f"  [{state}] {label:<15} {model:<34} {dt:>5.2f}s  {detail}")
            overall_ok = overall_ok and ok
        print()

    print("Interpretation:")
    print("  Live Transcribe OK = that key can open gemini-3.5-transcribe-live.")
    print("  Audio-to-Audio OK  = that key can open gemini-3.1-flash-live-preview.")
    print("  FAIL                = read the returned close/error reason; key/model/quota access is not usable right now.")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
