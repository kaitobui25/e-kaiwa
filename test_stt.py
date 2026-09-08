"""Simple STT smoke test for e-kaiwa.

- Reads Gemini keys from ./api.txt
- Downloads five public Japanese-speaker English WAV samples on first run
- Pads/trims each to 5 seconds and keeps them in ./stt_samples
- Sends them to gemini-3.5-transcribe
- Prints transcript, latency, and word error rate (WER)
- Optionally records 5 seconds from the local microphone

No extra package is needed for the fixed samples. The optional mic test uses
sounddevice + numpy, which are already in this project's requirements.
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
MODEL = "gemini-3.5-transcribe"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = 30
TARGET_SECONDS = 5


def read_keys() -> list[str]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")
    keys = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in keys:
            keys.append(key)
    if not keys:
        raise SystemExit("[ERROR] api.txt has no API keys")
    return keys


def load_manifest() -> dict:
    if not MANIFEST_FILE.exists():
        raise SystemExit(f"[ERROR] missing {MANIFEST_FILE}")
    return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "e-kaiwa-stt-test/1.0"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        destination.write_bytes(response.read())


def make_five_seconds(source: Path, destination: Path) -> None:
    """Copy WAV audio and pad/trim it to exactly five seconds."""
    with wave.open(str(source), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())

    bytes_per_frame = channels * width
    target_bytes = TARGET_SECONDS * rate * bytes_per_frame
    if len(frames) < target_bytes:
        frames += b"\x00" * (target_bytes - len(frames))
    else:
        frames = frames[:target_bytes]

    with wave.open(str(destination), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(frames)


def ensure_samples(manifest: dict) -> list[dict]:
    SAMPLES_DIR.mkdir(exist_ok=True)
    repo = manifest["source_repo"]
    rows = manifest["samples"]

    print("Preparing 5 Japanese-speaker English samples...")
    for row in rows:
        target = SAMPLES_DIR / row["file"]
        if target.exists():
            continue

        source_name = row["source_file"]
        url = f"https://raw.githubusercontent.com/{repo}/main/{source_name}"
        temp = SAMPLES_DIR / (source_name + ".download")
        print(f"  downloading {source_name}")
        try:
            download(url, temp)
            make_five_seconds(temp, target)
        finally:
            temp.unlink(missing_ok=True)

    print("Samples ready.\n")
    return rows


def api_post(url: str, body: dict) -> tuple[int, dict, float]:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
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
    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    if isinstance(error, dict):
        status = error.get("status")
        message = error.get("message", "Unknown error")
        return f"{status}: {message}" if status else str(message)
    return str(error)


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
    text = text.removeprefix("```").removesuffix("```").strip()
    return text


def transcribe_one_key(key: str, audio_path: Path) -> tuple[bool, str, float, str]:
    audio = base64.b64encode(audio_path.read_bytes()).decode("ascii")
    url = (
        f"{API_BASE}/models/{urllib.parse.quote(MODEL, safe='')}:generateContent"
        f"?key={urllib.parse.quote(key)}"
    )
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Transcribe only the spoken English in this audio. "
                            "Return only the transcript, no explanation."
                        )
                    },
                    {"inlineData": {"mimeType": "audio/wav", "data": audio}},
                ],
            }
        ],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 100},
    }
    status, payload, elapsed = api_post(url, body)
    if status != 200:
        return False, "", elapsed, f"HTTP {status or 'network'} - {error_message(payload)}"
    text = extract_text(payload)
    if not text:
        return False, "", elapsed, "HTTP 200 but transcript is empty"
    return True, text, elapsed, ""


def transcribe(keys: list[str], audio_path: Path) -> tuple[bool, str, float, str, int]:
    total = 0.0
    last_error = ""
    for index, key in enumerate(keys, start=1):
        ok, text, elapsed, error = transcribe_one_key(key, audio_path)
        total += elapsed
        if ok:
            return True, text, total, "", index
        last_error = error
    return False, "", total, last_error, len(keys)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def edit_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, start=1):
        current = [i]
        for j, right in enumerate(b, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + (left != right),
                )
            )
        previous = current
    return previous[-1]


def wer(expected: str, actual: str) -> float:
    reference = words(expected)
    hypothesis = words(actual)
    return edit_distance(reference, hypothesis) / max(1, len(reference))


def run_fixed_tests(keys: list[str], rows: list[dict]) -> None:
    print("=" * 76)
    print("E-KAIWA - GEMINI STT TEST")
    print("=" * 76)
    print(f"Model : {MODEL}")
    print(f"Keys  : {len(keys)}")
    print()

    successful = 0
    latencies = []
    wers = []

    for index, row in enumerate(rows, start=1):
        path = SAMPLES_DIR / row["file"]
        expected = row["expected"]
        print(f"[{index}/5] {path.name}")

        ok, text, latency, error, key_index = transcribe(keys, path)
        if not ok:
            print(f"  [FAIL] {error}\n")
            continue

        score = wer(expected, text)
        successful += 1
        latencies.append(latency)
        wers.append(score)
        print(f"  Expected : {expected}")
        print(f"  Got      : {text}")
        print(f"  Latency  : {latency:.2f}s (key {key_index})")
        print(f"  WER      : {score * 100:.1f}%")
        print()

    print("-" * 76)
    print(f"API success    : {successful}/5")
    if latencies:
        print(f"Average latency: {sum(latencies) / len(latencies):.2f}s")
        print(f"Average WER    : {sum(wers) / len(wers) * 100:.1f}%")
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

    temp = ROOT / "_mic_stt_test.wav"
    try:
        record_mic(temp)
        if not temp.exists():
            return
        ok, text, latency, error, key_index = transcribe(keys, temp)
        if ok:
            print(f"[OK] Transcript: {text}")
            print(f"     Latency   : {latency:.2f}s (key {key_index})")
        else:
            print(f"[FAIL] {error}")
    finally:
        temp.unlink(missing_ok=True)


def main() -> int:
    keys = read_keys()
    manifest = load_manifest()
    rows = ensure_samples(manifest)
    run_fixed_tests(keys, rows)
    optional_mic_test(keys)
    print("\nSTT test finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
