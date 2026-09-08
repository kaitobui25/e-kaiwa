"""Simple Gemini STT test for e-kaiwa.

- Reads Gemini keys from ./api.txt
- Downloads five Japanese-speaker English WAV samples on first run
- Pads/trims each to 5 seconds
- Uses the official Gemini Files API, then gemini-3.5-transcribe
- Uses ONE active key per sample (round-robin) so empty responses do not burn all keys
- Skips known-dead API key positions listed in SKIP_KEY_NUMBERS
- Prints transcript, latency, and WER
- Optionally records 5 seconds from the local microphone

No extra package is needed for the fixed samples. Optional mic test uses
sounddevice + numpy, already present in this project.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_FILE = ROOT / "api.txt"
SAMPLES_DIR = ROOT / "stt_samples"
MANIFEST_FILE = SAMPLES_DIR / "manifest.json"
MODEL = "gemini-3.5-transcribe"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta/files"
TIMEOUT = 45
TARGET_SECONDS = 5

# api.txt key positions to ignore. User confirmed key #4 is dead.
SKIP_KEY_NUMBERS = {4}


def read_keys() -> list[str]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")
    keys: list[str] = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in keys:
            keys.append(key)
    if not keys:
        raise SystemExit("[ERROR] api.txt has no API keys")
    return keys


def active_keys(keys: list[str]) -> list[tuple[int, str]]:
    active = [(index, key) for index, key in enumerate(keys, start=1) if index not in SKIP_KEY_NUMBERS]
    if not active:
        raise SystemExit("[ERROR] no active API keys left after SKIP_KEY_NUMBERS")
    return active


def mask_key(key: str) -> str:
    return "***" if len(key) < 10 else f"{key[:4]}...{key[-4:]}"


def load_manifest() -> dict:
    if not MANIFEST_FILE.exists():
        raise SystemExit(f"[ERROR] missing {MANIFEST_FILE}")
    return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))


def download(url: str, destination: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "e-kaiwa-stt-test/2.0"})
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
        url = f"https://raw.githubusercontent.com/{repo}/main/{source_name}"
        temp = SAMPLES_DIR / (source_name + ".download")
        print(f"Downloading {source_name} ...")
        try:
            download(url, temp)
            make_five_seconds(temp, target)
        finally:
            temp.unlink(missing_ok=True)
    return rows


def parse_error(payload: bytes) -> str:
    text = payload.decode("utf-8", errors="replace")
    try:
        obj = json.loads(text)
        err = obj.get("error", {})
        if isinstance(err, dict):
            status = err.get("status", "")
            message = err.get("message", "Unknown error")
            return f"{status}: {message}" if status else str(message)
    except json.JSONDecodeError:
        pass
    return text[:500]


def upload_audio(key: str, audio_path: Path) -> tuple[bool, str, str]:
    """Upload WAV with the official resumable Files API. Returns (ok, uri, error)."""
    raw = audio_path.read_bytes()
    mime = "audio/wav"

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
            "X-Goog-Upload-Header-Content-Type": mime,
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
        return False, "", "Files API did not return X-Goog-Upload-URL"

    upload_req = urllib.request.Request(
        upload_url,
        data=raw,
        headers={
            "Content-Length": str(len(raw)),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
            "Content-Type": mime,
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
    if not uri:
        return False, "", "Files API upload succeeded but file URI is missing"
    return True, uri, ""


def extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(
        p.get("text", "")
        for p in parts
        if isinstance(p, dict) and isinstance(p.get("text"), str)
    ).strip()
    text = re.sub(r"^(transcript|transcription)\s*:\s*", "", text, flags=re.I)
    return text.strip()


def transcribe_one(key: str, audio_path: Path) -> tuple[bool, str, float, str]:
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

    req = urllib.request.Request(
        f"{API_BASE}/models/{MODEL}:generateContent",
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
            status = response.status
    except urllib.error.HTTPError as exc:
        elapsed = time.perf_counter() - started
        return False, "", elapsed, f"HTTP {exc.code} - {parse_error(exc.read())}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return False, "", time.perf_counter() - started, f"network/JSON error - {exc}"

    elapsed = time.perf_counter() - started
    text = extract_text(payload)
    if status == 200 and not text:
        details = []
        if payload.get("modelVersion"):
            details.append(f"model={payload['modelVersion']}")
        usage = payload.get("usageMetadata", {})
        if usage:
            details.append(f"usage={usage}")
        suffix = f" ({'; '.join(details)})" if details else ""
        return False, "", elapsed, "HTTP 200 but transcript is empty" + suffix

    return True, text, elapsed, ""


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def edit_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, start=1):
        current = [i]
        for j, right in enumerate(b, start=1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def wer(expected: str, actual: str) -> float:
    ref = words(expected)
    hyp = words(actual)
    return edit_distance(ref, hyp) / max(1, len(ref))


def run_fixed_tests(keys: list[str], rows: list[dict]) -> None:
    usable = active_keys(keys)

    print("=" * 76)
    print("E-KAIWA - GEMINI STT TEST v2")
    print("=" * 76)
    print(f"Model : {MODEL}")
    print(f"Keys  : {len(usable)} active / {len(keys)} total")
    print(f"Skip  : {', '.join('#' + str(n) for n in sorted(SKIP_KEY_NUMBERS))}")
    print("Mode  : Files API; one active key per audio (no retry storm)\n")

    successful = 0
    latencies: list[float] = []
    wers: list[float] = []

    for index, row in enumerate(rows, start=1):
        path = SAMPLES_DIR / row["file"]
        expected = row["expected"]
        original_key_number, key = usable[(index - 1) % len(usable)]

        print(f"[{index}/{len(rows)}] {path.name}  key={original_key_number} [{mask_key(key)}]")
        ok, text, latency, error = transcribe_one(key, path)
        if not ok:
            print(f"  [FAIL] {error}\n")
            continue

        score = wer(expected, text)
        successful += 1
        latencies.append(latency)
        wers.append(score)
        print(f"  Expected : {expected}")
        print(f"  Got      : {text}")
        print(f"  Latency  : {latency:.2f}s")
        print(f"  WER      : {score * 100:.1f}%\n")

    print("-" * 76)
    print(f"API success    : {successful}/{len(rows)}")
    if latencies:
        print(f"Average latency: {sum(latencies) / len(latencies):.2f}s")
        print(f"Average WER    : {sum(wers) / len(wers) * 100:.1f}%")
    else:
        print("No transcript returned. Do not keep retrying automatically; it only burns quota.")
    print()


def record_mic(path: Path) -> None:
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError:
        print("[ERROR] mic test needs sounddevice + numpy. Run run.bat first.")
        return

    rate = 16000
    print("Speak English now... recording 5 seconds.")
    audio = sd.rec(rate * TARGET_SECONDS, samplerate=rate, channels=1, dtype="int16")
    sd.wait()
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(np.asarray(audio, dtype=np.int16).tobytes())


def optional_mic_test(keys: list[str]) -> None:
    if input("Test microphone too? (y/n): ").strip().lower() != "y":
        return

    original_key_number, key = active_keys(keys)[0]
    temp = ROOT / "_mic_stt_test.wav"
    try:
        record_mic(temp)
        if not temp.exists():
            return
        ok, text, latency, error = transcribe_one(key, temp)
        if ok:
            print(f"[OK] Transcript: {text}")
            print(f"     Latency   : {latency:.2f}s (key {original_key_number})")
        else:
            print(f"[FAIL] {error}")
    finally:
        temp.unlink(missing_ok=True)


def main() -> int:
    keys = read_keys()
    rows = ensure_samples(load_manifest())
    run_fixed_tests(keys, rows)
    optional_mic_test(keys)
    print("\nSTT test finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
