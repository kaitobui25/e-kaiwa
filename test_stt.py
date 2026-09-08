"""Simple STT benchmark for e-kaiwa.

Flow per sample:
1) Try gemini-3.5-transcribe once (official Files API path).
2) If it returns empty/error, fall back to normal Gemini audio-capable models.
3) Stop at the first model that returns a transcript.

Key #4 is intentionally skipped.
"""

from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_FILE = ROOT / "api.txt"
SAMPLES_DIR = ROOT / "stt_samples"
MANIFEST_FILE = SAMPLES_DIR / "manifest.json"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta/files"
TIMEOUT = 45
TARGET_SECONDS = 5
SKIP_KEY_NUMBERS = {4}

PRIMARY_MODEL = "gemini-3.5-transcribe"
FALLBACK_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
]


def mask_key(key: str) -> str:
    return "***" if len(key) < 10 else f"{key[:4]}...{key[-4:]}"


def read_keys() -> list[tuple[int, str]]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")

    all_keys: list[str] = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in all_keys:
            all_keys.append(key)

    active = [(i, key) for i, key in enumerate(all_keys, 1) if i not in SKIP_KEY_NUMBERS]
    if not active:
        raise SystemExit("[ERROR] no active API keys")
    return active


def load_manifest() -> dict:
    return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))


def download(url: str, destination: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "e-kaiwa-stt-test/3.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        destination.write_bytes(response.read())


def make_five_seconds(source: Path, destination: Path) -> None:
    with wave.open(str(source), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    target_bytes = TARGET_SECONDS * rate * channels * width
    frames = frames[:target_bytes]
    if len(frames) < target_bytes:
        frames += b"\x00" * (target_bytes - len(frames))

    with wave.open(str(destination), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(frames)


def ensure_samples(manifest: dict) -> list[dict]:
    SAMPLES_DIR.mkdir(exist_ok=True)
    repo = manifest["source_repo"]
    rows = manifest["samples"]

    for row in rows:
        target = SAMPLES_DIR / row["file"]
        if target.exists():
            continue

        source_name = row["source_file"]
        temp = SAMPLES_DIR / (source_name + ".download")
        url = f"https://raw.githubusercontent.com/{repo}/main/{source_name}"
        print(f"Downloading {source_name} ...")
        try:
            download(url, temp)
            make_five_seconds(temp, target)
        finally:
            temp.unlink(missing_ok=True)

    return rows


def parse_error(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    try:
        payload = json.loads(text)
        err = payload.get("error", {})
        if isinstance(err, dict):
            status = err.get("status", "")
            msg = err.get("message", "Unknown error")
            return f"{status}: {msg}" if status else str(msg)
    except json.JSONDecodeError:
        pass
    return text[:500]


def extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(
        part.get("text", "")
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ).strip()
    text = re.sub(r"^(transcript|transcription)\s*:\s*", "", text, flags=re.I)
    text = text.strip().strip("`").strip()
    return text


def upload_audio(key: str, audio_path: Path) -> tuple[bool, str, str]:
    raw = audio_path.read_bytes()
    metadata = json.dumps({"file": {"display_name": audio_path.name}}).encode("utf-8")

    start_req = urllib.request.Request(
        UPLOAD_BASE,
        data=metadata,
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(len(raw)),
            "X-Goog-Upload-Header-Content-Type": "audio/wav",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(start_req, timeout=TIMEOUT) as response:
            upload_url = response.headers.get("X-Goog-Upload-URL")
    except urllib.error.HTTPError as exc:
        return False, "", f"upload start HTTP {exc.code} - {parse_error(exc.read())}"
    except (urllib.error.URLError, TimeoutError) as exc:
        return False, "", f"upload start network error - {exc}"

    if not upload_url:
        return False, "", "Files API did not return upload URL"

    upload_req = urllib.request.Request(
        upload_url,
        data=raw,
        headers={
            "Content-Length": str(len(raw)),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
            "Content-Type": "audio/wav",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(upload_req, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        return False, "", f"upload finalize HTTP {exc.code} - {parse_error(exc.read())}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return False, "", f"upload finalize error - {exc}"

    uri = payload.get("file", {}).get("uri", "")
    return (True, uri, "") if uri else (False, "", "uploaded but file URI missing")


def call_generate(key: str, model: str, body: dict) -> tuple[bool, dict, float, str]:
    started = time.perf_counter()
    req = urllib.request.Request(
        f"{API_BASE}/models/{urllib.parse.quote(model, safe='')}:generateContent",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
            return True, payload, time.perf_counter() - started, ""
    except urllib.error.HTTPError as exc:
        return False, {}, time.perf_counter() - started, f"HTTP {exc.code} - {parse_error(exc.read())}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return False, {}, time.perf_counter() - started, f"network/JSON error - {exc}"


def transcribe_primary(key: str, audio_path: Path) -> tuple[bool, str, float, str]:
    started = time.perf_counter()
    ok, file_uri, error = upload_audio(key, audio_path)
    if not ok:
        return False, "", time.perf_counter() - started, error

    body = {
        "contents": [
            {
                "parts": [
                    {
                        "fileData": {
                            "fileUri": file_uri,
                            "mimeType": "audio/wav",
                        }
                    }
                ]
            }
        ]
    }

    ok, payload, call_time, error = call_generate(key, PRIMARY_MODEL, body)
    elapsed = time.perf_counter() - started
    if not ok:
        return False, "", elapsed, error

    text = extract_text(payload)
    if text:
        return True, text, elapsed, ""

    usage = payload.get("usageMetadata", {})
    model_version = payload.get("modelVersion", PRIMARY_MODEL)
    return False, "", elapsed, f"HTTP 200 empty output (model={model_version}; usage={usage})"


def transcribe_fallback(key: str, model: str, audio_path: Path) -> tuple[bool, str, float, str]:
    audio_b64 = base64.b64encode(audio_path.read_bytes()).decode("ascii")
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Transcribe the spoken English in this audio exactly as heard. "
                            "Return ONLY the transcript. Do not explain or correct grammar."
                        )
                    },
                    {
                        "inlineData": {
                            "mimeType": "audio/wav",
                            "data": audio_b64,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 128,
        },
    }

    ok, payload, elapsed, error = call_generate(key, model, body)
    if not ok:
        return False, "", elapsed, error

    text = extract_text(payload)
    if text:
        return True, text, elapsed, ""

    return False, "", elapsed, f"HTTP 200 but output empty; usage={payload.get('usageMetadata', {})}"


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def edit_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def wer(expected: str, actual: str) -> float:
    ref = words(expected)
    return edit_distance(ref, words(actual)) / max(1, len(ref))


def transcribe_with_fallback(key: str, audio_path: Path) -> tuple[bool, str, float, str, list[str]]:
    attempts: list[str] = []
    total = 0.0

    ok, text, elapsed, error = transcribe_primary(key, audio_path)
    total += elapsed
    if ok:
        attempts.append(f"[OK] {PRIMARY_MODEL} {elapsed:.2f}s")
        return True, text, total, PRIMARY_MODEL, attempts

    attempts.append(f"[FAIL] {PRIMARY_MODEL} {elapsed:.2f}s - {error}")

    for model in FALLBACK_MODELS:
        ok, text, elapsed, error = transcribe_fallback(key, model, audio_path)
        total += elapsed
        if ok:
            attempts.append(f"[OK] {model} {elapsed:.2f}s")
            return True, text, total, model, attempts
        attempts.append(f"[FAIL] {model} {elapsed:.2f}s - {error}")

    return False, "", total, "", attempts


def run_fixed_tests(keys: list[tuple[int, str]], rows: list[dict]) -> None:
    print("=" * 84)
    print("E-KAIWA - STT FALLBACK TEST")
    print("=" * 84)
    print(f"Primary  : {PRIMARY_MODEL}")
    print(f"Fallback : {', '.join(FALLBACK_MODELS)}")
    print(f"Keys     : {len(keys)} active / key #4 skipped")
    print()

    successful = 0
    latencies: list[float] = []
    wers: list[float] = []
    model_wins: dict[str, int] = {}

    for index, row in enumerate(rows, 1):
        original_key_number, key = keys[(index - 1) % len(keys)]
        path = SAMPLES_DIR / row["file"]
        expected = row["expected"]

        print(f"[{index}/{len(rows)}] {path.name}  key={original_key_number} [{mask_key(key)}]")
        ok, text, total_latency, model_used, attempts = transcribe_with_fallback(key, path)
        for attempt in attempts:
            print(f"  {attempt}")

        if not ok:
            print("  RESULT   : FAIL - all STT models failed\n")
            continue

        score = wer(expected, text)
        successful += 1
        latencies.append(total_latency)
        wers.append(score)
        model_wins[model_used] = model_wins.get(model_used, 0) + 1

        print(f"  Expected : {expected}")
        print(f"  Got      : {text}")
        print(f"  Used     : {model_used}")
        print(f"  Total    : {total_latency:.2f}s including failed fallback attempts")
        print(f"  WER      : {score * 100:.1f}%\n")

    print("-" * 84)
    print(f"Success        : {successful}/{len(rows)}")
    if latencies:
        print(f"Average latency: {sum(latencies) / len(latencies):.2f}s")
        print(f"Average WER    : {sum(wers) / len(wers) * 100:.1f}%")
        print("Model wins     :")
        for model, count in sorted(model_wins.items(), key=lambda x: (-x[1], x[0])):
            print(f"  {model}: {count}")
    print()


def main() -> int:
    keys = read_keys()
    rows = ensure_samples(load_manifest())
    run_fixed_tests(keys, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
