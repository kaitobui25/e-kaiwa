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
