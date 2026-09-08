# e-kaiwa

Minimal realtime AI English conversation app for Japanese learners.

## Repository layout

The repository is split into two clear zones:

```text
src/                    ACTIVE — code that still runs and is maintained
  app.py                 realtime server entrypoint
  e_kaiwa/               backend modules
  web/                   browser UI
  scripts/
    setup.bat             one-time/local setup
    run.bat               normal realtime runner
  tests/                 regression tests for active production code
  requirements.txt       runtime-only Python dependencies

archive/precode/        FROZEN — experiments used before the production flow existed
  tests/                 STT/LLM/TTS/pronunciation/full-loop benchmarks
  scripts/               old benchmark runners
  tools/                 old environment/preflight utilities
  legacy/                old Gradio/compatibility code

.agent/                  development conversation logs and plans
.github/                 CI configuration
```

`archive/precode/` is historical reference only. Production code and CI must not import from it.

Local-only files remain at repository root:

```text
api.txt                  Gemini API keys, gitignored
runtime_logs/            generated session logs/WAVs, gitignored
.venv/                   local Python environment, gitignored
```

## Setup

```bat
src\scripts\setup.bat
```

The current realtime server itself uses only the Python standard library. `cloudflared` is used by the Windows runner to expose the local server to a phone through a temporary HTTPS tunnel.

`api.txt` must exist in the repository root. Put one Gemini API key per non-empty line. Key slot #4 is intentionally skipped.

## Run

```bat
src\scripts\run.bat
```

The runner starts the app on:

```text
http://127.0.0.1:7860
```

and prints one temporary Cloudflare URL for opening on the phone.

## Current realtime flow

```text
Tap Start once
→ microphone stays open
→ browser streams PCM directly to Gemini Live
→ Gemini Automatic VAD detects turn boundaries
→ streaming AI audio plays immediately
→ correction + pronunciation coach runs separately
→ after AI playback, the microphone continues with the next turn
```

Architecture:

```text
Phone browser
  ├─ direct WebSocket PCM ↔ Gemini Live
  └─ HTTP → local E-KAIWA server → coach APIs/logging
```

The local server is intentionally small. It:

- serves the frontend;
- creates short-lived Gemini Live tokens;
- runs correction/pronunciation coaching after each turn;
- stores local session logs and captured user WAVs.

The realtime spoken reply does not wait for coach results.

## Active source tree

Backend responsibilities are separated under `src/e_kaiwa/`:

```text
config.py       paths, models, teacher modes, API-key policy
gemini.py       Gemini HTTP helpers and ephemeral token creation
sessions.py     session registry, JSONL logging, PCM WAV writing
coach.py        correction + pronunciation sidecar
server.py       HTTP routes and server lifecycle
```

Frontend files are under `src/web/`:

```text
live.html
live.css
live.js
```

## Regression checks

Only tests that protect the current maintained code stay with `src/`:

```text
src/tests/test_live_core.py
```

CI runs these checks without API keys:

```text
Python regression tests
Python syntax compilation
browser JavaScript syntax check
```

The older model benchmarks and prototype loops are deliberately not part of CI anymore. They are kept under `archive/precode/` only as historical engineering reference.

## Historical prototype material

Everything under `archive/precode/` predates the current realtime production architecture. It includes model selection experiments, STT/TTS/pronunciation measurements, full-loop prototypes, Live-access probes, Gradio UI code and the original preflight utility.

Do not add new production work there. New code belongs under `src/`.
