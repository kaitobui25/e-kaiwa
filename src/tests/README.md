# Active tests

This directory contains tests for the maintained realtime application only.

```text
src/tests/
  python/               fast offline Python regression tests
  system/               local system smoke test using the real app process
  run_python.bat         run Python tests
  run_system.bat         run system test
```

## 1. Python tests

Run:

```bat
src\tests\run_python.bat
```

These tests are fast and offline. They do not require `api.txt` and do not call Gemini.

Current coverage includes:

- API-key parsing, de-duplication and skipped slot #4
- teacher-mode fallback
- feedback-language allowlist
- session-id validation
- session log creation
- PCM16 WAV writing
- Gemini JSON response parsing helper
- frontend AI playback-speed options/default/persistence/queue timing

CI runs this suite on every pull request.

## 2. System test

Run:

```bat
src\tests\run_system.bat
```

This starts `src/app.py` as a real local process on a temporary free port and verifies:

1. the app starts successfully;
2. `/health` responds correctly;
3. the HTML page is served;
4. CSS and JavaScript assets are served;
5. `/api/session` can create a real Gemini ephemeral token.

Requirements:

- working internet connection;
- valid Gemini keys in repository-root `api.txt`.

The system test intentionally does not automate the phone microphone or Gemini Live audio WebSocket. That final audio path remains a manual browser/phone check with:

```bat
src\scripts\run.bat
```

Historical model-selection and pre-production experiments are not active tests. They remain frozen under `archive/precode/`.
