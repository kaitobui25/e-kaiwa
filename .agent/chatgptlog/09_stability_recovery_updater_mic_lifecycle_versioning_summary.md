# E-KAIWA — Stability / Recovery / Updater / Mic Lifecycle Conversation Summary

Date: 2026-09-10
Repo: `kaitobui25/e-kaiwa`

## Final state

Current app version: **0.11**

Version sequence decided in this conversation:

```text
0.9  -> mobile public UI refresh
0.10 -> realtime/network/UI/updater stability fixes
0.11 -> iPhone/Chrome microphone lifecycle fix
```

Do not use `1.0` / `1.1` for these releases. Historical commit messages may still contain those old labels because Git history was not rewritten.

---

# 1. VPS Browser test failure investigation

Observed updater result on VPS:

```text
Browser tests: 10 pass / 6 fail
```

Initial hypothesis was that Node module detection was failing generally. User then ran:

```bash
node --test src/tests/js/ui_overlay.test.mjs
```

with:

```text
Node v20.20.2
12 pass / 0 fail
```

This disproved the initial hypothesis that the current JS/test code itself was broken.

Further investigation confirmed two Node installations:

```text
interactive ubuntu shell:
node -> ~/.nvm/versions/node/v20.20.2/bin/node

systemd/root updater:
/usr/bin/node -> v18.19.1
```

The updater invokes `node` from the systemd/root environment, so it used Node 18, while interactive testing used NVM Node 20.

Repo browser files are ES Modules (`import` / `export`) but the repo originally had no root `package.json` declaring module semantics. Under the VPS updater environment this caused six test files to die at module-load time, while `language_policy.test.mjs` still passed its 10 tests because it loaded the module through a data URL.

Confirmed interpretation of `10 pass / 6 fail`:

- 10 actual tests from `language_policy.test.mjs` passed
- 6 other test files failed at module loading
- not six broken application features
- not a v0.9 UI regression

Fix implemented in stability work:

```json
{
  "type": "module"
}
```

at repo root.

CI was also pinned to Node **18.19.1** so CI matches the VPS updater environment instead of silently testing only on a newer Node.

Preferred architecture decision:

- keep updater using system `/usr/bin/node`
- do not hardcode Ubuntu user's NVM path into root/systemd service
- make module semantics explicit in the repo

---

# 2. Consolidated stability plan

The confirmed issues were summarized into:

`.agent/chatgptplan/11_realtime_ui_updater_stability_fix_plan.md`

Main items:

1. Gemini Live idle/session expiry
2. network loss / stale active turn
3. streaming scroll/render jitter
4. replay/score interaction quality
5. Settings border regression
6. updater warning popup disappears too fast
7. updater log discoverability
8. VPS Node/ESM mismatch

Implementation principles requested by user:

- clean code
- modular ownership
- easy maintenance / upgrade
- performance conscious
- avoid overengineering
- keep existing vanilla JS + Python architecture
- no React/Vue rewrite

---

# 3. Realtime session lifecycle fix — target release 0.10

Root problem:

Talk OFF did not mean Gemini was disconnected. The page opened the Gemini Live WebSocket during bootstrap and left it aging while the user was idle. Gemini Live connections are finite-lived, while the frontend originally ignored top-level `goAway` and `sessionResumptionUpdate` messages.

Implemented:

- Gemini `sessionResumption`
- latest resumption handle storage
- top-level `sessionResumptionUpdate` handling
- `GoAway` handling and scheduled reconnect
- new ephemeral token for every new WebSocket
- transparent resume where possible
- fresh-session fallback when resume fails
- unexpected hard-close recovery
- context-window compression for longer Live conversations

Recovery logic was centralized rather than duplicated across UI handlers.

A dedicated `live_recovery.js` module was introduced for focused recovery/session mechanics while `live.js` remains the main realtime orchestrator.

---

# 4. Network-loss / stale-turn recovery — target release 0.10

Original failure mode:

```text
PTT creates activeTurn
-> network dies around activityEnd
-> Gemini never receives final event
-> no turnComplete
-> activeTurn stays stuck
-> reconnect/settings changes can remain blocked
-> page refresh appears to fix it
```

Implemented:

- browser `offline` event handling
- browser `online` event handling
- abort stale/incomplete active turn on forced recovery
- automatic reconnect on network return
- response watchdog after PTT `activityEnd`
- watchdog timeout marks socket unhealthy and triggers recovery
- unified recovery path for network, timeout, WebSocket close and GoAway

Added diagnostic UI events such as:

```text
ws_open
ws_setup_complete
ws_error
ws_close
go_away
session_resumption_update
browser_offline
browser_online
ptt_start
ptt_end
response_timeout
reconnect_attempt
reconnect_result
```

No auth token or resumption secret is logged.

---

# 5. Streaming render / scroll performance — target release 0.10

Original root cause:

Each partial Gemini transcript chunk triggered a full conversation render and smooth scroll. This repeatedly replaced DOM nodes while bubble height changed, causing visible jitter and sometimes unstable replay/score interactions.

Implemented:

- partial streaming updates only the active turn text where possible
- avoid full `conversation.innerHTML` replacement for every chunk
- controlled autoscroll
- autoscroll only when user is already near the bottom
- manual upward scrolling is respected
- stable action DOM during streaming
- bottom dock spacing consolidated more cleanly

Goal: long streaming replies should not repeatedly jump or hide the last line behind the fixed mic dock.

---

# 6. Replay / score UI interaction — target release 0.10

The problem was not mainly touch target size; controls were already near 44 px.

Problems included:

- controls embedded too closely with message prose
- flattened visual feedback
- DOM replacement during streaming
- actions could be silently ignored while audio state was unavailable

Implemented:

- stable `.message-actions` row below message text
- clear tap/active feedback
- explicit unavailable/disabled behavior instead of silent no-op
- replay state integrated with existing playback ownership
- action targets remain stable during transcript streaming

---

# 7. Settings border regression — target release 0.10

v0.9 `public.css` flattened Settings too aggressively, including borderless select controls and weak section boundaries.

Implemented:

- subtle functional borders restored
- clear select/control hierarchy
- light/dark readability preserved
- no return to heavy nested-card design

---

# 8. Updater failure popup UX — target release 0.10

Confirmed updater behavior already correctly logged test failures to:

```text
/var/lib/ekaiwa-update/updater.jsonl
```

The real UI bug was that a deployment with test warnings could reach `complete`, show failures, then reload roughly 1.2 seconds later, giving the user almost no time to read the result.

Implemented behavior:

```text
all checks PASS + health PASS
-> brief success
-> auto reload allowed

health PASS but tests/checks contain warnings
-> warning result remains visible
-> no automatic reload
-> explicit Close button
-> Close reloads the new frontend

start/health/update fatal failure
-> blocking error remains visible
-> no fake success
```

Updater logging architecture was kept simple; no duplicate log system was added.

Operational documentation now distinguishes:

```text
conversation log:
~/e-kaiwa/runtime_logs/YYYY-MM-DD/<session>/conversation.jsonl

UI event log:
~/e-kaiwa/runtime_logs/YYYY-MM-DD/ui_events.jsonl

updater log:
/var/lib/ekaiwa-update/updater.jsonl

updater current status:
/var/lib/ekaiwa-update/status.json
```

---

# 9. Stability implementation PR

PR #18:

`Stabilize realtime recovery, public UI, and VPS updater`

The release should be understood as **0.10**.

Major scope:

- Live resumption / GoAway / recovery
- offline/online + watchdog
- incremental transcript rendering
- replay/score action stability
- Settings visual boundaries
- maintenance warning result + Close
- updater log documentation
- root ESM package declaration
- CI on Node 18.19.1

PR-level and post-merge CI passed.

---

# 10. New bug: iPhone Chrome asks for microphone approval again

User reported that after changing language or reconnecting Gemini, Chrome on iPhone appeared to request mic approval again.

Root cause was in the app microphone lifecycle, not Gemini itself.

Before fix, reconnect/settings transitions could call microphone cleanup that eventually did:

```js
track.stop()
```

Then the next PTT/hands-free start needed a new:

```js
navigator.mediaDevices.getUserMedia(...)
```

On iPhone/Chrome (WebKit-based), repeatedly destroying and reacquiring the stream makes re-prompt behavior much more likely.

Important distinction:

- the app cannot force the browser to grant microphone permission forever
- browser/iOS owns persistent site permission
- the app should avoid unnecessarily destroying an already granted capture

Desired UX:

```text
first mic use
-> getUserMedia
-> user Allow

same page session:
change language / Gemini reconnect / finish PTT / recover network
-> reuse granted MediaStream
-> no new getUserMedia prompt

page is closed/reloaded
-> old MediaStream is gone
-> app must call getUserMedia again
-> if browser remembered site permission, it should grant without another prompt
```

Permission may still need approval again if the user revokes/reset permissions, removes site data/settings, uses a private context, changes origin/domain, reinstalls/reset browser state, etc.

---

# 11. Microphone lifecycle implementation — release 0.11

Implemented a clean separation between:

```text
Gemini WebSocket lifecycle
!=
Microphone MediaStream lifecycle
```

New microphone behavior:

- reconnect Gemini: pause capture, do not stop track
- change language: pause capture, do not stop track
- PTT release: pause capture, do not stop track
- network recovery: pause capture, do not stop track
- next PTT/hands-free start: reuse same stream when healthy
- `track.stop()` only on real page teardown or broken/stale capture

`audio.js` gained focused helpers:

```text
microphoneCaptureReusable
resumeMicrophoneCapture
pauseMicrophoneCapture
releaseMicrophoneCapture
```

Important iOS race discovered during self-review:

Initially pause also suspended `AudioContext`. A rapid user re-press could race with a pending `suspend()` completing after `resume()`.

Final decision:

```text
pause = disable audio track only
no AudioContext.suspend() during normal pause
```

This keeps capture reusable and avoids the mobile Safari/WebKit suspend/resume race.

Full release still:

- disables tracks
- disconnects processor/source
- calls `track.stop()`
- closes AudioContext

but only for true teardown/stale capture.

Regression tests were added for:

- pause keeps capture reusable
- pause does not stop track
- release destroys capture
- ended track is not reusable
- Gemini reconnect uses pause, not release
- PTT release uses pause, not release
- page teardown performs full release

---

# 12. Mic lifecycle PR

PR #19:

`Reuse microphone permission across Live reconnects`

Correct release interpretation: **0.10 -> 0.11**.

Merged to `main`.

Post-merge GitHub Actions Core checks passed.

---

# 13. Version numbering correction

Assistant initially treated releases as:

```text
0.9 -> 1.0 -> 1.1
```

User corrected the required convention:

```text
0.9 -> 0.10 -> 0.11
```

This is now the project convention for these incremental releases.

Actions taken:

- runtime `__version__` corrected from `1.1` to `0.11`
- PR #18 description corrected to release `0.10`
- PR #19 description corrected to `0.10 -> 0.11`
- PR #20 created specifically for the runtime version correction

PR #20:

`Correct app version sequence to 0.11`

CI passed and PR #20 was merged.

Current source:

```python
__version__ = "0.11"
```

Historical merge commit text mentioning `1.0` / `1.1` was not rewritten, by design.

Future incremental versions should continue:

```text
0.12
0.13
0.14
...
```

unless the user explicitly changes the versioning policy.

---

# 14. Current main status at end of conversation

Current app version: **0.11**

Main contains:

- Plan 11 stability implementation
- explicit ESM package config
- Node 18 CI alignment
- Live session recovery/resumption
- network watchdog/recovery
- incremental transcript rendering
- replay/score UI improvements
- Settings boundary restoration
- updater warning popup Close behavior
- updater log documentation
- reusable microphone capture lifecycle for iPhone/Chrome

Key merged PRs:

```text
#18 stability/realtime/UI/updater -> 0.10
#19 microphone lifecycle          -> 0.11
#20 version numbering correction  -> current 0.11
```

---

# 15. Manual checks still important on real devices

Automated tests and CI pass, but these should still be verified on real iPhone/Android hardware:

1. Leave Talk OFF idle >10–15 minutes and confirm transparent Live recovery.
2. Disable/enable Wi-Fi during a turn and confirm no page refresh is needed.
3. Stream a long answer and confirm no scroll jitter / bottom overlap.
4. Replay/score controls respond reliably on mobile.
5. On iPhone Chrome:
   - approve mic once
   - speak
   - change target/app language
   - speak again
   - force/reach Gemini reconnect
   - speak again
   - no extra microphone permission prompt should occur within the same page session.
6. Close/reopen the page and verify Chrome's saved site permission grants mic without a prompt when browser permission state allows it.

---

# 16. Guidance for the next AI/session

When continuing this repo:

- treat **0.11** as the current app version at the end of this chat
- follow version sequence `0.9 -> 0.10 -> 0.11 -> 0.12...`
- do not interpret old `1.0/1.1` commit messages as current version policy
- keep microphone capture lifetime independent from Gemini socket lifetime
- normal reconnect/settings/PTT end must not call `track.stop()`
- preserve explicit root ESM semantics so `/usr/bin/node` Node 18 tests remain deterministic
- keep updater system Node independent from user's NVM installation
- use one centralized Live recovery path; do not create parallel reconnect systems
- keep architecture vanilla JS + Python unless there is a strong reason to change
- favor clean, modular, maintainable fixes over framework rewrites or overengineering
