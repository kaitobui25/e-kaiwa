from __future__ import annotations

import json
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone
import urllib.request

from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed

PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_FILE = PROJECT_ROOT / "api.txt"
MODEL = "gemini-3.1-flash-live-preview"
TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens"
WS_BASE = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"
)
TIMEOUT = 8.0


def read_keys():
    keys = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#"):
            keys.append(key)
    return keys


def mask(key: str) -> str:
    return f"{key[:4]}...{key[-4:]}" if len(key) >= 10 else "***"


def create_token(key: str) -> str:
    now = datetime.now(timezone.utc)
    body = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        "newSessionExpireTime": (now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
    }
    req = urllib.request.Request(
        TOKEN_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        payload = json.loads(res.read().decode("utf-8"))
    return payload["name"]


def main() -> int:
    keys = read_keys()
    if not keys:
        raise SystemExit("No API keys in api.txt")

    print("=" * 78)
    print("E-KAIWA - EPHEMERAL LIVE PATH TEST")
    print("Tests the exact path used by browser: token -> Constrained WebSocket -> setupComplete")
    print("=" * 78)

    overall = True
    for i, key in enumerate(keys, 1):
        started = time.perf_counter()
        try:
            token = create_token(key)
            url = f"{WS_BASE}?access_token={token}"
            with connect(url, open_timeout=TIMEOUT, close_timeout=2) as ws:
                ws.send(json.dumps({
                    "setup": {
                        "model": f"models/{MODEL}",
                        "generationConfig": {"responseModalities": ["AUDIO"]},
                        "inputAudioTranscription": {},
                        "outputAudioTranscription": {},
                    }
                }))
                raw = ws.recv(timeout=TIMEOUT)
                payload = json.loads(raw)
                ok = payload.get("setupComplete") is not None
                detail = "setupComplete" if ok else json.dumps(payload, ensure_ascii=False)[:240]
        except ConnectionClosed as exc:
            ok = False
            detail = f"closed {exc.code}: {exc.reason or 'no reason'}"
        except Exception as exc:
            ok = False
            detail = str(exc)

        dt = time.perf_counter() - started
        print(f"KEY #{i} [{mask(key)}]  [{'OK' if ok else 'FAIL'}]  {dt:.2f}s  {detail}")
        overall = overall and ok

    return 0 if overall else 1


if __name__ == "__main__":
    raise SystemExit(main())
