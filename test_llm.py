"""Gemini API smoke test for e-kaiwa.

Reads Gemini API keys from ./api.txt (one key per non-empty line), checks which
keys are alive, discovers models available to each key, then runs a tiny
structured English-conversation/correction prompt against a few suitable models.

No third-party packages required.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
API_FILE = Path(__file__).resolve().parent / "api.txt"
TIMEOUT_SECONDS = 20

# Prefer cheap/fast models for a realtime-ish conversation app.
# Only models actually returned by Google's models endpoint will be tested.
MODEL_PRIORITY = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
]
MAX_MODELS_TO_VERIFY_PER_KEY = 3

TEST_PROMPT = """You are the LLM inside an English conversation practice app for Japanese learners.
The user said: \"Yesterday I go shopping with my friend.\"
Return ONLY one JSON object with exactly these string fields:
- reply: a short natural conversational reply in English
- correction: corrected version of the user's English sentence
- explanation_ja: a very short explanation in Japanese of the main correction
Keep the whole response concise.
"""


def mask_key(key: str) -> str:
    if len(key) <= 10:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def read_keys() -> list[str]:
    if not API_FILE.exists():
        print(f"[ERROR] api.txt not found: {API_FILE}")
        print("Create api.txt in the repo root, one Gemini API key per line.")
        sys.exit(2)

    keys: list[str] = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if not key or key.startswith("#"):
            continue
        if key not in keys:
            keys.append(key)

    if not keys:
        print("[ERROR] api.txt contains no API keys.")
        sys.exit(2)

    return keys


def http_json(method: str, url: str, body: dict | None = None) -> tuple[int, dict, float]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.perf_counter()

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = response.read().decode("utf-8", errors="replace")
            elapsed = time.perf_counter() - started
            return response.status, json.loads(payload), elapsed
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        elapsed = time.perf_counter() - started
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = {"error": {"message": payload[:500]}}
        return exc.code, parsed, elapsed
    except (urllib.error.URLError, TimeoutError) as exc:
        elapsed = time.perf_counter() - started
        return 0, {"error": {"message": str(exc)}}, elapsed


def error_message(payload: dict) -> str:
    err = payload.get("error", {}) if isinstance(payload, dict) else {}
    if isinstance(err, dict):
        status = err.get("status")
        message = err.get("message", "Unknown error")
        return f"{status}: {message}" if status else str(message)
    return str(err)


def list_models(key: str) -> tuple[int, list[dict], float, str]:
    url = f"{API_BASE}/models?key={urllib.parse.quote(key)}&pageSize=1000"
    status, payload, elapsed = http_json("GET", url)
    if status != 200:
        return status, [], elapsed, error_message(payload)
    return status, payload.get("models", []), elapsed, ""


def supports_generate_content(model: dict) -> bool:
    methods = model.get("supportedGenerationMethods", [])
    return "generateContent" in methods


def clean_model_name(model: dict) -> str:
    name = model.get("name", "")
    return name.removeprefix("models/")


def looks_like_chat_model(name: str) -> bool:
    lowered = name.lower()
    blocked = (
        "embedding",
        "aqa",
        "image",
        "tts",
        "live",
        "native-audio",
        "robotics",
        "computer-use",
        "deep-research",
    )
    return (
        ("gemini" in lowered or "gemma" in lowered)
        and not any(word in lowered for word in blocked)
    )


def choose_models(models: list[dict]) -> tuple[list[str], list[str]]:
    available = sorted(
        {
            clean_model_name(m)
            for m in models
            if supports_generate_content(m) and looks_like_chat_model(clean_model_name(m))
        }
    )

    chosen: list[str] = []

    # Exact preferred stable models first.
    for wanted in MODEL_PRIORITY:
        if wanted in available and wanted not in chosen:
            chosen.append(wanted)

    # Future-proof fallback: any Flash-Lite, then Flash model not already selected.
    fallbacks = sorted(
        available,
        key=lambda n: (
            0 if "flash-lite" in n else 1 if "flash" in n else 2,
            1 if "preview" in n or "exp" in n else 0,
            n,
        ),
    )
    for name in fallbacks:
        if name not in chosen:
            chosen.append(name)

    return available, chosen[:MAX_MODELS_TO_VERIFY_PER_KEY]


def extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    texts = [part.get("text", "") for part in parts if isinstance(part, dict)]
    return "".join(texts).strip()


def test_model(key: str, model: str) -> dict:
    url = (
        f"{API_BASE}/models/{urllib.parse.quote(model, safe='')}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )
    body = {
        "contents": [{"role": "user", "parts": [{"text": TEST_PROMPT}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 220,
            "responseMimeType": "application/json",
        },
    }

    status, payload, elapsed = http_json("POST", url, body)
    result = {
        "model": model,
        "http": status,
        "latency": elapsed,
        "ok": False,
        "structured": False,
        "message": "",
    }

    if status != 200:
        result["message"] = error_message(payload)
        return result

    text = extract_text(payload)
    if not text:
        result["message"] = "HTTP 200 but no text returned"
        return result

    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        result["message"] = f"Generated text, but invalid JSON: {text[:160]!r}"
        result["ok"] = True
        return result

    required = ("reply", "correction", "explanation_ja")
    missing = [field for field in required if not isinstance(obj.get(field), str) or not obj[field].strip()]
    result["ok"] = True
    result["structured"] = not missing

    if missing:
        result["message"] = "Missing/invalid JSON fields: " + ", ".join(missing)
    else:
        result["message"] = (
            f"reply={obj['reply'][:70]!r}; "
            f"correction={obj['correction'][:70]!r}"
        )
    return result


def classify_key_error(status: int, message: str) -> str:
    lowered = message.lower()
    if status in (401, 403) or "api key not valid" in lowered or "permission_denied" in lowered:
        return "DEAD / INVALID / NO PERMISSION"
    if status == 429 or "resource_exhausted" in lowered or "quota" in lowered:
        return "ALIVE, BUT QUOTA/RATE-LIMITED"
    if status == 0:
        return "NETWORK ERROR"
    return f"API ERROR (HTTP {status})"


def main() -> int:
    keys = read_keys()

    print("=" * 72)
    print("E-KAIWA - GEMINI LLM TEST")
    print("=" * 72)
    print(f"api.txt : {API_FILE}")
    print(f"keys    : {len(keys)}")
    print("Full API keys will NOT be printed.\n")

    all_results: list[dict] = []

    for index, key in enumerate(keys, start=1):
        label = f"KEY {index}/{len(keys)} [{mask_key(key)}]"
        print("-" * 72)
        print(label)

        status, models, elapsed, err = list_models(key)
        if status != 200:
            state = classify_key_error(status, err)
            print(f"  Key status : {state}")
            print(f"  HTTP       : {status or 'network'} ({elapsed:.2f}s)")
            print(f"  Error      : {err[:300]}")
            all_results.append({"key": index, "key_state": state, "tests": []})
            continue

        available, chosen = choose_models(models)
        print(f"  Key status : ALIVE")
        print(f"  Models     : {len(models)} total; {len(available)} chat generateContent model(s)")

        if available:
            print("  Available  :")
            for name in available:
                print(f"    - {name}")
        else:
            print("  No suitable generateContent chat model found.")
            all_results.append({"key": index, "key_state": "ALIVE", "tests": []})
            continue

        print("  Verify     : " + ", ".join(chosen))
        tests: list[dict] = []

        for model in chosen:
            result = test_model(key, model)
            tests.append(result)
            if result["ok"] and result["structured"]:
                print(f"    [OK]   {model:<30} {result['latency']:.2f}s  structured JSON")
            elif result["ok"]:
                print(f"    [WARN] {model:<30} {result['latency']:.2f}s  {result['message']}")
            else:
                print(
                    f"    [FAIL] {model:<30} {result['latency']:.2f}s  "
                    f"HTTP {result['http'] or 'network'} - {result['message'][:180]}"
                )

        all_results.append({"key": index, "key_state": "ALIVE", "tests": tests})

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)

    alive_keys = [r for r in all_results if r["key_state"] == "ALIVE"]
    verified: dict[str, list[tuple[int, float]]] = {}
    for row in all_results:
        for test in row["tests"]:
            if test["ok"] and test["structured"]:
                verified.setdefault(test["model"], []).append((row["key"], test["latency"]))

    print(f"Keys alive                 : {len(alive_keys)}/{len(keys)}")
    print(f"Models verified for e-kaiwa: {len(verified)}")

    if verified:
        print("\nVerified models:")
        for model, successes in sorted(
            verified.items(),
            key=lambda item: (sum(x[1] for x in item[1]) / len(item[1]), item[0]),
        ):
            avg = sum(x[1] for x in successes) / len(successes)
            key_numbers = ", ".join(str(x[0]) for x in successes)
            print(f"  [OK] {model:<30} avg {avg:.2f}s  key(s): {key_numbers}")

        # Prefer Lite for cost/latency; otherwise fastest verified model.
        candidates = list(verified)
        lite = [m for m in candidates if "flash-lite" in m]
        pool = lite or [m for m in candidates if "flash" in m] or candidates
        recommended = min(
            pool,
            key=lambda m: sum(x[1] for x in verified[m]) / len(verified[m]),
        )

        print(f"\nRECOMMENDED FOR MVP: {recommended}")
        print("Reason: verified structured correction output; Flash-Lite is preferred when")
        print("available because this app needs cheap, fast conversational turns more than")
        print("maximum reasoning quality. Keep a second verified Flash model as fallback.")
        print("\nLLM fit for this project: YES for reply + grammar correction.")
        print("STT and TTS should remain separate components in the first simple MVP.")
        return 0

    print("\nNo model completed the real structured-output test.")
    print("Check the HTTP errors above (invalid key, quota, permission, or model access).")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
