# E-KAIWA

Mobile-first realtime AI speaking practice with Gemini Live.

**Current app version: `0.11`**

E-KAIWA started as a minimal English-conversation app for Japanese learners and has evolved into one shared realtime engine with multilingual target-language profiles. The public UI is optimized for phones, especially iPhone/Android, while the backend stays intentionally small and inexpensive to run.

## What is working now

- **Realtime audio-to-audio conversation** through Gemini Live.
- **Push-to-Talk by default** in public mode, with optional Hands-free conversation.
- **Target languages:** English (`en`), Japanese (`ja`), and Mandarin Chinese Simplified (`zh-Hans`).
- **Separate app/support language and learning target language** — changing one does not redefine the other.
- **Coach sidecar** after each learner turn for correction and pronunciation feedback without delaying the realtime reply.
- **Replay / Coach mobile UI** with stable touch actions and incremental transcript rendering.
- **Live-session recovery:** Gemini session resumption, GoAway handling, reconnect fallback, browser offline/online recovery, and stale-response watchdog.
- **iPhone/Chrome microphone reuse:** Gemini reconnects, language changes, and PTT release pause the existing mic capture instead of destroying it and requesting `getUserMedia()` again.
- **Ubuntu VPS deployment** with systemd + Caddy HTTPS; the Python app remains private on `127.0.0.1:7860`.
- **Built-in VPS self-update flow:** hold Update for 5 seconds, enter maintenance mode, run update/checks, restart, health-check, then show success or persistent warnings.
- **Deterministic CI/updater browser tests** with explicit ES-module semantics and Node `18.19.1`, matching the VPS system Node environment.

Recent release sequence:

```text
0.9  mobile public UI refresh
0.10 realtime / network / UI / updater stability
0.11 iPhone / Chrome microphone lifecycle fix
```

Future incremental releases continue as `0.12`, `0.13`, ... unless the version policy is intentionally changed.

## Architecture

The realtime path deliberately avoids routing live audio through the VPS:

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

This keeps realtime latency low and lets the VPS stay lightweight. The current deployment target is roughly one Python process plus Caddy; no Docker, Kubernetes, Gunicorn, or frontend framework is required.

## Public conversation flow

### Push-to-Talk — default

```text
Open app
-> Gemini Live session becomes ready
-> hold microphone button
-> browser streams PCM directly to Gemini Live
-> release to end learner activity
-> Gemini streams audio reply immediately
-> transcript updates incrementally
-> Coach runs separately after the turn
-> hold microphone again for the next turn
```

### Hands-free — optional

```text
Enable Talk / Hands-free
-> microphone capture is prepared
-> Gemini automatic activity detection handles turn boundaries
-> AI audio plays
-> input resumes after playback / echo guard
-> conversation continues until stopped
```

The browser reuses a healthy microphone `MediaStream` during the current page session. Normal Gemini reconnects or language changes must **not** call `track.stop()`; full mic release is reserved for real page teardown or broken/stale capture.

## Multilingual engine

Target-language behavior is driven by a shared registry instead of separate applications per language:

```text
Generic realtime / Coach engine
          +
Language profile / registry
```

Current profiles:

| Code | Target language | Speech locale |
| --- | --- | --- |
| `en` | English | `en-US` |
| `ja` | Japanese | `ja-JP` |
| `zh-Hans` | Mandarin Chinese (Simplified) | `zh-CN` |

The same realtime, audio, session, UI, and Coach infrastructure is reused across targets. Language-specific correction/pronunciation rules live in the profile layer.

## Realtime reliability

The browser treats Gemini Live sockets as finite-lived rather than permanent connections.

Current recovery behavior includes:

- `sessionResumption` with the latest resumption handle;
- top-level `sessionResumptionUpdate` handling;
- `GoAway` scheduling before a connection expires;
- a new ephemeral token for every new WebSocket;
- resume first, then fresh-session fallback if resume fails;
- browser `offline` / `online` recovery;
- forced cleanup of stale/incomplete turns;
- response watchdog after Push-to-Talk `activityEnd`;
- context-window compression for longer Live sessions.

Relevant frontend ownership:

```text
live.js           realtime orchestration / PTT / turn lifecycle
live_recovery.js  resumption / GoAway / watchdog timing
 audio.js          microphone capture + playback ownership
ui.js             DOM controller / incremental updates / autoscroll
ui_render.js      conversation / Coach markup
ui_overlay.js     Settings / Coach overlays
```

## Mobile UI

The public interface is intentionally vanilla HTML/CSS/JS and optimized for phone interaction:

- fixed bottom microphone control with safe-area spacing;
- stable replay / score action row below message text;
- partial transcript updates without rebuilding the full conversation on every chunk;
- autoscroll only while the user is already near the bottom;
- light/dark themes;
- Japanese-first public UX;
- Settings with subtle mobile control boundaries rather than heavy nested cards.

`live.css` owns the base/dev presentation; `public.css` contains the public/mobile visual layer.

## Local setup

`api.txt` must exist at the repository root and contain one Gemini API key per non-empty line. It is gitignored and must never be committed.

Windows helper setup:

```bat
src\scripts\setup.bat
src\scripts\run.bat
```

The local app listens on:

```text
http://127.0.0.1:7860
```

The Windows runner can expose it to a phone through a temporary Cloudflare HTTPS tunnel.

Direct Python setup is also simple:

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install -r src/requirements.txt
python src/app.py --mode public
```

## VPS deployment

The current production-style layout is:

```text
Internet
  -> Caddy :80/:443
  -> E-KAIWA 127.0.0.1:7860
```

Recommended Ubuntu runtime:

- Python 3.12 virtualenv at `/home/ubuntu/e-kaiwa/.venv`;
- `ekaiwa.service` under systemd;
- Caddy as the only public reverse proxy;
- `E_KAIWA_TRUST_PROXY=true` when the app is behind trusted localhost Caddy;
- ports 80/443 public, port 7860 private;
- `api.txt` mode `600`.

Typical explicit app command:

```bash
cd /home/ubuntu/e-kaiwa
E_KAIWA_TRUST_PROXY=true \
/home/ubuntu/e-kaiwa/.venv/bin/python \
/home/ubuntu/e-kaiwa/src/app.py --mode public
```

Current public deployment uses HTTPS through Caddy at:

```text
https://ekaiwa.duckdns.org
```

Deployment templates and updater components live under `deploy/`.

## Self-update on VPS

The optional VPS updater is installed with:

```bash
sudo bash deploy/install_update.sh
```

The public UI uses a **5-second long press** to trigger an update. The high-level flow is:

```text
hold Update 5s
-> request update
-> maintenance UI blocks normal interaction
-> stop app when required
-> fetch/deploy Git revision
-> run regression / syntax checks
-> start app
-> health check
-> finish
```

Result behavior:

```text
all checks pass + health pass
-> brief success
-> automatic reload is allowed

app is healthy but checks contain warnings
-> warning result stays visible
-> user presses Close
-> page reloads

start / health / update fails
-> blocking error stays visible
```

The updater runs independently from the interactive user's NVM installation. Browser modules therefore declare ES-module behavior explicitly in the repository root `package.json`.

## Logs and operations

Application and privileged updater logs are intentionally separated:

```text
Conversation:
/home/ubuntu/e-kaiwa/runtime_logs/YYYY-MM-DD/<session>/conversation.jsonl

UI / realtime diagnostics:
/home/ubuntu/e-kaiwa/runtime_logs/YYYY-MM-DD/ui_events.jsonl

Updater history:
/var/lib/ekaiwa-update/updater.jsonl

Updater current status:
/var/lib/ekaiwa-update/status.json
```

Useful VPS commands:

```bash
sudo journalctl -u ekaiwa.service -n 200 --no-pager
sudo journalctl -u ekaiwa-update.service -n 200 --no-pager
sudo tail -n 100 /var/lib/ekaiwa-update/updater.jsonl
```

See [`deploy/OPERATIONS.md`](deploy/OPERATIONS.md) for operational details.

## Repository layout

```text
src/
  app.py                 application entrypoint
  e_kaiwa/               backend modules
  web/                   public/dev browser UI and realtime modules
  scripts/               local setup/run helpers
  tests/
    python/               offline backend regression tests
    js/                   browser-module regression tests
    system/               runnable local system smoke test
  requirements.txt

deploy/
  caddy/                  maintenance / reverse-proxy deployment pieces
  systemd/                app + updater service definitions
  updater/                privileged updater implementation
  install_update.sh
  OPERATIONS.md

archive/precode/          frozen pre-production experiments/reference
.agent/                   engineering plans, notes and conversation summaries
.github/                  CI
package.json              explicit browser ES-module semantics for Node tests
config.yaml               runtime/model policy
```

`archive/precode/` is historical reference only. Production code and CI must not import from it.

Local-only files remain outside Git:

```text
api.txt
runtime_logs/
.venv/
```

## Tests

### Python regression tests

Offline and secret-free:

```bash
PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"
```

### Browser module tests

```bash
node --test src/tests/js/*.test.mjs
```

On the VPS, also verify the exact system Node used by the updater:

```bash
sudo /usr/bin/node --test src/tests/js/*.test.mjs
```

### Syntax checks

```bash
python -m compileall -q src/e_kaiwa src/app.py src/tests/system/check_system.py deploy/updater

for file in src/web/*.js; do
  node --input-type=module --check < "$file"
done
```

### System smoke test

The system test starts the real local server, checks HTTP/frontend assets, and requests a real Gemini ephemeral session token. It requires internet access and valid keys in `api.txt`.

```bat
src\tests\run_system.bat
```

The final browser microphone / Gemini Live audio path still requires a real browser/device test.

## CI

GitHub Actions currently runs:

- Python 3.12;
- Node 18.19.1;
- Python core regression tests;
- browser module tests;
- Python compile checks;
- JavaScript module syntax checks.

CI intentionally avoids Gemini secrets and external realtime calls.

## Manual mobile checks still worth doing

Automated tests cover the code paths, but the following remain important on real hardware:

1. Leave Push-to-Talk idle for more than 10–15 minutes and confirm Live reconnect/resumption is transparent.
2. Disable and re-enable Wi-Fi during a turn and confirm recovery without a page refresh.
3. Stream a long reply and confirm no repeated scroll jumping or bottom-dock overlap.
4. Verify replay / score interactions on iPhone and Android.
5. On iPhone Chrome, approve the mic once, then change language / reconnect Gemini / speak again and confirm the same page session does not request mic permission again.
6. Close and reopen the page and confirm the browser's saved site permission behaves as expected.

## Design principles

Keep the project simple:

- vanilla browser modules + Python;
- one realtime pipeline;
- one Coach service;
- one language registry;
- one recovery path;
- one lightweight VPS process;
- modular ownership instead of framework rewrites;
- optimize for maintainability, mobile reliability, and low operational cost.
