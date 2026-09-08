# e-kaiwa

Minimal realtime AI English conversation MVP for Japanese learners.

The main product path is hands-free Gemini Live audio-to-audio. The browser streams audio directly to Gemini Live; the small Python server only serves the page, creates ephemeral tokens, runs coaching after each turn, and writes local debug logs.

## Current architecture

```text
Phone browser
  mic PCM 16 kHz
      ↕ direct WebSocket
Gemini Live
  gemini-3.1-flash-live-preview
      ↕ streaming audio reply
Phone speaker

After each completed user turn:
Phone browser
      → /api/coach
Python sidecar
      ├─ correction
      └─ pronunciation feedback
```

The coach path does **not** block the spoken Gemini Live reply.

## Project layout

```text
.agent/
  chatgptlog/                 Development conversation summaries
  chatgptplan/                Implementation plans

e_kaiwa/
  config.py                   Runtime paths, models, teacher modes, API keys
  gemini.py                   Gemini REST helpers + ephemeral token
  sessions.py                 Session registry, JSONL logs, WAV persistence
  coach.py                    Correction + pronunciation sidecar
  server.py                   HTTP routes and server bootstrap

live_app.py                   Thin realtime server entrypoint
web/
  live.html                   Realtime page markup
  live.css                    Realtime page styles
  live.js                     Live session, audio, turn state and coach UI

web_app.py                    Legacy Gradio fallback
web_coach.py                  Backward-compatible coach shim
scripts/                      Windows runners
tests/                        Component experiments + regression tests
tools/                        Environment diagnostics
runtime_logs/                 Local runtime logs/WAVs; gitignored
```

Production realtime code under `e_kaiwa/` does not import benchmark code from `tests/`.

## API keys

Create local `api.txt` in the repository root with one Gemini API key per non-empty line.

`api.txt` is gitignored. Raw keys must never be committed or logged.

Operational rule from the current test setup:

```text
API key slot #4 is skipped.
```

## Setup

```bat
scripts\setup.bat
```

## Run the realtime phone test

```bat
scripts\run_web_test.bat
```

The runner starts:

```text
python live_app.py
```

on `127.0.0.1:7860`, then starts a Cloudflare Quick Tunnel. Open the printed `https://...trycloudflare.com` URL on the phone.

You can also run the server directly:

```text
python live_app.py
python live_app.py --host 127.0.0.1 --port 7860
```

## Realtime UX

The current flow uses Gemini Automatic VAD rather than manual push-to-talk for every turn:

```text
Tap Start conversation once
→ microphone stays open
→ speak naturally
→ silence ends the user turn
→ Gemini replies with streaming audio
→ after playback the app listens again automatically
→ continue turn 2, 3, 4... without tapping again
```

Settings:

- Teacher: Easy / Normal / Strict
- Correction language: Tiếng Việt / 日本語
- Silence timeout: 0.7 / 1.0 / 1.2 / 1.5 seconds
- Pronunciation coaching: ON / OFF

The silence timeout is stored in browser `localStorage` and takes effect on the next Live reconnect.

## Important lifecycle rule

Microphone/session lifetime and turn-object lifetime are separate concerns.

```text
Live session + microphone = long-lived
turn object                = create/finalize once per VAD turn
```

During AI playback, microphone input forwarding is gated to avoid sending speaker echo back to Gemini. After playback, the next turn is armed automatically without reopening the microphone device.

## Coach sidecar

After each turn, correction and pronunciation run in parallel:

```text
                         ┌─> correction LLM
completed user turn ─────┤
                         └─> pronunciation analysis
```

Current coach models:

```text
Correction:
  gemini-3.5-flash-lite

Pronunciation fallback chain:
  gemini-3.5-flash-lite
  → gemini-3.1-flash-lite
  → gemini-3.6-flash
```

Pronunciation scoring is an ELSA-like MVP prototype using a general multimodal model. It is not a dedicated phoneme-level scoring engine.

## Session logs

Each Live session creates a local directory:

```text
runtime_logs/
  YYYY-MM-DD/
    YYYYMMDD_HHMMSS_live/
      conversation.jsonl
      turn_001_user.wav
      turn_002_user.wav
      ...
```

Logs include session/turn lifecycle, user/AI transcripts, frontend state diagnostics, correction, pronunciation output, model names, key slot numbers, and coach latency. API key values are never logged.

## Tests

Core refactor regression tests:

```text
python -m unittest tests.test_live_core
```

Existing component tests remain available:

```bat
scripts\run_llm_test.bat
scripts\run_stt_test.bat
scripts\run_pronunciation_test.bat
scripts\run_tts_test.bat
scripts\run_full_loop_test.bat
```

Legacy Gradio UI:

```bat
scripts\run_gradio_test.bat
```

The legacy CLI/Gradio path is useful for component debugging. The realtime browser path is the main product direction.
