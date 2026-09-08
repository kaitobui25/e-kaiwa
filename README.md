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
  run_web_test.bat       Default phone test: Gemini Live audio-to-audio
  run_gradio_test.bat    Legacy Gradio fallback
live_app.py              Tiny HTTP server: page + ephemeral token + coach sidecar
web/live.html            Mic-only realtime mobile UI
web_app.py               Legacy Gradio mobile UI
tests/                   Experiment and MVP test code
runtime_logs/            Local session logs + captured WAVs (gitignored)
tools/                   Environment diagnostics
requirements.txt
```

`api.txt` stays local in the repository root and is ignored by Git. Put one Gemini API key per non-empty line. Key #4 is intentionally skipped.

## Setup

```bat
scripts\setup.bat
```

## Phone test: realtime audio-to-audio

Run:

```bat
scripts\run_web_test.bat
```

The runner starts `live_app.py` on `127.0.0.1:7860` and a Cloudflare Quick Tunnel. Open the printed `https://...trycloudflare.com` URL on the phone.

The realtime path is intentionally different from the old Gradio batch path:

```text
phone microphone
   ↕ direct WebSocket, streaming PCM
gemini-3.1-flash-live-preview
   ↕ streaming PCM
phone speaker
```

The PC/VPS is not in the realtime audio path. It only:

```text
serves the small web page
creates one-use ephemeral Gemini Live tokens
runs correction + pronunciation after each user turn
writes debug logs
```

The UI uses push-to-talk manual turn boundaries:

```text
Tap Start talking
speak
Tap Stop & send
AI audio starts streaming as soon as Gemini returns the first chunk
```

The page shows `First AI audio: ... ms`. This is the main latency metric. Target for the MVP is under 3000 ms from Stop to the first received AI audio chunk.

## Coach sidecar

Correction and pronunciation do not block the spoken reply:

```text
                         ┌─> Gemini Live audio reply -> speaker
user audio/transcript ───┤
                         └─> correction + pronunciation -> UI later
```

The sidecar reuses the existing teacher modes and pronunciation prototype. User PCM is saved as WAV only for coaching/debugging after the realtime turn.

## Session logs

Live sessions create:

```text
runtime_logs/
  YYYY-MM-DD/
    YYYYMMDD_HHMMSS_live/
      conversation.jsonl
      turn_001_user.wav
      turn_002_user.wav
      ...
```

`conversation.jsonl` includes live turn text, `first_audio_ms`, correction, pronunciation result, model names, key slot, and coach latency. API key values are never logged.

## Legacy / component tests

The previous Gradio UI remains available as a fallback:

```bat
scripts\run_gradio_test.bat
```

Component/CLI tests remain:

```bat
scripts\run_llm_test.bat
scripts\run_stt_test.bat
scripts\run_pronunciation_test.bat
scripts\run_tts_test.bat
scripts\run_full_loop_test.bat
```

The old CLI/Gradio path is batch-oriented (`STT -> pronunciation -> LLM -> TTS`) and is useful for debugging individual components, not for latency benchmarking.
