# E-KAIWA Mobile Conversation + Coach UI Plan

Status: **approved and implemented**.  
Implementation follows the approved scope below; verification is tracked by repository CI.

## Goal

Refine the current mobile UI shown in the user screenshots without changing the existing realtime architecture.

Priorities:
- simpler composition;
- less duplicated UI;
- clearer learning flow;
- clean vanilla HTML/CSS/JS;
- no new framework/dependency;
- reuse existing audio, score, overlay, i18n, and target-language state;
- avoid backend/audio-session changes unless strictly required.

## Scope

Primary files:
- `src/web/live.html`
- `src/web/public.css`
- `src/web/ui.js`
- `src/web/ui_render.js`
- `src/web/ui_overlay.js`

Only touch `live.js` / `audio.js` if the replay progress UI cannot be implemented cleanly through the existing playback callback/state.

Add/update targeted JS tests for the changed rendering and overlay interactions.

---

## 1. Talk dock cleanup

Current issue: the push-to-talk instruction can appear twice.

Change:
- show the current talk instruction only once, below the microphone;
- keep the lower label visually quiet/muted, matching the current subtle status text;
- do not duplicate `Chạm và giữ để nói` above the microphone;
- preserve useful temporary states such as connecting, waiting, AI speaking, reconnect, and errors without creating duplicate idle text.

Keep the microphone as the primary control.

## 2. Reduce gap between conversation and talk dock

- slightly tighten the visual space between the conversation card and the fixed control dock;
- preserve safe-area spacing and prevent overlap on iPhone;
- do not make the conversation area cramped;
- tune existing spacing/reserved dock height instead of introducing a new layout system.

Target: the two main regions should look related and balanced on mobile.

## 3. Dock language must show the language being learned

Current behavior: `quick-language` follows the UI/feedback language.

Change:
- make `quick-language` display the selected **target language** instead;
- examples:
  - `en` -> English
  - `ja` -> 日本語
  - `zh-Hans` -> 中文
- keep feedback/UI language separate in Settings;
- reuse existing target-language state instead of creating duplicate state.

## 4. Center the dock metadata as one group

The target-language label and playback speed (for example `English   0.8×`) should:
- sit together on one row;
- be centered as a group below the main talk control;
- use quiet secondary styling;
- keep enough spacing/touch clarity without spreading to opposite sides.

---

## 5. Remove replay/mic button from the user message bubble

Current user message actions contain:
- replay button;
- score ring.

Change:
- remove the standalone replay/mic action from the user message;
- keep only the score ring/badge next to the user utterance;
- clicking the score continues to open the Coach overlay.

Do not duplicate the same replay entry point in the conversation bubble and Coach overlay.

---

## 6. Coach: pronunciation details become an expandable disclosure

Current Coach overview immediately shows:
- total score;
- pronunciation detail rows;
- problem words;
- natural expression.

New behavior:
- initial Coach view shows the score hero but **does not show pronunciation metric rows**;
- make the score hero / score ring an accessible button/disclosure;
- tapping the `65` area or score ring toggles `Chi tiết phát âm`;
- when expanded, show Accuracy / Fluency / Intonation directly under the score;
- tapping again can collapse it;
- preserve keyboard/focus accessibility and `aria-expanded`.

No new secondary popup is needed for these three metrics.

---

## 7. Put the learner voice replay directly under the score

Directly below the score/disclosure area:
- add one compact control for the learner's recorded voice;
- reuse the existing per-turn recorded PCM/replay data;
- pressing it plays/stops the learner recording;
- the control contains a circular progress ring that advances with playback duration;
- progress resets when playback finishes/stops;
- disable/hide it when replay data is unavailable or when audio actions are temporarily blocked.

Implementation preference:
- keep playback ownership in the existing playback coordinator;
- expose only the minimum progress/state needed by the Coach UI;
- do not add another audio engine or duplicate audio buffers.

If exact playback duration/progress is not currently exposed, add the smallest callback/state extension required.

---

## 8. Natural-expression row comes next, with playback on the same row

Below learner replay:
- show `Cách nói tự nhiên hơn`;
- display the corrected/natural sentence;
- put the sentence playback button on the same row;
- pressing playback should use the existing correction speech action;
- the row itself may still open the detailed correction view, but the playback button must not require opening another screen first.

Keep the interaction simple and avoid nested card-on-card styling.

---

## 9. Problem words move below Natural Expression

Final Coach overview order:

1. Header
2. Total score
3. Expandable pronunciation details (hidden by default)
4. Learner voice replay + circular playback progress
5. Natural expression + playback button on the same row
6. `Từ cần chú ý`
7. Existing short pronunciation summary/note only if it still adds useful information

Problem-word drill behavior remains unchanged.

---

## Code structure

Keep current module boundaries where possible:

- `ui_render.js`: markup/render helpers only.
- `ui_overlay.js`: Coach disclosure state and overlay interaction.
- `ui.js`: conversation/dock state and target-language label.
- `public.css`: layout and visual styling.
- audio playback logic remains in the existing playback layer.

Do not:
- introduce React/Vue/Svelte;
- add a state-management library;
- create a generic component framework;
- create many tiny modules for this one change;
- duplicate target-language or playback state;
- rewrite unrelated realtime/session code.

## Tests / verification

Targeted automated checks:
- conversation user row renders score but no standalone replay button;
- target-language metadata renders from target language, not UI language;
- Coach metrics are hidden initially;
- score disclosure toggles metrics;
- Coach section order is correct;
- learner replay action is present only when playable;
- natural-expression playback action remains wired correctly;
- existing overlay navigation still works.

Run the existing JS tests relevant to UI/render/overlay/audio plus Python/system smoke tests if the changed code touches shared behavior.

Manual mobile verification:
- 320 / 375 / 390 / 430 px widths;
- iPhone safe area;
- light + dark theme;
- Vietnamese and Japanese UI;
- English / Japanese / Chinese target language;
- long learner sentence;
- push-to-talk ready / pressed / waiting / speaking states;
- Coach score collapsed + expanded;
- learner replay start/progress/finish;
- natural-expression playback;
- problem-word navigation.

## Definition of done

- `Chạm và giữ để nói` is not duplicated.
- Conversation/dock spacing is visibly tighter but does not overlap.
- Dock shows the language being learned and centers it with speed.
- User bubble contains score but no separate replay/mic button.
- Pronunciation metrics are hidden until the score is tapped.
- Learner voice replay lives under the score and shows real playback progress.
- Natural expression is above problem words and has playback on the same row.
- Existing realtime behavior, settings, themes, and accessibility remain intact.
- No unnecessary dependency, framework, backend refactor, or audio rewrite.
- Code remains simple enough to maintain without a new UI abstraction layer.
