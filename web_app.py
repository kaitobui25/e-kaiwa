from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

import gradio as gr
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent
TESTS_DIR = PROJECT_ROOT / "tests"
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

import test_full_loop as full  # noqa: E402
import test_pronunciation  # noqa: E402

API_FILE = PROJECT_ROOT / "api.txt"
LOG_ROOT = PROJECT_ROOT / "runtime_logs"
SKIP_KEY_NUMBERS = {4}

TEACHER_UI = {
    "Easy": "1",
    "Normal": "2",
    "Strict": "3",
}


def read_keys() -> list[tuple[int, str]]:
    if not API_FILE.exists():
        raise SystemExit(f"[ERROR] api.txt not found: {API_FILE}")

    unique: list[str] = []
    for raw in API_FILE.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in unique:
            unique.append(key)

    active = [(i, key) for i, key in enumerate(unique, 1) if i not in SKIP_KEY_NUMBERS]
    if not active:
        raise SystemExit("[ERROR] no active API keys")
    return active


def new_session() -> dict:
    now = datetime.now().astimezone()
    day_dir = LOG_ROOT / now.strftime("%Y-%m-%d")
    base_name = f"{now:%Y%m%d_%H%M%S}_web"
    session_dir = day_dir / base_name
    suffix = 2
    while session_dir.exists():
        session_dir = day_dir / f"{base_name}_{suffix}"
        suffix += 1
    session_dir.mkdir(parents=True, exist_ok=False)

    state = {
        "session_dir": str(session_dir),
        "turn": 1,
        "history": [],
        "started": now.isoformat(timespec="milliseconds"),
    }
    log_event(state, "session_start", mode="web_mic")
    return state


def log_event(state: dict, event: str, **data) -> None:
    session_dir = Path(state["session_dir"])
    row = {
        "ts": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "event": event,
        **data,
    }
    with (session_dir / "conversation.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def save_browser_audio(audio: tuple[int, np.ndarray], output_path: Path) -> float:
    sample_rate, samples = audio
    array = np.asarray(samples)

    if array.ndim == 2:
        array = array.mean(axis=1)
    if array.dtype != np.int16:
        if np.issubdtype(array.dtype, np.floating):
            array = np.clip(array, -1.0, 1.0)
            array = (array * 32767).astype(np.int16)
        else:
            array = np.clip(array, -32768, 32767).astype(np.int16)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(array.tobytes())

    return len(array) / max(1, int(sample_rate))


def conversation_markdown(history: list[dict]) -> str:
    if not history:
        return "_No conversation yet._"

    blocks = []
    for item in history[-6:]:
        blocks.append(f"**You:** {item['user']}\n\n**AI:** {item['ai']}")
    return "\n\n---\n\n".join(blocks)


def pronunciation_markdown(result: dict | None) -> str:
    if not result:
        return "Pronunciation feedback unavailable."

    overall = test_pronunciation.score(result.get("overall_score"))
    pron = test_pronunciation.score(result.get("pronunciation_score"))
    fluency = test_pronunciation.score(result.get("fluency_score"))
    intonation = test_pronunciation.score(result.get("intonation_score"))

    lines = [
        f"**Score:** {overall} · pronunciation {pron} · fluency {fluency} · intonation {intonation}"
    ]
    problems = result.get("problems") or []
    for problem in problems[:3]:
        word = problem.get("word", "?")
        sound = problem.get("sound", "")
        tip = problem.get("tip_ja", "")
        lines.append(f"- **{word}** {sound} — {tip}".strip())
    if result.get("summary_ja"):
        lines.append(f"\n{result['summary_ja']}")
    return "\n".join(lines)


def process_turn(audio, state, teacher_name: str, pronunciation_enabled: bool):
    if audio is None:
        return (
            conversation_markdown((state or {}).get("history", [])),
            "",
            "",
            None,
            "Record something first.",
            state,
            None,
        )

    if not state or not state.get("session_dir"):
        state = new_session()

    turn_no = int(state.get("turn", 1))
    history = list(state.get("history") or [])
    session_dir = Path(state["session_dir"])
    user_wav = session_dir / f"turn_{turn_no:03d}_user.wav"
    ai_wav = session_dir / f"turn_{turn_no:03d}_ai.wav"

    started = time.perf_counter()
    try:
        duration = save_browser_audio(audio, user_wav)
        log_event(
            state,
            "audio_recorded",
            turn=turn_no,
            audio=user_wav.name,
            duration_s=round(duration, 3),
        )

        user_text, stt_latency, key_no, key, stt_model = full.run_stt(KEYS, user_wav)
        if not user_text:
            log_event(state, "error", turn=turn_no, stage="stt", latency_s=round(stt_latency, 3))
            return conversation_markdown(history), "", "", None, "STT failed. Try speaking again.", state, None

        teacher_choice = TEACHER_UI.get(teacher_name, "2")
        _, resolved_teacher_name, teacher_rule = full.TEACHER_MODES[teacher_choice]

        pron_result = None
        pron_latency = 0.0
        pron_model = None
        if pronunciation_enabled:
            pron_result, pron_latency, pron_model = full.run_pronunciation(
                key, user_wav, user_text, teacher_choice
            )

        turn, llm_latency, llm_error = full.make_turn(
            key,
            user_text,
            resolved_teacher_name,
            teacher_rule,
            history,
        )
        if not turn:
            log_event(
                state,
                "error",
                turn=turn_no,
                stage="llm",
                user_text=user_text,
                message=llm_error,
                latency_s=round(llm_latency, 3),
            )
            return conversation_markdown(history), "", pronunciation_markdown(pron_result), None, "LLM failed.", state, None

        pcm, tts_latency, tts_model, tts_error = full.synthesize_reply(key, turn["reply"])
        if not pcm:
            log_event(
                state,
                "error",
                turn=turn_no,
                stage="tts",
                user_text=user_text,
                ai_reply=turn["reply"],
                message=tts_error,
                latency_s=round(tts_latency, 3),
            )
            return conversation_markdown(history), "", pronunciation_markdown(pron_result), None, "TTS failed.", state, None

        full.save_wav(pcm, ai_wav)
        history.append({"user": user_text, "ai": turn["reply"]})
        history = history[-8:]
        state["history"] = history
        state["turn"] = turn_no + 1

        api_total = stt_latency + pron_latency + llm_latency + tts_latency
        wall_total = time.perf_counter() - started
        log_event(
            state,
            "turn",
            turn=turn_no,
            user_audio=user_wav.name,
            ai_audio=ai_wav.name,
            user_text=user_text,
            ai_reply=turn["reply"],
            correction=turn["correction"],
            explanation_ja=turn["explanation_ja"],
            teacher=resolved_teacher_name,
            stt={"model": stt_model, "key_slot": key_no, "latency_s": round(stt_latency, 3)},
            pronunciation={
                "enabled": pronunciation_enabled,
                "model": pron_model,
                "latency_s": round(pron_latency, 3),
                "result": pron_result,
            },
            llm={"model": full.LLM_MODEL, "latency_s": round(llm_latency, 3)},
            tts={"model": tts_model, "latency_s": round(tts_latency, 3)},
            api_total_s=round(api_total, 3),
            wall_total_s=round(wall_total, 3),
        )

        correction = turn["correction"]
        if turn["explanation_ja"]:
            correction += f"\n\n{turn['explanation_ja']}"

        status = f"Turn {turn_no} · {wall_total:.1f}s"
        return (
            conversation_markdown(history),
            correction,
            pronunciation_markdown(pron_result) if pronunciation_enabled else "Pronunciation scoring is off.",
            str(ai_wav),
            status,
            state,
            None,
        )
    except Exception as exc:
        log_event(state, "error", turn=turn_no, stage="web", message=str(exc))
        return conversation_markdown(history), "", "", None, f"Error: {exc}", state, None


def reset_session(state):
    if state and state.get("session_dir"):
        log_event(state, "session_end", reason="reset")
    fresh = new_session()
    return "_No conversation yet._", "", "", None, "New conversation.", fresh, None


def build_app():
    with gr.Blocks(title="E-KAIWA MVP") as demo:
        gr.Markdown("# E-KAIWA\nTap the microphone, speak English, then stop recording.")

        state = gr.State(value=new_session)
        mic = gr.Audio(
            sources=["microphone"],
            type="numpy",
            label="Speak",
            buttons=[],
        )
        status = gr.Markdown("Ready.")
        ai_audio = gr.Audio(label="AI reply", autoplay=True, interactive=False, buttons=[])
        conversation = gr.Markdown("_No conversation yet._")

        with gr.Accordion("Correction", open=True):
            correction = gr.Markdown("")
        with gr.Accordion("Pronunciation", open=False):
            pronunciation = gr.Markdown("")
        with gr.Accordion("Settings", open=False):
            teacher = gr.Dropdown(
                choices=["Easy", "Normal", "Strict"],
                value="Normal",
                label="Teacher strictness",
            )
            pron_enabled = gr.Checkbox(value=True, label="Pronunciation scoring")
            reset = gr.Button("New conversation")

        mic.stop_recording(
            fn=process_turn,
            inputs=[mic, state, teacher, pron_enabled],
            outputs=[conversation, correction, pronunciation, ai_audio, status, state, mic],
        )
        reset.click(
            fn=reset_session,
            inputs=[state],
            outputs=[conversation, correction, pronunciation, ai_audio, status, state, mic],
        )

    return demo


def parse_args():
    parser = argparse.ArgumentParser(description="E-KAIWA mic-only Gradio web MVP")
    parser.add_argument("--share", action="store_true", help="Create a temporary public Gradio share URL")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    return parser.parse_args()


KEYS = read_keys()

if __name__ == "__main__":
    args = parse_args()
    build_app().launch(
        server_name=args.host,
        server_port=args.port,
        share=args.share,
        show_error=True,
    )
