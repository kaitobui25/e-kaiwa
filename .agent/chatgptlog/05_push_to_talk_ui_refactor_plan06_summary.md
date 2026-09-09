# ChatGPT Log 05 — Push-to-talk refactor, UI cleanup, Plan 06 reference UI rebuild

## Scope

This log summarizes the work after `04_mobile_public_ui_token_fix_summary.md` through completion of Plan 06.

Main themes:
- investigate VPS deployment direction
- fix public UI regressions after Plan 04
- redesign conversation input into Push-to-talk / Hands-free modes
- simplify learner message + Coach UX
- create and implement Plan 06 based on `.agent/assets/01_ui.png`
- modularize frontend UI without introducing a framework
- test UI/UX and merge safely through a feature branch + PR

---

## 1. VPS deployment research

The repo was reviewed for production deployment on a small Ubuntu VPS (target: ~1 GB RAM).

Recommended deployment architecture:

```text
Internet / Phone
      |
    HTTPS
      |
    Caddy
  :80 / :443
      |
      v
127.0.0.1:7860
      |
 E-KAIWA Python
 --mode public
      |
      +---- Gemini HTTP (Coach / token)
      |
Browser -------- direct WebSocket --------> Gemini Live
```

Key decisions:
- keep one Python process only
- no Docker / Kubernetes / Gunicorn multi-worker for current MVP
- use Python venv + systemd + Caddy
- app stays bound to `127.0.0.1:7860`
- only reverse proxy ports should be public
- `E_KAIWA_TRUST_PROXY=true` only when backend is localhost-only behind trusted proxy
- `api.txt` stays untracked and should be deployed manually with restrictive permissions
- `runtime_logs` needs a simple retention policy later

Important architecture note:
- `SessionStore` and public rate-limit state are currently in memory
- therefore multiple application workers would break session affinity unless architecture changes

No deployment implementation was done in this phase.

---

## 2. Git push rejection explanation

A local push was rejected because both local and remote had commits the other side did not have:

```text
! [rejected] main -> main (fetch first)
```

Meaning:
- local branch was ahead of local `origin/main`
- actual GitHub `main` had also advanced independently
- Git required integration before push

This later reinforced the decision to use feature branches + PRs for larger UI work.

---

## 3. UI regressions after Plan 04

Reported issues included:
- replay button intermittently not working
- incorrect-word speaker button intermittently not working
- replay audio could be captured into the conversation while recognition was active
- center mic icon not visually centered
- settings gear not visually centered

Root cause direction:
- frontend state had too much coupling between concepts like recording, active turn, input forwarding and playback blocking
- manual playback and microphone forwarding could race

Instead of patching individual symptoms, the conversation flow was redesigned.

---

## 4. Plan 05 — Push-to-talk / Hands-free architecture

User-defined UX:

### Talk OFF — default

Push-to-talk mode:

```text
hold mic
  -> start user activity
  -> stream PCM
release
  -> stop forwarding
  -> end user activity
  -> Gemini replies
```

Expected UI:
- learner sentence visible
- learner replay available
- Coach score visible
- Coach detail can include correction / problem words / audio controls

### Talk ON

Hands-free mode:
- automatic Gemini VAD
- continuous conversation

Expected UI:
- learner sentence visible
- Coach score visible
- clicking score opens text-only Coach detail
- no learner replay
- no correction speaker
- no problem-word speaker

Core state separation introduced conceptually / in implementation:

```text
conversationMode
conversationActive
pushToTalkPressed
pushActivityOpen
inputForwarding
playbackBusy
```

Important invariant:
- in push-to-talk mode, playback completion must never reopen mic forwarding
- only user press/release owns microphone forwarding
- hands-free mode may auto-resume forwarding when playback ends

Plan file created:

```text
.agent/chatgptplan/05_push_to_talk_hands_free_refactor_plan.md
```

Implementation branch originally:

```text
feature/05-talk-modes
```

PR #14 was created and later merged into `main` after CI passed.

Important Plan 05 outcome:
- Talk OFF became the default public behavior
- Talk ON remained automatic VAD behavior
- playback/mic race behavior was significantly simplified

---

## 5. Compact learner message / Coach UX cleanup

Several UI passes were made after Plan 05.

### Sticky header

`E-KAIWA` should remain pinned at the top while chat scrolls.

### Learner turn simplification

Old verbose presentation like:

```text
Bạn
85
Do you hear me?
Phản hồi phát âm & diễn đạt
85
```

was simplified to essentially:

```text
Do you hear me?  🔊  85
```

Rules:
- no redundant `Bạn` label
- no duplicate Coach label
- no duplicate score
- replay and Coach score sit inline after the learner sentence
- if learner sentence wraps, controls naturally follow on the final line

### Coach interaction

- click score to open Coach detail
- click outside Coach to collapse it
- opening another Coach closes the previous one
- Escape also closes

### Bottom dock overlap

Conversation bottom safe-space was increased so the last message can scroll fully above the fixed voice control.

### Settings cleanup

Settings was moved to a real modal/sheet style with backdrop:
- fixed consistent position
- backdrop/outside tap closes
- Escape closes

These iterations were merged to `main` and covered by regression tests.

---

## 6. Plan 06 — Build UI from reference image

Reference image:

```text
.agent/assets/01_ui.png
```

Plan created:

```text
.agent/chatgptplan/06_reference_ui_rebuild_plan.md
```

Design principle:
- use the reference as visual direction
- do not copy all 8 shown mockup screens into 8 separate pages
- keep current MVP product scope
- avoid framework / state-library overengineering

Planned core UI:

```text
1 app shell
+ conversation renderer
+ one reusable overlay system
    - Coach overview
    - natural expression / correction
    - problem word detail
    - learner replay
    - settings
```

Welcome screen and session-result screen were intentionally deferred because the current backend/product flow does not require them yet.

---

## 7. Plan 06 implementation architecture

Implementation was eventually isolated correctly on:

```text
feature/06-reference-ui-rebuild
```

Frontend responsibilities were split into:

```text
src/web/ui.js
  -> facade / UI wiring / translation / integration

src/web/ui_render.js
  -> pure HTML rendering
  -> conversation turns
  -> Coach overview
  -> correction view
  -> word detail view
  -> replay view

src/web/ui_overlay.js
  -> overlay state + navigation
  -> one active overlay only
  -> settings / Coach / correction / word / replay
  -> backdrop close / Escape close

src/web/ui_icons.js
  -> lightweight local inline SVG icons

src/web/live.css
  -> visual system / semantic tokens / responsive layout

src/web/live.html
  -> public app shell + settings + overlay roots
```

No React, Vue, state framework or icon library was added.

No new runtime dependency was added.

Realtime architecture ownership stayed outside UI modules.

---

## 8. Plan 06 visual system

The public UI was restyled to follow the reference direction:
- navy text / blue primary accent
- soft AI blue bubble
- soft learner green bubble
- round avatars / icon treatment
- large center microphone button
- decorative waveform bars around mic
- sticky top header
- fixed bottom control dock
- mobile safe-area handling
- light / dark semantic CSS tokens
- Coach full sheet / desktop centered dialog behavior

Important: this is reference-inspired, not a claim of pixel-perfect reproduction.

Final visual polishing on real iPhone Safari / Android Chrome is still recommended.

---

## 9. Coach overlay system

Plan 06 changed the previous inline-expanding Coach card into a reusable overlay flow.

### Coach overview

Uses real backend data only:
- overall score
- pronunciation score
- fluency score
- intonation score
- pronunciation problems
- correction / explanation
- summary

No fake product metrics were invented just to match the mockup.

### Natural expression view

Shows:
- learner original sentence
- corrected / more natural sentence
- short explanation
- correction TTS button only when manual audio actions are allowed

### Word practice view

Shows available problem data:
- problem word
- sound issue
- heard-like text when present
- tip
- word TTS only when allowed

### Learner replay view

Uses the locally retained learner PCM:
- transcript
- lightweight waveform generated from PCM peaks
- approximate duration
- replay control

No extra audio processing framework was added.

---

## 10. Push-to-talk vs Hands-free UI invariants after Plan 06

### Push-to-talk

Allowed:
- learner replay
- Coach score
- correction audio
- problem-word audio

### Hands-free

Allowed:
- Coach score
- text Coach detail

Hidden/disabled:
- learner replay
- correction audio
- problem-word audio

The UI overlay layer does not own microphone state.

---

## 11. Settings UX after Plan 06

Settings became part of the shared overlay/sheet visual system.

Public settings include current client-side preferences such as:
- app / Coach language
- theme
- Talk mode
- AI playback speed
- pronunciation Coach toggle

Settings behavior:
- open from top gear
- one modal/sheet at a time
- backdrop closes
- Escape closes
- focus is moved into the dialog where practical

Dev-mode engineering controls remain available and visually separated from public UI.

---

## 12. Static module routing issue caught before merge

Because frontend UI was split into native ES modules, the lightweight Python server also needed to serve:

```text
/ui_icons.js
/ui_render.js
/ui_overlay.js
```

This was specifically caught during review before final merge.

`src/e_kaiwa/server.py` was updated only to add these static routes.

A regression test was also added so future refactors do not produce the failure mode:

```text
unit tests pass
but browser imports 404
```

---

## 13. UI/UX test coverage added / updated

Plan 06 validation covers:
- learner / AI message side layout
- PTT replay + Coach score behavior
- Hands-free hides manual audio actions
- pronunciation problem highlighting
- Coach overview rendering
- correction overlay rendering
- problem-word detail rendering
- replay overlay rendering
- waveform helper behavior
- one active overlay at a time
- Coach -> correction / word navigation
- backdrop close
- Escape close
- settings overlay behavior
- public/dev mode separation
- sticky header
- fixed mic dock
- safe-area spacing
- small mobile width rules
- semantic dark/light tokens
- static server routes for all browser modules
- JavaScript syntax
- Python syntax

CI checks:

```text
Python core regression tests     PASS
Browser module tests             PASS
Python syntax check              PASS
Browser JavaScript syntax check  PASS
```

Tests ran successfully on:
- feature branch
- PR
- final `main` merge commit

---

## 14. Branch / PR workflow correction

During Plan 06, some staging commits initially landed on `main` before the user clarified that implementation must happen on a feature branch.

Corrective action:
- preserve implementation on `feature/06-reference-ui-rebuild`
- reset `main` back to the Plan 06 base commit
- continue implementation/testing only on branch
- ensure branch was based cleanly on Plan 06
- open PR only after branch CI passed

Final PR:

```text
PR #15 — Implement Plan 06 reference mobile UI
```

It was mergeable and CI passed before merge.

Final squash merge commit:

```text
6daadf3132445b4a34c43e736fe4b3698fa3918a
```

Post-merge `main` CI also passed.

---

## 15. Current runtime command

Public app:

```powershell
python src\app.py --mode public
```

Dev / engineering mode:

```powershell
python src\app.py --mode dev
```

Models still come from `config.yaml`, not CLI flags.

---

## 16. Current repository state at end of this chat

Main implementation state:

```text
main = 6daadf3132445b4a34c43e736fe4b3698fa3918a
```

Plan 06 is merged and automated CI is green.

Feature branch may still exist remotely unless manually deleted; branch deletion was not part of the Plan 06 merge step.

Important files going forward:

```text
.agent/chatgptplan/05_push_to_talk_hands_free_refactor_plan.md
.agent/chatgptplan/06_reference_ui_rebuild_plan.md
.agent/assets/01_ui.png

src/web/live.html
src/web/live.css
src/web/ui.js
src/web/ui_render.js
src/web/ui_overlay.js
src/web/ui_icons.js
src/web/live.js
src/web/audio.js
src/e_kaiwa/server.py
```

---

## 17. Recommended next step

Do not do another major refactor immediately.

Next step should be real-device visual validation:

1. pull current `main`
2. run `python src\app.py --mode public`
3. test desktop browser
4. test real mobile browser over HTTPS
5. capture screenshots of:
   - conversation screen
   - Coach overview
   - correction view
   - settings
6. compare visually with `.agent/assets/01_ui.png`
7. make a small visual-polish pass only (spacing, sizing, typography, dock height, overlay sizing)

Avoid changing realtime/audio logic during visual polish unless a real functional bug is reproduced.
