"""Gemini model smoke test for e-kaiwa.

Reads API keys from ./api.txt, discovers models visible to each key, then tests
all target models requested for this project.

Conversation models are tested with the actual e-kaiwa reply + correction JSON
prompt. A model whose name contains "transcribe" is tested separately with a
small generated WAV payload so it is not incorrectly judged as a chat LLM.

No third-party packages required.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
API_FILE = Path(__file__).resolve().parent / "api.txt"
TIMEOUT_SECONDS = 30

# Test every model below when the key exposes it.
# Requested models are first; the two Lite models remain as useful MVP baselines.
MODEL_PRIORITY = [
    "gemini-3.5-transcribe",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
]

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
            return response.status, json.loads(payload), time.perf_counter() - started
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = {"error": {"message": payload[:500]}}
        return exc.code, parsed, time.perf_counter() - started
    except (urllib.error.URLError, TimeoutError) as exc:
        return 0, {"error": {"message": str(exc)}}, time.perf_counter() - started


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


def clean_model_name(model: dict) -> str:
    return model.get("name", "").removeprefix("models/")


def supports_generate_content(model: dict) -> bool:
    return "generateContent" in model.get("supportedGenerationMethods", [])


def choose_models(models: list[dict]) -> tuple[list[str], list[str]]:
    available = sorted(
        clean_model_name(m)
        for m in models
        if supports_generate_content(m)
    )
    available_set = set(available)
    chosen = [name for name in MODEL_PRIORITY if name in available_set]
    return available, chosen


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


def strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def generate_silent_wav(seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """Generate a tiny mono PCM WAV using only the standard library."""
    frames = int(seconds * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(struct.pack("<h", 0) * frames)
    return buffer.getvalue()


def model_url(key: str, model: str) -> str:
    return (
        f"{API_BASE}/models/{urllib.parse.quote(model, safe='')}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )


def test_transcribe_model(key: str, model: str) -> dict:
    """Audio-path smoke test. Silence is enough to verify access + accepted modality."""
    wav_b64 = base64.b64encode(generate_silent_wav()).decode("ascii")
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "Transcribe the attached audio. If there is no speech, return NO_SPEECH."},
                    {"inlineData": {"mimeType": "audio/wav", "data": wav_b64}},
                ],
            }
        ],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 80},
    }

    status, payload, elapsed = http_json("POST", model_url(key, model), body)
    result = {
        "model": model,
        "role": "STT",
        "http": status,
        "latency": elapsed,
        "ok": status == 200,
        "structured": False,
        "message": "",
    }
    if status != 200:
        result["message"] = error_message(payload)
        return result

    text = extract_text(payload)
    result["message"] = f"audio request accepted; output={text[:100]!r}" if text else "audio request accepted (no text for silent audio)"
    return result


def test_conversation_model(key: str, model: str) -> dict:
    generation_config = {
        "temperature": 0.2,
        "maxOutputTokens": 220,
    }

    # Gemini supports JSON response MIME type. Gemma compatibility can vary,
    # so use prompt-enforced JSON there instead of turning a working model into
    # a false failure because of one optional generationConfig field.
    if not model.startswith("gemma-"):
        generation_config["responseMimeType"] = "application/json"

    body = {
        "contents": [{"role": "user", "parts": [{"text": TEST_PROMPT}]}],
        "generationConfig": generation_config,
    }

    status, payload, elapsed = http_json("POST", model_url(key, model), body)
    result = {
        "model": model,
        "role": "LLM",
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

    result["ok"] = True
    try:
        obj = json.loads(strip_json_fence(text))
    except json.JSONDecodeError:
        result["message"] = f"responded, but invalid JSON: {text[:160]!r}"
        return result

    required = ("reply", "correction", "explanation_ja")
    missing = [
        field
        for field in required
        if not isinstance(obj.get(field), str) or not obj[field].strip()
    ]
    result["structured"] = not missing
    if missing:
        result["message"] = "Missing/invalid fields: " + ", ".join(missing)
    else:
        result["message"] = (
            f"reply={obj['reply'][:60]!r}; correction={obj['correction'][:60]!r}"
        )
    return result


def test_model(key: str, model: str) -> dict:
    if "transcribe" in model.lower():
        return test_transcribe_model(key, model)
    return test_conversation_model(key, model)


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

    print("=" * 78)
    print("E-KAIWA - GEMINI / GEMMA MODEL TEST")
    print("=" * 78)
    print(f"api.txt : {API_FILE}")
    print(f"keys    : {len(keys)}")
    print("Full API keys will NOT be printed.")
    print("All requested target models will be tested when available.\n")

    all_results: list[dict] = []

    for index, key in enumerate(keys, start=1):
        print("-" * 78)
        print(f"KEY {index}/{len(keys)} [{mask_key(key)}]")

        status, models, elapsed, err = list_models(key)
        if status != 200:
            state = classify_key_error(status, err)
            print(f"  Key status : {state}")
            print(f"  HTTP       : {status or 'network'} ({elapsed:.2f}s)")
            print(f"  Error      : {err[:300]}")
            all_results.append({"key": index, "key_state": state, "tests": []})
            continue

        _, chosen = choose_models(models)
        print("  Key status : ALIVE")
        print(f"  Models     : {len(models)} total")

        print("  Target availability:")
        exposed = {clean_model_name(m) for m in models if supports_generate_content(m)}
        for name in MODEL_PRIORITY:
            marker = "YES" if name in exposed else "NO"
            role = "STT" if "transcribe" in name.lower() else "LLM"
            print(f"    [{marker:3}] [{role}] {name}")

        if not chosen:
            print("  No target model exposed by this key.")
            all_results.append({"key": index, "key_state": "ALIVE", "tests": []})
            continue

        print("\n  Running tests:")
        tests: list[dict] = []
        for model in chosen:
            result = test_model(key, model)
            tests.append(result)
            role = result["role"]

            if role == "STT" and result["ok"]:
                print(f"    [OK]   [STT] {model:<28} {result['latency']:.2f}s  audio accepted")
            elif role == "LLM" and result["ok"] and result["structured"]:
                print(f"    [OK]   [LLM] {model:<28} {result['latency']:.2f}s  e-kaiwa JSON OK")
            elif result["ok"]:
                print(f"    [WARN] [{role}] {model:<28} {result['latency']:.2f}s  {result['message'][:150]}")
            else:
                print(
                    f"    [FAIL] [{role}] {model:<28} {result['latency']:.2f}s  "
                    f"HTTP {result['http'] or 'network'} - {result['message'][:170]}"
                )

        all_results.append({"key": index, "key_state": "ALIVE", "tests": tests})

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)

    alive_keys = [r for r in all_results if r["key_state"] == "ALIVE"]
    llm_verified: dict[str, list[tuple[int, float]]] = {}
    stt_verified: dict[str, list[tuple[int, float]]] = {}

    for row in all_results:
        for test in row["tests"]:
            if test["role"] == "LLM" and test["ok"] and test["structured"]:
                llm_verified.setdefault(test["model"], []).append((row["key"], test["latency"]))
            elif test["role"] == "STT" and test["ok"]:
                stt_verified.setdefault(test["model"], []).append((row["key"], test["latency"]))

    print(f"Keys alive             : {len(alive_keys)}/{len(keys)}")
    print(f"LLM models verified    : {len(llm_verified)}")
    print(f"STT models smoke-tested: {len(stt_verified)}")

    if llm_verified:
        print("\nLLM - usable for reply + correction:")
        ordered = sorted(
            llm_verified.items(),
            key=lambda item: (sum(x[1] for x in item[1]) / len(item[1]), item[0]),
        )
        for model, successes in ordered:
            avg = sum(x[1] for x in successes) / len(successes)
            keys_text = ", ".join(str(x[0]) for x in successes)
            print(f"  [OK] {model:<30} avg {avg:.2f}s  key(s): {keys_text}")

        candidates = list(llm_verified)
        lite = [m for m in candidates if "flash-lite" in m]
        flash = [m for m in candidates if "flash" in m and "transcribe" not in m]
        pool = lite or flash or candidates
        recommended = min(
            pool,
            key=lambda m: sum(x[1] for x in llm_verified[m]) / len(llm_verified[m]),
        )
        print(f"\nRECOMMENDED LLM FOR MVP: {recommended}")

    if stt_verified:
        print("\nSTT - audio endpoint smoke test:")
        for model, successes in stt_verified.items():
            avg = sum(x[1] for x in successes) / len(successes)
            keys_text = ", ".join(str(x[0]) for x in successes)
            print(f"  [OK] {model:<30} avg {avg:.2f}s  key(s): {keys_text}")
        print("  NOTE: this is only an audio-access test using silent WAV, not transcription-quality scoring.")

    if not llm_verified and not stt_verified:
        print("\nNo target model completed its smoke test.")
        print("Check HTTP errors above for quota, permission, or model-specific restrictions.")
        return 1

    print("\nProject fit:")
    print("  LLM Flash/Gemma -> reply + correction")
    print("  Transcribe      -> STT candidate only; do not use it as the conversation LLM")
    print("  TTS             -> keep separate for the simple MVP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
