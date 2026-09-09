# Plan 05 — Push-to-Talk Default + Optional Hands-Free Talk Mode

Date: 2026-09-09
Status: implementation plan

## 1. Goal

Refactor the browser conversation flow into two explicit interaction modes so microphone ownership, turn boundaries, playback, and UI behavior are easy to reason about and maintain.

Primary goals:

- Default to **Push-to-Talk**.
- Add a learner-facing **Talk** switch in public settings.
- `Talk = OFF` means push-to-talk:
  - learner holds the main microphone button to speak;
  - button press starts a Gemini user activity;
  - audio is streamed only while held;
  - button release ends the Gemini user activity and submits the turn;
  - learner replay and Coach TTS are available only while the mic is not held.
- `Talk = ON` means hands-free conversation:
  - Gemini automatic VAD owns turn boundaries;
  - the microphone stays active for continuous conversation;
  - learner replay and Coach TTS controls are hidden;
  - Coach still shows score, corrected/natural sentence, and problem words/tips.
- Fix visual centering of the main conversation control and settings icon.
- Remove ambiguous coupling between `recording`, `activeTurn`, `inputForwarding`, and playback state.

## 2. Non-goals

- No backend architecture rewrite.
- No database.
- No new audio provider.
- No change to Gemini token policy from Plan 04.
- No native mobile app.
- No new UI framework.
- No heavy generic state-management framework.

## 3. Interaction modes

Use one explicit browser preference:

```text
conversation_mode
  push_to_talk   # default
  hands_free
```

Public settings expose this as a boolean-style Talk switch:

```text
Talk OFF -> push_to_talk
Talk ON  -> hands_free
```

The persisted browser preference remains local to the device, like theme and playback speed.

## 4. Gemini turn-boundary policy

### Push-to-Talk

Configure the Live session with automatic activity detection disabled:

```text
realtimeInputConfig.automaticActivityDetection.disabled = true
```

On press:

```text
create local turn
start microphone forwarding
send realtimeInput.activityStart
```

While held:

```text
stream PCM audio chunks
```

On release/cancel:

```text
stop microphone forwarding immediately
send realtimeInput.activityEnd
```

Do not send `audioStreamEnd` for a normal push-to-talk turn.

### Hands-Free

Keep the existing automatic VAD setup:

```text
realtimeInputConfig.automaticActivityDetection.disabled = false
silenceDurationMs = configured value
```

The conversation starts once and keeps the microphone stream active. Gemini VAD ends each user turn and the existing `turnComplete` response flow advances to the next turn.

## 5. Browser state model

Avoid one flag representing several meanings.

Required explicit concepts:

```text
conversationMode
  push_to_talk | hands_free

conversationActive
  hands-free session currently listening

pushToTalkPressed
  pointer/key currently owns push-to-talk input

inputForwarding
  audio processor is allowed to send PCM to Gemini

activeTurn
  current logical learner/AI turn

playback
  Live AI playback + optional manual playback coordinator
```

Rules:

- Push-to-talk input forwarding is true only while the button is actively held.
- Hands-free input forwarding is true only while conversation is active, Gemini setup is ready, and speaker playback is not blocking input.
- Manual learner replay / Coach TTS never starts while push-to-talk is held.
- Manual playback controls do not exist in hands-free UI.
- Switching conversation mode while a conversation is active first stops local mic state, then reconnects the Gemini Live session with the new VAD policy.

## 6. UI behavior

### Talk OFF / Push-to-Talk

Main control:

```text
idle      -> microphone icon / Hold to talk
pressed   -> recording visual / Release to send
AI speaks -> disabled or non-recording state
```

Per learner turn:

- score
- learner transcript
- replay learner voice
- Coach details
  - corrected/natural sentence + speaker button
  - problem words + speaker buttons/tips

### Talk ON / Hands-Free

Main control:

```text
idle   -> Start conversation
active -> Stop conversation
```

Per learner turn:

- score
- learner transcript
- Coach details
  - corrected/natural sentence as text only
  - problem words/tips as text only

Hide completely:

- replay learner voice
- corrected-sentence speaker button
- problem-word speaker buttons

The score remains the compact entry point to Coach feedback. No hidden audio controls should appear inside Coach details in hands-free mode.

## 7. Audio ownership

Keep `PlaybackCoordinator` as the single playback owner but simplify its microphone responsibilities.

- Live AI playback still blocks microphone forwarding in hands-free mode.
- In push-to-talk mode, manual replay/TTS is naturally isolated because audio is sent only while the learner physically holds the main button.
- Manual playback should still be serialized/replaced safely; stale completion from an older manual playback must not release a newer playback state.
- Playback action failures should be observable by the caller instead of silently disappearing.

## 8. Input event policy

Use pointer events for the public push-to-talk control so mouse, touch, and pen follow one path.

Minimum handling:

```text
pointerdown    -> begin push-to-talk
pointerup      -> end push-to-talk
pointercancel  -> end/cancel safely
lostpointercapture -> end/cancel safely
```

Prevent duplicate synthetic click behavior from also toggling conversation state in push-to-talk mode.

Keyboard accessibility:

- Space/Enter press starts push-to-talk.
- key release ends push-to-talk.
- Ignore key repeat.

## 9. Module boundaries

Keep the refactor framework-light.

Suggested responsibilities:

```text
preferences.js
  conversation-mode constants/normalization/persistence

ui.js
  render by conversation mode
  no Gemini protocol knowledge

live.js
  session lifecycle
  mic lifecycle
  mode-specific turn boundary orchestration

audio.js
  playback only + safe serialization
```

Do not introduce Redux/state machines/frameworks for this two-mode flow.

## 10. Tests

Add/extend JavaScript regression tests for:

- push-to-talk is the default preference;
- conversation-mode normalization/persistence;
- manual playback replacement cannot be unblocked by stale cleanup;
- manual VAD setup uses `disabled: true`;
- hands-free setup uses `disabled: false` and configured silence duration;
- push-to-talk event sequence sends `activityStart -> audio -> activityEnd` conceptually through small testable helpers;
- hands-free renderer hides replay/TTS actions;
- push-to-talk renderer keeps replay/TTS actions.

Existing Python/security tests must continue passing unchanged.

## 11. Visual fixes

Center icon controls using layout rather than font baseline assumptions:

```text
display: inline-grid
place-items: center
padding: 0
line-height: 1
```

Apply to:

- main Talk/microphone button in public mode;
- settings gear button;
- small speaker/icon buttons where applicable.

## 12. Implementation sequence

1. Add conversation-mode preference and small pure helpers.
2. Make Live setup mode-aware.
3. Separate mic lifecycle from turn/input-forwarding lifecycle.
4. Implement push-to-talk pointer + keyboard handling.
5. Keep hands-free automatic-VAD flow working.
6. Make UI renderer mode-aware and remove audio actions in hands-free mode.
7. Harden manual playback replacement semantics.
8. Fix icon centering CSS.
9. Add regression tests.
10. Run CI and manual browser smoke tests before merging.

## 13. Acceptance criteria

### Push-to-Talk default

- Fresh public browser starts with Talk OFF.
- Holding the main control streams learner audio.
- Releasing ends the user activity and Gemini responds.
- No learner audio is forwarded while the button is not held.
- Replay/TTS cannot leak into Gemini because the mic is not forwarding outside the hold interval.

### Hands-Free

- Talk ON reconnects using automatic VAD.
- Start conversation opens continuous hands-free listening.
- AI playback does not feed back into the next turn.
- Replay/TTS controls are absent.
- Score, corrected sentence, and problem-word feedback remain visible.

### Maintainability

- One explicit conversation mode controls behavior.
- UI does not know Gemini message schema.
- Audio playback does not own conversation mode.
- Live orchestration does not infer mode from button text/classes.
- Tests cover the mode boundary and manual-playback race that Plan 04 missed.
