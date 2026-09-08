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
tests/                  Experiment and MVP test code
  test_llm.py
  test_stt.py
  test_pronunciation.py
  test_tts.py
  test_full_loop.py
  stt_samples/          Downloaded/normalized test fixtures
runtime_logs/           Local full-loop session logs + captured WAVs (gitignored)
tools/                  Environment diagnostics
  preflight.py
requirements.txt
```

`api.txt` stays local in the repository root and is ignored by Git. Put one Gemini API key per non-empty line. Key #4 is intentionally skipped by the current STT/full-loop tests.

## Setup / PC preflight

```bat
scripts\setup.bat
```

This creates `.venv`, installs dependencies, and runs the PC/audio preflight.

## Tests

```bat
scripts\run_llm_test.bat
scripts\run_stt_test.bat
scripts\run_pronunciation_test.bat
scripts\run_tts_test.bat
scripts\run_full_loop_test.bat
```

The runners temporarily copy the local root `api.txt` into `tests/` because the existing test scripts resolve resources relative to their own folder. The temporary copy is deleted after each run and is also gitignored.

## Full loop modes

Run:

```bat
scripts\run_full_loop_test.bat
```

The full loop now asks for an input mode:

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

Every full-loop run creates one local session folder:

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

File mode uses the same session layout but references the selected test WAV instead of copying it.

`conversation.jsonl` records the conversation text, correction, pronunciation result, model names, timings, selected key slot, audio paths, errors, and session start/end events. It never writes the API key itself. The whole `runtime_logs/` directory is gitignored.

## Current MVP path

```text
WAV / microphone
→ STT: gemini-3.5-flash-lite
→ pronunciation feedback (optional, default ON)
→ LLM reply + correction
→ TTS of AI reply only
→ conversation continues
```

`gemini-3.5-transcribe` is intentionally not used in the production-like full loop because current testing returned HTTP 200 with audio tokens but empty output.
