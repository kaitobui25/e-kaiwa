# e-kaiwa

Minimal AI English conversation MVP for Japanese learners.

## Project layout

```text
.agent/                 ChatGPT/dev logs
scripts/                Windows runners
  setup.bat
  run_llm_test.bat
  run_stt_test.bat
  run_pronunciation_test.bat
  run_tts_test.bat
  run_full_loop_test.bat
  run_web_test.bat       Mic-only Gradio phone test
web_app.py               Minimal Gradio mobile web UI
tests/                  Experiment and MVP test code
  test_llm.py
  test_stt.py
  test_pronunciation.py
  test_tts.py
  test_full_loop.py
  stt_samples/          Downloaded/normalized test fixtures
runtime_logs/           Local session logs + captured WAVs (gitignored)
tools/                  Environment diagnostics
  preflight.py
requirements.txt
```

`api.txt` stays local in the repository root and is ignored by Git. Put one Gemini API key per non-empty line. Key #4 is intentionally skipped by the current STT/full-loop/web flows.

## Setup / PC preflight

```bat
scripts\setup.bat
```

This creates `.venv`, installs dependencies, and runs the PC/audio preflight.

## Phone test: Gradio mic-only

The phone UI intentionally has no WAV upload mode. It only exposes the browser microphone.

On Windows, run:

```bat
scripts\run_web_test.bat
```

This starts `web_app.py --share`. Open the generated `https://...gradio.live` URL on the phone, grant microphone permission, tap the microphone, speak English, then stop recording. Stopping the recording automatically runs the full turn:

```text
phone mic
→ STT
→ pronunciation feedback (optional)
→ LLM reply + correction
→ TTS
→ AI audio in the browser
```

The web UI keeps recent conversation turns in per-browser session state. Each session is also logged under `runtime_logs/YYYY-MM-DD/..._web/` with `conversation.jsonl`, user WAVs, and AI WAVs.

For a VPS, install requirements and run without the temporary Gradio share link:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python web_app.py --host 0.0.0.0 --port 7860
```

Put `api.txt` in the repository root on the VPS. Expose the app through HTTPS (for example a reverse proxy or tunnel) so mobile browsers can grant microphone access.

## Tests

```bat
scripts\run_llm_test.bat
scripts\run_stt_test.bat
scripts\run_pronunciation_test.bat
scripts\run_tts_test.bat
scripts\run_full_loop_test.bat
```

The test runners temporarily copy the local root `api.txt` into `tests/` because the existing test scripts resolve resources relative to their own folder. The temporary copy is deleted after each run and is also gitignored. The Gradio web app reads root `api.txt` directly and does not need that copy.

## Full loop modes

Run:

```bat
scripts\run_full_loop_test.bat
```

The CLI full loop asks for an input mode:

```text
1 = Audio file - choose a WAV sample and run one turn
2 = Microphone - live multi-turn conversation
```

Mic mode is intentionally simple:

```text
Enter -> start the next utterance
Enter -> stop recording
AI replies and speaks
repeat
q     -> end the conversation
```

The LLM keeps a small in-memory window of recent user/AI turns so mic mode behaves like a conversation instead of isolated one-shot prompts.

## Session logs

Every full-loop/web run creates one local session folder:

```text
runtime_logs/
  YYYY-MM-DD/
    YYYYMMDD_HHMMSS_mic/
      conversation.jsonl
      turn_001_user.wav
      turn_001_ai.wav
      turn_002_user.wav
      turn_002_ai.wav
```

Web sessions use the `_web` suffix. File mode uses the same session idea but references the selected test WAV instead of copying it.

`conversation.jsonl` records the conversation text, correction, pronunciation result, model names, timings, selected key slot, audio paths, errors, and session start/end events. It never writes the API key itself. The whole `runtime_logs/` directory is gitignored.

## Current MVP path

```text
browser mic / CLI WAV / CLI mic
→ STT: gemini-3.5-flash-lite
→ pronunciation feedback (optional, default ON)
→ LLM reply + correction
→ TTS of AI reply only
→ conversation continues
```

`gemini-3.5-transcribe` is intentionally not used in the production-like full loop because current testing returned HTTP 200 with audio tokens but empty output.
