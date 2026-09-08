from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path

import test_stt
import test_tts

ROOT = Path(__file__).resolve().parent
SAMPLES_DIR = ROOT / "stt_samples"
OUTPUT = ROOT / "full_loop_reply.wav"
STT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"]
LLM_MODEL = "gemini-3.5-flash-lite"
TTS_MODELS = test_tts.TTS_MODELS

TEACHER_MODES = {
    "1": ("Easy", "Correct only mistakes that clearly hurt grammar or understanding. Ignore small unnatural phrasing."),
    "2": ("Normal", "Correct clear grammar mistakes and noticeably unnatural learner English."),
    "3": ("Strict", "Be picky. Correct grammar, tense, articles, prepositions, word choice, and unnatural phrasing when a native speaker would normally say it differently."),
}


def choose_teacher_mode():
    print("Teacher strictness:")
    print("  1 = Easy   - only important mistakes")
    print("  2 = Normal - clear grammar + naturalness issues")
    print("  3 = Strict - picky grammar + natural phrasing")
    raw = input("Choose [1/2/3, default=2]: ").strip() or "2"
    if raw not in TEACHER_MODES:
        raw = "2"
    return TEACHER_MODES[raw]


def choose_audio() -> Path:
    test_stt.ensure_samples(test_stt.load_manifest())
    files = sorted(SAMPLES_DIR.glob("*.wav"))
    if not files:
        raise SystemExit(f"No WAV files found in {SAMPLES_DIR}")

    print("\nAvailable audio:")
    for i, path in enumerate(files, 1):
        print(f"  {i}. {path.name}")

    while True:
        raw = input(f"Choose [1-{len(files)}]: ").strip()
        try:
            choice = int(raw)
            if 1 <= choice <= len(files):
                return files[choice - 1]
        except ValueError:
            pass
        print("Invalid choice.")


def run_stt(keys, audio_path):
    total = 0.0
    for key_no, key in keys:
        for model in STT_MODELS:
            ok, text, dt, error = test_stt.transcribe_fallback(key, model, audio_path)
            total += dt
            if ok:
                print(f"STT  : {model} {dt:.2f}s  key={key_no} [{test_stt.mask_key(key)}]")
                return text, total, key_no, key
            print(f"[STT FAIL] {model} {dt:.2f}s - {error[:150]}")
    return None, total, None, None


def make_turn(key, user_text, teacher_name, teacher_rule):
    prompt = f'''You are a friendly English conversation partner for a Japanese learner.
The learner said: "{user_text}"
Teacher strictness: {teacher_name}
Correction rule: {teacher_rule}

Return ONLY one JSON object with these string fields:
- reply: one short natural spoken English reply, 5-15 words, that responds to the meaning and keeps the conversation going
- correction: corrected natural English version of the learner sentence according to the correction rule; if no correction is needed, copy it unchanged
- explanation_ja: one very short Japanese explanation of the most useful correction; use an empty string if correction is unchanged

Important: the spoken reply must stay friendly and conversational. Never mention grammar mistakes in reply.''' 

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.6,
            "maxOutputTokens": 180,
            "responseMimeType": "application/json",
        },
    }
    status, payload, latency, error = test_tts.post_json(
        f"{test_tts.API_BASE}/models/{LLM_MODEL}:generateContent", body, key
    )
    if status != 200:
        return None, latency, f"HTTP {status or 'network'} - {error}"

    text = test_tts.extract_text(payload).strip().strip("`").strip()
    try:
        obj = json.loads(text)
    except Exception:
        return None, latency, f"invalid JSON: {text[:160]!r}"

    reply = str(obj.get("reply", "")).strip()
    correction = str(obj.get("correction", "")).strip()
    explanation = str(obj.get("explanation_ja", "")).strip()
    if not reply:
        return None, latency, "empty reply"
    return {
        "reply": reply,
        "correction": correction,
        "explanation_ja": explanation,
    }, latency, ""


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
    keys = test_stt.read_keys()

    print("=" * 82)
    print("E-KAIWA - FULL LOOP TEST")
    print("=" * 82)
    print("Flow : WAV -> STT -> LLM(reply + correction) -> TTS(reply only)")
    print("STT  : " + " -> ".join(STT_MODELS))
    print(f"LLM  : {LLM_MODEL}")
    print("TTS  : " + " -> ".join(TTS_MODELS))
    print("Key #4 skipped.\n")

    teacher_name, teacher_rule = choose_teacher_mode()
    print(f"Teacher: {teacher_name}")

    audio_path = choose_audio()
    print(f"\nFILE : {audio_path.name}")

    started = time.perf_counter()

    user_text, stt_latency, key_no, key = run_stt(keys, audio_path)
    if not user_text:
        print("Full loop stopped: STT failed.")
        return 1
    print(f"USER : {user_text}")

    turn, llm_latency, error = make_turn(key, user_text, teacher_name, teacher_rule)
    if not turn:
        print(f"[LLM FAIL] {error}")
        return 1

    print(f"AI   : {turn['reply']}")
    print(f"FIX  : {turn['correction']}")
    if turn["explanation_ja"]:
        print(f"JA   : {turn['explanation_ja']}")
    print(f"LLM  : {llm_latency:.2f}s  key={key_no} [{test_stt.mask_key(key)}]")

    pcm = None
    tts_latency = 0.0
    used_tts = None
    for model in TTS_MODELS:
        audio, dt, tts_error = test_tts.tts_one(key, model, turn["reply"])
        tts_latency += dt
        if audio:
            pcm = audio
            used_tts = model
            print(f"TTS  : {model} {dt:.2f}s")
            break
        print(f"[TTS FAIL] {model} {dt:.2f}s - {tts_error[:160]}")

    if not pcm:
        return 1

    save_wav(pcm)
    api_total = stt_latency + llm_latency + tts_latency
    wall_total = time.perf_counter() - started
    print("-" * 82)
    print(f"Teacher   : {teacher_name}")
    print(f"STT total : {stt_latency:.2f}s")
    print(f"LLM       : {llm_latency:.2f}s")
    print(f"TTS total : {tts_latency:.2f}s ({used_tts})")
    print(f"API TOTAL : {api_total:.2f}s")
    print(f"WALL TOTAL: {wall_total:.2f}s")
    print(f"WAV       : {OUTPUT.name}")
    print("\nPlaying AI reply only...\n")
    play_wav()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
