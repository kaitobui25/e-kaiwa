from __future__ import annotations

import json
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

import test_pronunciation
import test_stt
import test_tts

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
SAMPLES_DIR = ROOT / "stt_samples"
LOG_ROOT = PROJECT_ROOT / "runtime_logs"
STT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"]
LLM_MODEL = "gemini-3.5-flash-lite"
TTS_MODELS = test_tts.TTS_MODELS
MIC_SAMPLE_RATE = 16000

TEACHER_MODES = {
    "1": ("Easy", "Correct only mistakes that clearly hurt grammar or understanding. Ignore small unnatural phrasing."),
    "2": ("Normal", "Correct clear grammar mistakes and noticeably unnatural learner English."),
    "3": ("Strict", "Be picky. Correct grammar, tense, articles, prepositions, word choice, and unnatural phrasing when a native speaker would normally say it differently."),
}


class SessionLogger:
    def __init__(self, mode, teacher_name, pronunciation_enabled):
        now = datetime.now().astimezone()
        day_dir = LOG_ROOT / now.strftime("%Y-%m-%d")
        base_name = f"{now:%Y%m%d_%H%M%S}_{mode}"
        session_dir = day_dir / base_name
        suffix = 2
        while session_dir.exists():
            session_dir = day_dir / f"{base_name}_{suffix}"
            suffix += 1

        session_dir.mkdir(parents=True, exist_ok=False)
        self.session_dir = session_dir
        self.log_path = session_dir / "conversation.jsonl"
        self.event(
            "session_start",
            mode=mode,
            teacher=teacher_name,
            pronunciation_enabled=pronunciation_enabled,
        )

    def event(self, event_name, **data):
        row = {
            "ts": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "event": event_name,
            **data,
        }
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def relative(self, path):
        try:
            return str(Path(path).resolve().relative_to(PROJECT_ROOT.resolve()))
        except Exception:
            return str(path)


def choose_teacher_mode():
    print("Teacher strictness:")
    print("  1 = Easy   - only important mistakes")
    print("  2 = Normal - clear grammar + naturalness issues")
    print("  3 = Strict - picky grammar + natural phrasing")
    raw = input("Choose [1/2/3, default=2]: ").strip() or "2"
    if raw not in TEACHER_MODES:
        raw = "2"
    name, rule = TEACHER_MODES[raw]
    return raw, name, rule


def choose_pronunciation_enabled():
    print("\nPronunciation scoring:")
    print("  Y = ON  - score + pronunciation problems + Japanese tips (default)")
    print("  N = OFF - skip pronunciation analysis for lower latency")
    raw = input("Choose [Y/n, default=Y]: ").strip().lower()
    return raw not in {"n", "no", "0", "off"}


def choose_input_mode():
    print("\nInput mode:")
    print("  1 = Audio file - choose a WAV sample and run one turn")
    print("  2 = Microphone - live multi-turn conversation")
    raw = input("Choose [1/2, default=2]: ").strip() or "2"
    return "file" if raw == "1" else "mic"


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


def record_microphone(output_path):
    try:
        import numpy as np
        import sounddevice as sd
    except Exception as exc:
        return False, 0.0, f"microphone dependencies unavailable: {exc}"

    chunks = []
    statuses = []

    def callback(indata, frames, time_info, status):
        if status:
            statuses.append(str(status))
        chunks.append(indata.copy())

    try:
        with sd.InputStream(
            samplerate=MIC_SAMPLE_RATE,
            channels=1,
            dtype="int16",
            callback=callback,
        ):
            print("Recording... speak now. Press Enter to stop.")
            started = time.perf_counter()
            input()
            duration = time.perf_counter() - started
    except Exception as exc:
        return False, 0.0, str(exc)

    if not chunks:
        return False, 0.0, "microphone captured no audio"

    audio = np.concatenate(chunks, axis=0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(MIC_SAMPLE_RATE)
        wf.writeframes(audio.tobytes())

    if statuses:
        print(f"[MIC WARN] {statuses[-1]}")

    print(f"MIC  : {duration:.1f}s -> {output_path.name}")
    return True, duration, ""


def reference_for_audio(audio_path, fallback_text):
    try:
        rows = test_stt.load_manifest().get("samples", [])
        for row in rows:
            if row.get("file") == audio_path.name and row.get("expected"):
                return str(row["expected"])
    except Exception:
        pass
    return fallback_text


def run_stt(keys, audio_path):
    total = 0.0
    for key_no, key in keys:
        for model in STT_MODELS:
            ok, text, dt, error = test_stt.transcribe_fallback(key, model, audio_path)
            total += dt
            if ok:
                print(f"STT  : {model} {dt:.2f}s  key={key_no} [{test_stt.mask_key(key)}]")
                return text, total, key_no, key, model
            print(f"[STT FAIL] {model} {dt:.2f}s - {error[:150]}")
    return None, total, None, None, None


def run_pronunciation(key, audio_path, reference, teacher_choice):
    mode = test_pronunciation.STRICTNESS[teacher_choice]
    total = 0.0
    for model in test_pronunciation.MODELS:
        result, dt, error = test_pronunciation.analyze(key, model, audio_path, reference, mode)
        total += dt
        if result is not None:
            print(f"PRON : {model} {dt:.2f}s")
            print(
                "SCORE: "
                f"overall={test_pronunciation.score(result.get('overall_score'))}  "
                f"pronunciation={test_pronunciation.score(result.get('pronunciation_score'))}  "
                f"fluency={test_pronunciation.score(result.get('fluency_score'))}  "
                f"intonation={test_pronunciation.score(result.get('intonation_score'))}"
            )
            problems = result.get("problems") or []
            if not problems:
                print("PRON FIX: none clearly detected")
            else:
                print("PRON FIX:")
                for p in problems[:mode["max_problems"]]:
                    heard = f" heard≈{p.get('heard_like')}" if p.get("heard_like") else ""
                    print(
                        f"  [{str(p.get('severity', 'yellow')).upper()}] "
                        f"{p.get('word', '?')} [{p.get('sound', '')}]" + heard
                    )
                    if p.get("tip_ja"):
                        print(f"           -> {p['tip_ja']}")
            if result.get("summary_ja"):
                print(f"PRON JA: {result['summary_ja']}")
            return result, total, model
        print(f"[PRON FAIL] {model} {dt:.2f}s - {error[:160]}")
    return None, total, None


def make_turn(key, user_text, teacher_name, teacher_rule, history):
    recent = history[-4:]
    if recent:
        context = "\n".join(
            f"Learner: {item['user']}\nPartner: {item['ai']}" for item in recent
        )
    else:
        context = "(first turn)"

    prompt = f'''You are a friendly English conversation partner for a Japanese learner.

Recent conversation:
{context}

The learner now said: "{user_text}"
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


def synthesize_reply(key, text):
    total = 0.0
    for model in TTS_MODELS:
        audio, dt, error = test_tts.tts_one(key, model, text)
        total += dt
        if audio:
            print(f"TTS  : {model} {dt:.2f}s")
            return audio, total, model, ""
        print(f"[TTS FAIL] {model} {dt:.2f}s - {error[:160]}")
    return None, total, None, "all TTS models failed"


def save_wav(pcm, output_path, sample_rate=24000):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)


def play_wav(output_path):
    if sys.platform.startswith("win"):
        import winsound
        winsound.PlaySound(str(output_path), winsound.SND_FILENAME)
    else:
        print(f"Saved: {output_path}")


def run_one_turn(
    keys,
    audio_path,
    teacher_choice,
    teacher_name,
    teacher_rule,
    pronunciation_enabled,
    logger,
    turn_no,
    history,
):
    print(f"\nFILE : {audio_path.name}")
    started = time.perf_counter()

    user_text, stt_latency, key_no, key, stt_model = run_stt(keys, audio_path)
    if not user_text:
        print("Turn stopped: STT failed.")
        logger.event(
            "error",
            turn=turn_no,
            stage="stt",
            audio=logger.relative(audio_path),
            latency_s=round(stt_latency, 3),
        )
        return False

    print(f"USER : {user_text}")

    pron_result = None
    pron_latency = 0.0
    pron_model = None
    reference = reference_for_audio(audio_path, user_text)
    if pronunciation_enabled:
        if reference != user_text:
            print(f"TARGET: {reference}")
        pron_result, pron_latency, pron_model = run_pronunciation(
            key, audio_path, reference, teacher_choice
        )

    turn, llm_latency, error = make_turn(
        key, user_text, teacher_name, teacher_rule, history
    )
    if not turn:
        print(f"[LLM FAIL] {error}")
        logger.event(
            "error",
            turn=turn_no,
            stage="llm",
            user_text=user_text,
            message=error,
            latency_s=round(llm_latency, 3),
        )
        return False

    print(f"AI   : {turn['reply']}")
    print(f"FIX  : {turn['correction']}")
    if turn["explanation_ja"]:
        print(f"JA   : {turn['explanation_ja']}")
    print(f"LLM  : {llm_latency:.2f}s  key={key_no} [{test_stt.mask_key(key)}]")

    pcm, tts_latency, used_tts, tts_error = synthesize_reply(key, turn["reply"])
    if not pcm:
        logger.event(
            "error",
            turn=turn_no,
            stage="tts",
            user_text=user_text,
            ai_reply=turn["reply"],
            message=tts_error,
            latency_s=round(tts_latency, 3),
        )
        return False

    ai_wav = logger.session_dir / f"turn_{turn_no:03d}_ai.wav"
    save_wav(pcm, ai_wav)

    api_total = stt_latency + pron_latency + llm_latency + tts_latency
    wall_total = time.perf_counter() - started
    print("-" * 82)
    print(f"STT total : {stt_latency:.2f}s")
    if pronunciation_enabled:
        suffix = f" ({pron_model})" if pron_model else " (failed)"
        print(f"PRON total: {pron_latency:.2f}s{suffix}")
    print(f"LLM       : {llm_latency:.2f}s")
    print(f"TTS total : {tts_latency:.2f}s ({used_tts})")
    print(f"API TOTAL : {api_total:.2f}s")
    print(f"WALL TOTAL: {wall_total:.2f}s")

    logger.event(
        "turn",
        turn=turn_no,
        input_audio=logger.relative(audio_path),
        ai_audio=logger.relative(ai_wav),
        user_text=user_text,
        ai_reply=turn["reply"],
        correction=turn["correction"],
        explanation_ja=turn["explanation_ja"],
        teacher=teacher_name,
        stt={
            "model": stt_model,
            "key_slot": key_no,
            "latency_s": round(stt_latency, 3),
        },
        pronunciation={
            "enabled": pronunciation_enabled,
            "reference": reference if pronunciation_enabled else None,
            "model": pron_model,
            "latency_s": round(pron_latency, 3),
            "result": pron_result,
        },
        llm={
            "model": LLM_MODEL,
            "latency_s": round(llm_latency, 3),
        },
        tts={
            "model": used_tts,
            "latency_s": round(tts_latency, 3),
        },
        api_total_s=round(api_total, 3),
        wall_total_s=round(wall_total, 3),
    )

    history.append({"user": user_text, "ai": turn["reply"]})
    print("\nPlaying AI reply only...\n")
    play_wav(ai_wav)
    return True


def run_file_mode(
    keys,
    teacher_choice,
    teacher_name,
    teacher_rule,
    pronunciation_enabled,
    logger,
):
    audio_path = choose_audio()
    history = []
    ok = run_one_turn(
        keys,
        audio_path,
        teacher_choice,
        teacher_name,
        teacher_rule,
        pronunciation_enabled,
        logger,
        1,
        history,
    )
    logger.event("session_end", successful_turns=1 if ok else 0, reason="file_complete")
    return 0 if ok else 1


def run_mic_mode(
    keys,
    teacher_choice,
    teacher_name,
    teacher_rule,
    pronunciation_enabled,
    logger,
):
    history = []
    successful_turns = 0
    turn_no = 1

    print("\nMic conversation controls:")
    print("  Enter = record next turn")
    print("  q     = end conversation")
    print("  While recording, press Enter again to stop.")

    while True:
        raw = input("\n[Enter] speak | q = quit: ").strip().lower()
        if raw in {"q", "quit", "exit"}:
            logger.event(
                "session_end",
                successful_turns=successful_turns,
                reason="user_quit",
            )
            print("Conversation ended.")
            return 0

        user_wav = logger.session_dir / f"turn_{turn_no:03d}_user.wav"
        ok, duration, error = record_microphone(user_wav)
        if not ok:
            print(f"[MIC FAIL] {error}")
            logger.event(
                "error",
                turn=turn_no,
                stage="microphone",
                message=error,
            )
            turn_no += 1
            continue

        logger.event(
            "audio_recorded",
            turn=turn_no,
            audio=logger.relative(user_wav),
            duration_s=round(duration, 3),
            sample_rate=MIC_SAMPLE_RATE,
        )

        if run_one_turn(
            keys,
            user_wav,
            teacher_choice,
            teacher_name,
            teacher_rule,
            pronunciation_enabled,
            logger,
            turn_no,
            history,
        ):
            successful_turns += 1

        turn_no += 1


def main():
    keys = test_stt.read_keys()

    print("=" * 82)
    print("E-KAIWA - FULL LOOP TEST")
    print("=" * 82)
    print("STT  : " + " -> ".join(STT_MODELS))
    print(f"LLM  : {LLM_MODEL}")
    print("TTS  : " + " -> ".join(TTS_MODELS))
    print("Key #4 skipped.")

    teacher_choice, teacher_name, teacher_rule = choose_teacher_mode()
    pronunciation_enabled = choose_pronunciation_enabled()
    input_mode = choose_input_mode()

    print(f"\nTeacher      : {teacher_name}")
    print(f"Pronunciation: {'ON' if pronunciation_enabled else 'OFF'}")
    print(f"Input        : {'Audio file' if input_mode == 'file' else 'Microphone'}")
    if input_mode == "file":
        print("Flow         : WAV -> STT -> pronunciation(optional) -> LLM -> TTS")
    else:
        print("Flow         : MIC -> STT -> pronunciation(optional) -> LLM -> TTS -> repeat")

    logger = SessionLogger(input_mode, teacher_name, pronunciation_enabled)
    print(f"Session log  : {logger.log_path}")

    try:
        if input_mode == "file":
            return run_file_mode(
                keys,
                teacher_choice,
                teacher_name,
                teacher_rule,
                pronunciation_enabled,
                logger,
            )
        return run_mic_mode(
            keys,
            teacher_choice,
            teacher_name,
            teacher_rule,
            pronunciation_enabled,
            logger,
        )
    except KeyboardInterrupt:
        print("\nInterrupted.")
        logger.event("session_end", reason="keyboard_interrupt")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
