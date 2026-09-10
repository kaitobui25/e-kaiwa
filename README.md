# E-KAIWA

Mobile-first realtime AI speaking practice powered by Gemini Live.

**Current version: `0.11`**  
**Current VPS deployment:** `https://ekaiwa.duckdns.org`

E-KAIWA started as an English-conversation app for Japanese learners and now uses one shared realtime engine for multiple learning targets. The public UI is designed for phones; the backend stays intentionally small and inexpensive to operate.

## Highlights

- **Realtime audio-to-audio** conversation with Gemini Live.
- **Push-to-Talk by default**, with optional Hands-free mode.
- **Target languages:** English, Japanese, and Mandarin Chinese (Simplified).
- **Coach sidecar** for correction + pronunciation after each learner turn without delaying the realtime reply.
- **Mobile-first UI** with replay, Coach score/details, light/dark themes, and stable streaming transcript updates.
- **Live recovery** with session resumption, GoAway handling, offline/online recovery, and a stale-response watchdog.
- **iPhone/Chrome mic reuse:** reconnects and language changes reuse the granted microphone capture instead of unnecessarily calling `getUserMedia()` again.
- **Ubuntu VPS deployment** using one Python process behind Caddy + systemd.
- **Built-in 5-second self-update flow** with maintenance mode, checks, restart, health verification, and readable warnings.
- **Deterministic CI** on Python 3.12 + Node 18.19.1, matching the VPS updater's system Node environment.

## Recent releases

```text
0.9  mobile public UI refresh
0.10 realtime / network / UI / updater stability
0.11 iPhone / Chrome microphone lifecycle fix
```

Future incremental releases continue as `0.12`, `0.13`, ... unless the version policy is intentionally changed.

## Architecture

Live audio does **not** pass through the VPS:

```text
Phone browser
  |
  | HTTPS
  v
Caddy
  |
  v
E-KAIWA Python server (127.0.0.1:7860)
  |- frontend / settings / health
  |- short-lived Gemini Live token
  |- Coach request after each turn
  |- metrics / JSONL logs
  `- maintenance / update request

Phone browser  <====== direct WebSocket audio ======>  Gemini Live
```

The realtime reply stays low-latency while the server handles tokens, Coach, logging, settings, and operations.

No React/Vue, Docker, Kubernetes, Gunicorn, or multi-worker stack is required for the current deployment.

## Conversation modes

**Push-to-Talk — public default**

```text
hold mic
-> stream PCM directly to Gemini Live
-> release
-> Gemini streams the spoken reply
-> transcript updates incrementally
-> Coach runs separately
-> hold mic again
```

**Hands-free — optional**

```text
start conversation
-> microphone capture stays reusable
-> Gemini activity detection handles turn boundaries
-> AI replies
-> input resumes after playback / echo guard
```

Normal PTT release, language changes, network recovery, and Gemini reconnects pause microphone capture without calling `track.stop()`. Full mic release is reserved for page teardown or a broken/stale capture.

## Multilingual engine

The project uses one generic realtime/Coach pipeline plus language profiles:

```text
Generic E-KAIWA engine
        +
Language profile / registry
```

| Code | Target language | Speech locale |
| --- | --- | --- |
| `en` | English | `en-US` |
| `ja` | Japanese | `ja-JP` |
| `zh-Hans` | Mandarin Chinese (Simplified) | `zh-CN` |

App/support language and learning target language are separate concepts. The same realtime, audio, session, UI, and Coach infrastructure is reused across targets; only language-specific policy/rubrics live in the profile layer.

## Reliability work

Gemini Live sockets are treated as finite-lived connections rather than permanent sessions. Current recovery covers:

- session resumption + latest handle;
- top-level `sessionResumptionUpdate` and `GoAway`;
- new ephemeral token per new WebSocket;
- resume first, fresh-session fallback when needed;
- browser offline/online recovery;
- stale active-turn cleanup;
- response watchdog after PTT `activityEnd`;
- context-window compression for longer conversations.

Streaming transcript chunks update the active turn in place instead of rebuilding the whole conversation DOM every time, reducing mobile scroll jitter and keeping replay/score targets stable.

## Local setup

`api.txt` must exist at repository root with one Gemini API key per non-empty line. It is gitignored and must never be committed.

### Windows helper

```bat
src\scripts\setup.bat
src\scripts\run.bat
```

### Direct Python

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install -r src/requirements.txt
python src/app.py --mode public
```

Local address:

```text
http://127.0.0.1:7860
```

The Windows runner can expose the local app to a phone through a temporary Cloudflare HTTPS tunnel.

## VPS deployment

Current production-style layout:

```text
Internet :80/:443
    -> Caddy
    -> E-KAIWA 127.0.0.1:7860
```

Recommended setup:

- Ubuntu + Python 3.12 virtualenv;
- one `ekaiwa.service` systemd process;
- Caddy as the only Internet-facing app process;
- `E_KAIWA_TRUST_PROXY=true` behind trusted localhost Caddy;
- do not expose port `7860` publicly;
- keep `api.txt` local with restrictive permissions.

Deployment assets live under `deploy/`.

## VPS self-update

Install the updater once:

```bash
sudo bash deploy/install_update.sh
```

Then the UI can trigger an update with a **5-second long press**:

```text
hold Update
-> maintenance mode
-> fetch/deploy Git revision
-> run regression + syntax checks
-> restart app
-> health check
-> success or warning result
```

If the new app is healthy but a check reports warnings, the result remains visible until **Close** instead of disappearing immediately.

Operational logs and updater paths are documented in [`deploy/OPERATIONS.md`](deploy/OPERATIONS.md).

## Repository layout

```text
src/
  app.py                 app entrypoint
  e_kaiwa/               backend modules
  web/                   realtime/audio/UI browser modules
  scripts/               local setup/run helpers
  tests/
    python/               offline backend regression tests
    js/                   browser-module regression tests
    system/               local system smoke test

deploy/                   Caddy/systemd/updater/operations
archive/precode/           frozen pre-production experiments
.agent/                    engineering plans, notes and chat summaries
.github/                   CI
config.yaml                runtime/model policy
package.json               explicit ES-module semantics for Node tests
```

`archive/precode/` is historical reference only. Production code and CI must not import from it.

Local-only/gitignored files:

```text
api.txt
runtime_logs/
.venv/
```

## Tests and CI

Python regression tests:

```bash
PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"
```

Browser module tests:

```bash
node --test src/tests/js/*.test.mjs
```

VPS updater-equivalent Node test:

```bash
sudo /usr/bin/node --test src/tests/js/*.test.mjs
```

GitHub Actions currently verifies:

- Python 3.12 regression tests;
- Node 18.19.1 browser-module tests;
- Python compile checks;
- JavaScript module syntax checks.

CI is secret-free and does not make external Gemini realtime calls. The final microphone/Gemini Live path still needs a real browser/device test.

## Current frontend ownership

```text
live.js           realtime orchestration / PTT / turn lifecycle
live_recovery.js  resumption / GoAway / watchdog timing
audio.js          microphone capture + playback
language_policy.js multilingual transcript/language policy
ui.js             DOM updates / autoscroll / actions
ui_render.js      conversation + Coach markup
ui_overlay.js     Settings / Coach overlays
maintenance.js    update frontend state machine
public.css         public/mobile visual layer
```

## Design principles

Keep E-KAIWA simple and maintainable:

- vanilla browser modules + Python;
- one realtime pipeline;
- one Coach service;
- one language registry;
- one recovery path;
- one lightweight VPS app process;
- modular ownership instead of framework rewrites;
- optimize for mobile reliability, low latency, and low operational cost.
