from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from .config import GEMINI_TIMEOUT_S, TOKEN_URL


def post_json(
    url: str,
    body: dict,
    api_key: str,
    *,
    timeout_s: int = GEMINI_TIMEOUT_S,
) -> tuple[int, dict, float, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
            return response.status, payload, time.perf_counter() - started, ""
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
            error = payload.get("error", {})
            message = f"{error.get('status', '')}: {error.get('message', 'Unknown error')}".strip(": ")
        except Exception:
            message = raw[:400]
        return exc.code, {}, time.perf_counter() - started, message
    except Exception as exc:
        return 0, {}, time.perf_counter() - started, str(exc)


def extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(
        part.get("text", "")
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ).strip()


def parse_json_text(text: str) -> dict:
    value = text.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        value = "\n".join(lines).strip()
    result = json.loads(value)
    if not isinstance(result, dict):
        raise ValueError("Gemini response must be a JSON object")
    return result


def create_ephemeral_token(api_key: str) -> str:
    now = datetime.now(timezone.utc)
    body = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        "newSessionExpireTime": (now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
    }
    status, payload, _, error = post_json(TOKEN_URL, body, api_key, timeout_s=20)
    if status != 200:
        raise RuntimeError(f"token HTTP {status or 'network'}: {error}")
    token = str(payload.get("name", "")).strip()
    if not token:
        raise RuntimeError("token response missing name")
    return token
