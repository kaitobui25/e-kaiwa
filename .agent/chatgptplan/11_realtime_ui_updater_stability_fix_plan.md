# E-KAIWA — Realtime / UI / Updater Stability Fix Plan

Status: PLAN ONLY — no implementation in this commit.
Current deployed version: 0.9
Target after implementation: 1.0

## Goals

Fix the currently confirmed realtime, UI/UX, maintenance/update, and VPS test-environment problems without overengineering.

Principles:
- keep current vanilla JS + Python architecture
- clean, small modules with clear ownership
- avoid duplicate reconnect/recovery systems
- preserve PTT, Hands-free, Coach, replay, Settings, maintenance mode
- mobile-first, especially iPhone Safari and Android Chrome
- public UI shows short useful errors; private logs keep diagnostic detail

---

# Priority summary

P0
1. Gemini Live session expires/disconnects while Talk OFF / app idle
2. Network loss can leave an active turn stuck until page refresh

P1
3. Streaming transcript scroll/render jitter and content near fixed mic dock
4. Replay / score interaction feels unreliable or gives no feedback
5. Settings borders / visual boundaries disappeared in v0.9
6. Update test-failure popup disappears before user can read it
7. Updater log location is unclear to operator
8. VPS updater Browser tests fail because systemd uses Node 18 while shell uses Node 20

---

# 1 — Gemini Live idle disconnect / finite session lifecycle

Priority: P0
Type: realtime/session lifecycle

## Confirmed root cause

Talk OFF does not mean there is no Gemini connection.

Current page boot opens a Gemini Live WebSocket immediately. The socket remains alive while the user is idle in Settings or not pressing the mic. Gemini Live connections have finite lifetime and the current frontend does not implement session resumption / GoAway handling.

Current weaknesses:
- page opens Live session on bootstrap
- top-level `goAway` is ignored
- `sessionResumptionUpdate` is ignored
- no latest resumption handle is stored
- no transparent socket rotation/resume
- unexpected close falls directly to reconnect UI

This is not primarily a Wi-Fi problem and should not be solved with dummy audio/text keepalive.

## Fix

Use one explicit Live-session recovery path:

1. Enable Gemini `sessionResumption` in setup config.
2. Store the latest `sessionResumptionUpdate` handle.
3. Handle top-level `goAway`.
4. If idle/no active learner turn, reconnect before/when current socket expires and resume transparently.
5. On unexpected hard close, attempt resume first.
6. Fetch a new ephemeral auth token for every new WebSocket.
7. Keep auth token and resumption handle as separate concepts.
8. If resume fails, create a clean fresh Live session.
9. Do not close the socket merely because Settings is open.
10. Do not add dummy audio/text pings.

## Module ownership

Prefer keeping orchestration in `src/web/live.js` initially.
Only extract a small `live_session.js` if reconnect/resume code becomes too large.

## Files likely involved

- `src/web/live.js`
- `src/e_kaiwa/gemini.py` only if setup/token data contract needs adjustment
- JS tests

## Done when

- leave Talk OFF idle for >10–15 minutes without unexplained permanent disconnect
- expiry/GoAway reconnect is transparent when safe
- active PTT/Hands-free behavior is unchanged
- no token reuse across new sockets

---

# 2 — Network loss leaves stale active turn / UI frozen

Priority: P0
Type: realtime recovery/state machine

## Confirmed root cause

A turn can remain stuck when network dies around PTT release:

- PTT creates `activeTurn`
- release sends `activityEnd` only while socket appears OPEN
- network failure can make the browser socket state stale temporarily
- Gemini never receives the final event
- no `turnComplete` returns
- `activeTurn` never clears
- existing reconnect request can be blocked because input/active turn is still considered busy
- page refresh clears stale state, which is why refresh recovers it

There are also no browser `online` / `offline` recovery hooks and no response watchdog.

## Fix

Create one centralized recovery helper shared with Bug #1.

On `offline`:
- stop accepting new mic input
- abort incomplete active turn locally
- clear waiting state
- clean up PTT capture / playback state safely
- mark Live unavailable

On `online`:
- resume/reconnect automatically
- wait for `setupComplete`
- return UI to Ready only after connection is healthy

Add stale-response watchdog:
- start after learner `activityEnd`
- reset/cancel when valid Gemini traffic arrives
- timeout => mark socket unhealthy, abort stale turn, reconnect/resume

Target-language changes must be able to force recovery when an obsolete active turn would otherwise block reconnect.

## Observability events

Add concise UI-event diagnostics:
- `ws_open`
- `ws_setup_complete`
- `ws_error`
- `ws_close`
- `go_away`
- `session_resumption_update`
- `browser_offline`
- `browser_online`
- `ptt_start`
- `ptt_end`
- `response_timeout`
- reconnect attempt/result

Do not log secrets or auth tokens.

## Files likely involved

- `src/web/live.js`
- optional small `live_session.js`
- existing UI event logging path
- JS tests

## Done when

- disable Wi-Fi during/after PTT, re-enable Wi-Fi, app recovers automatically
- no page refresh required
- stale `activeTurn` cannot block recovery forever
- target-language change still works after network interruption

---

# 3 — Streaming transcript scroll/render jitter

Priority: P1
Type: UI/UX + rendering performance

## Confirmed root cause

Current streaming path repeatedly performs full conversation render and smooth-scroll while partial Gemini transcript chunks arrive.

This causes:
- repeated DOM replacement
- new smooth-scroll animation before previous one finishes
- message bubble height changes during stream
- active controls can be replaced while user interacts
- last content can temporarily sit too close to / behind fixed mic dock

v0.9 changed visual spacing but did not fix this rendering architecture.

## Fix

1. Do not full-render the whole conversation for every partial transcript chunk.
2. During streaming, update only the active user/assistant text node when possible.
3. Full render only for structural changes: new turn, Coach result, mode/state changes.
4. Auto-scroll only if the user is already near the bottom.
5. Do not drag the user back down while they are manually reading older messages.
6. During partial streaming use immediate controlled scroll or no forced scroll.
7. Optional one-time smooth scroll when turn completes.
8. Define one CSS variable for bottom dock safe area instead of unrelated magic numbers.

## Files likely involved

- `src/web/live.js`
- `src/web/ui.js`
- `src/web/ui_render.js`
- `src/web/live.css`
- `src/web/public.css`
- JS tests

## Done when

- long streaming response does not repeatedly jump
- last line remains readable above mic dock
- manual upward scroll is respected
- DOM actions are not unnecessarily recreated each chunk

---

# 4 — Replay / score interaction quality

Priority: P1
Type: UI/UX interaction

## Current finding

This is not mainly a touch-target-size problem: controls are already around the 44 px mobile target.

Problems are more likely from:
- flattened v0.9 visuals
- replay/score controls embedded directly inside message text layout
- global tap highlight removed without strong replacement feedback
- full DOM replacement during streaming
- valid taps may be ignored silently when audio/action state disallows the action

## Fix

1. Keep minimum touch target around 44x44.
2. Move replay/score into a stable `.message-actions` area below message text instead of embedding controls inside prose.
3. Add obvious mobile `:active` feedback: small scale/background/opacity response, respecting reduced motion.
4. For temporarily unavailable replay/action:
   - disable it visibly, or
   - show a short reason
   - never silently accept a tap and do nothing
5. Represent replay state clearly: idle / playing / unavailable.
6. Fix Bug #3 incremental rendering first so pointer targets stay stable.

## Files likely involved

- `src/web/ui_render.js`
- `src/web/ui.js`
- `src/web/live.js`
- `src/web/live.css`
- `src/web/public.css`
- JS tests

## Done when

- replay and score respond reliably to one tap
- immediate visual acknowledgment exists
- no silent valid-tap ignore
- controls do not jump/wrap awkwardly inside text

---

# 5 — Settings lost visual borders / hierarchy

Priority: P1
Type: UI/UX regression from v0.9

## Confirmed root cause

`public.css` intentionally flattened Settings too far, including borderless select controls and weaker section boundaries.

Result:
- select controls no longer visually read as controls
- sections/rows blend together
- hierarchy is weak in both light/dark themes

## Fix

Do not return to heavy nested cards.

Restore subtle functional boundaries:
- select: 1px border
- 8–10 px radius
- transparent/surface background
- clear row separators
- switch remains visually distinct
- verify contrast in light and dark modes

## Files likely involved

- `src/web/public.css`

No JS change expected unless markup inspection shows a real structural problem.

## Done when

- all Settings controls are recognizable as interactive
- sections are easy to scan
- UI remains minimal rather than card-heavy

---

# 6 — Update failure result disappears too quickly

Priority: P1
Type: updater UI/UX

## Confirmed root cause

Current maintenance frontend receives test failures correctly, but terminal `complete` reloads the page about 1.2 seconds later.

So when deploy + health succeed but tests fail:
- updater knows the failures
- popup receives the failures
- user cannot read them before reload

There is currently no explicit Close button in the maintenance result UI.

## Fix behavior

### Case A — all checks PASS + health PASS

- show brief success
- automatic reload is OK

### Case B — deploy/health PASS but one or more tests/checks FAIL

- show warning result
- show short list of failed checks
- DO NOT auto reload
- show `Close` button
- result remains until explicit close
- `Close` reloads the page so browser gets the newly deployed frontend/assets

### Case C — update/start/health fails

- keep blocking error visible
- do not fake success
- do not auto-hide critical failure

## Files likely involved

- `src/web/live.html`
- `src/web/ui_maintenance.js`
- `src/web/maintenance.js`
- `src/web/maintenance.css`
- JS tests

## Done when

- test failure remains readable indefinitely until Close
- user can see which check failed
- Close reloads current deployed frontend
- successful clean update still has simple automatic completion

---

# 7 — Updater log discoverability

Priority: P1 documentation/operations
Type: NOT a logging bug

## Confirmed current behavior

There are three relevant log groups:

Conversation log:
`~/e-kaiwa/runtime_logs/YYYY-MM-DD/<session>/conversation.jsonl`

UI event log:
`~/e-kaiwa/runtime_logs/YYYY-MM-DD/ui_events.jsonl`

Updater log:
`/var/lib/ekaiwa-update/updater.jsonl`

Updater status:
`/var/lib/ekaiwa-update/status.json`

Systemd output is additionally available through journald.

The updater log already records test failures, check results, service start, health check and final state. The confusion came from looking only under repo `runtime_logs/`.

## Fix

No new log architecture required.

Document clearly:
- what each log contains
- exact location
- useful inspection commands

Recommended VPS commands:

```bash
sudo ls -lah /var/lib/ekaiwa-update/
sudo tail -n 100 /var/lib/ekaiwa-update/updater.jsonl
sudo journalctl -u ekaiwa-update.service -n 200 --no-pager
sudo journalctl -u ekaiwa.service -n 200 --no-pager
```

Optional later improvement only if needed:
- retain slightly richer bounded stderr/stdout per failed check
- public popup still remains short

## Done when

- operator documentation clearly identifies all three log groups
- no expectation that `updater.jsonl` appears inside repo runtime_logs

---

# 8 — VPS updater Browser tests use wrong Node environment

Priority: P1
Type: deployment/test-environment bug
Status: ROOT CAUSE CONFIRMED ON VPS

## Confirmed evidence

Interactive ubuntu shell:

```text
node -> /home/ubuntu/.nvm/versions/node/v20.20.2/bin/node
Node v20.20.2
Browser tests: 46 pass / 0 fail
```

System/root path:

```text
/usr/bin/node -> Node v18.19.1
Browser tests: 10 pass / 6 fail
```

Node 18 treats browser `.js` modules as CommonJS because the repo does not explicitly declare package module type.

The six failing test files die during module loading with errors such as:
- named export `PlaybackCoordinator` not found
- named export `LongPressController` not found
- named export `CONVERSATION_MODES` not found
- named export `OverlayState` not found

The 10 `language_policy` tests pass because that test loads its source through a data-module path instead of the same direct `.js` import mechanism.

Therefore:
- not an application regression
- not a v0.9 UI regression
- not six broken product features
- it is an inconsistent Node/module environment

## Preferred fix

Add root `package.json`:

```json
{
  "type": "module"
}
```

This makes browser `.js` module semantics explicit and removes reliance on newer Node syntax auto-detection.

Do NOT hardcode updater to the ubuntu user's NVM binary such as:
`/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node`

Reason:
- systemd updater runs as root
- NVM is user-owned
- NVM install/version can change independently
- creates fragile deployment coupling

Keep updater able to use system `/usr/bin/node`, but make repo module type explicit.

## Validation

After adding `package.json`, run using the exact Node path used by updater:

```bash
cd ~/e-kaiwa
sudo /usr/bin/node --test src/tests/js/*.test.mjs
```

Expected:

```text
tests 46
pass 46
fail 0
```

Also run normal shell test:

```bash
node --test src/tests/js/*.test.mjs
```

Both must pass.

## Files involved

- new root `package.json`
- tests only if a regression assertion around module environment is useful
- deployment docs note expected Node behavior

---

# Implementation order

## Phase A — Realtime P0

Fix #1 and #2 together.

Reason: both are the same Live connection/session lifecycle problem. There must be only one reconnect/resume/recovery state machine.

## Phase B — Rendering and conversation interaction

Fix #3 first, then #4.

Reason: stable DOM/rendering removes one major source of replay/score interaction instability.

## Phase C — Settings visual regression

Fix #5 independently in `public.css`.

## Phase D — Updater UX + test environment

Fix #8 first so updater tests become trustworthy.
Then fix #6 so test warnings remain readable.
Document #7 at the same time.

## Phase E — Regression verification

Run full Python + browser + syntax checks and manual mobile tests.

---

# Architecture guardrails

Keep ownership simple:

- `live.js`: realtime orchestration, PTT, turn lifecycle, recovery integration
- optional `live_session.js`: only connection/resumption mechanics if extraction clearly reduces complexity
- `ui.js`: DOM controller, stable partial updates, autoscroll behavior
- `ui_render.js`: markup generation and message actions
- `ui_overlay.js`: normal Coach/Settings overlays
- `public.css`: public/mobile presentation
- `maintenance.js`: updater frontend state machine
- `ui_maintenance.js`: maintenance progress/result UI
- `maintenance.css`: maintenance presentation
- `deploy/updater/update_runner.py`: updater orchestration
- `deploy/updater/update_checks.py`: check execution
- `update_status.py`: status/journal writing

Do not introduce React/Vue or a new frontend framework.
Do not duplicate reconnect logic in multiple controllers.
Do not add a new logging subsystem for updater.

---

# Final definition of done

1. Talk OFF idle >10–15 minutes does not leave the app permanently disconnected.
2. Gemini GoAway/session expiry is handled by transparent resume/reconnect when safe.
3. Wi-Fi off/on during a turn recovers without page refresh.
4. Stale `activeTurn` cannot block reconnect forever.
5. Long streaming transcript does not repeatedly jump or rebuild the full conversation unnecessarily.
6. Last message remains readable above fixed mic controls.
7. Manual upward scroll is respected.
8. Replay/score have stable placement and immediate tap feedback.
9. Valid unavailable actions never silently ignore the user.
10. Settings controls regain subtle borders/hierarchy in light and dark modes.
11. Update with test failure remains visible until user presses Close.
12. Close reloads the deployed frontend; clean successful update may auto-reload.
13. Updater log path is documented clearly: `/var/lib/ekaiwa-update/updater.jsonl`.
14. `/usr/bin/node` Browser tests pass on VPS after explicit ESM package configuration.
15. Shell Node and system Node both pass all Browser tests.
16. No regression in PTT, Hands-free, Settings, target language, Coach, replay, maintenance/update.
17. Full test suite passes before declaring target version 1.0 complete.
