from __future__ import annotations

import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_FILE = ROOT / "api.txt"
OUTPUT = ROOT / "tts_test_output.wav"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
LLM_MODEL = "gemini-3.5-flash-lite"
TTS_MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"]
VOICE = "Achird"  # Friendly
SKIP_KEYS = {4}
TIMEOUT = 45


def read_keys():
    raw = [
        x.strip()
        for x in API_FILE.read_text(encoding="utf-8-sig").splitlines()
        if x.strip() and not x.strip().startswith("#")
    ]
    keys = [(i, k) for i, k in enumerate(raw, 1) if i not in SKIP_KEYS]
    if not keys:
        raise SystemExit("No active Gemini API key found.")
    return keys


def mask(key):
    return f"{key[:4]}...{key[-4:]}"


def post_json(url, body, key):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace")), time.perf_counter() - started, ""
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            obj = json.loads(raw)
            err = obj.get("error", {})
            msg = f"{err.get('status', '')}: {err.get('message', 'Unknown error')}".strip(": ")
        except Exception:
            msg = raw[:400]
        return e.code, {}, time.perf_counter() - started, msg
    except Exception as e:
        return 0, {}, time.perf_counter() - started, str(e)


def extract_text(payload):
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(
        p.get("text", "")
        for p in parts
        if isinstance(p, dict) and isinstance(p.get("text"), str)
    ).strip()


def make_reply(key, user_text):
    prompt = f'''You are a friendly English conversation partner for a Japanese learner.
The learner just said: "{user_text}"
Reply naturally to the meaning and keep the conversation going.
Use exactly ONE short spoken English sentence, about 5-15 words.
Do not explain grammar. Do not mention mistakes. Do not sound like a teacher.
Return only the sentence you would say aloud.'''

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 60},
    }
    status, payload, latency, error = post_json(
        f"{API_BASE}/models/{LLM_MODEL}:generateContent", body, key
    )
    if status != 200:
        return None, latency, f"HTTP {status or 'network'} - {error}"
    reply = extract_text(payload).strip().strip('"')
    if not reply:
        return None, latency, "empty reply"
    return reply, latency, ""


def tts_one(key, model, reply):
    prompt = (
        "Speak the following line as a friendly conversation partner. "
        "Use natural everyday American English, warm tone, clear pronunciation, "
        "medium conversational pace, and natural intonation. Do not sound like a narrator or teacher.\n\n"
        f"{reply}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "languageCode": "en-US",
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": VOICE}
                },
            },
        },
    }
    status, payload, latency, error = post_json(
        f"{API_BASE}/models/{model}:generateContent", body, key
    )
    if status != 200:
        return None, latency, f"HTTP {status or 'network'} - {error}"

    candidates = payload.get("candidates") or []
    if not candidates:
        return None, latency, "no candidate/audio"
    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline = part.get("inlineData") or part.get("inline_data")
        if isinstance(inline, dict) and inline.get("data"):
            try:
                return base64.b64decode(inline["data"]), latency, ""
            except Exception as e:
                return None, latency, f"base64 decode error: {e}"
    return None, latency, "HTTP 200 but audio is empty"


def save_wav(pcm):
    with wave.open(str(OUTPUT), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)


def play_wav():
    if sys.platform.startswith("win"):
        import winsound
        winsound.PlaySound(str(OUTPUT), winsound.SND_FILENAME)
    else:
        print(f"Saved: {OUTPUT}")


def main():
    keys = read_keys()
    default = "Yesterday I go shopping with my friend."

    print("=" * 78)
    print("E-KAIWA - LLM -> TTS CONVERSATION TEST")
    print("=" * 78)
    print(f"LLM   : {LLM_MODEL}")
    print("TTS   : " + " -> ".join(TTS_MODELS))
    print(f"Voice : {VOICE} (friendly, en-US)")
    print("Key #4 skipped.\n")

    user_text = input(f"User sentence [Enter = {default}]\n> ").strip() or default
    print(f"\nUSER : {user_text}")

    reply = None
    llm_latency = 0.0
    selected = None
    for key_no, key in keys:
        reply, llm_latency, error = make_reply(key, user_text)
        if reply:
            selected = (key_no, key)
            print(f"AI   : {reply}")
            print(f"LLM  : {llm_latency:.2f}s  key={key_no} [{mask(key)}]")
            break
        print(f"[LLM FAIL] key={key_no} {error[:180]}")

    if not reply or not selected:
        return 1

    key_no, key = selected
    pcm = None
    tts_latency = 0.0
    used_model = None
    for model in TTS_MODELS:
        pcm, dt, error = tts_one(key, model, reply)
        tts_latency += dt
        if pcm:
            used_model = model
            print(f"TTS  : {model} {dt:.2f}s")
            break
        print(f"[TTS FAIL] {model} {dt:.2f}s - {error[:180]}")

    if not pcm:
        return 1

    save_wav(pcm)
    print(f"TOTAL: {llm_latency + tts_latency:.2f}s")
    print(f"WAV  : {OUTPUT.name}")
    print("\nPlaying reply...\n")
    play_wav()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
