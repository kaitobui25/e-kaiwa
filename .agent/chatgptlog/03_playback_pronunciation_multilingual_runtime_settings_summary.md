# ChatGPT Log 03 — Playback, Pronunciation UX, Multilingual Rescue, Runtime Settings, and Model Failover

Date: 2026-09-09
Repository: `kaitobui25/e-kaiwa`
Status at end of this log: merged to `main`
Current main commit at feature completion: `95f4d37fcfe987fb4822abe1b9c30106f900c0b9`

## 1. Scope of this conversation segment

This log continues after:
- `01_e-kaiwa_mvp_conversation_summary.md`
- `02_realtime_multiturn_vad_debug_summary.md`

Main topics covered here:
1. AI playback-speed control.
2. Compact pronunciation/Coach UI.
3. Pronunciation problem highlighting directly inside the user's original sentence.
4. Small Coach hover UI cleanup.
5. Research into multilingual/misheard transcription behavior in Gemini Live.
6. English-first rescue UX with support language `vi` / `ja`.
7. Coach gating for non-English/mixed turns.
8. Structured language/debug logging.
9. Branch cleanup and consolidation into `main`.
10. Research into Gemini Live vs transcription-only models.
11. Runtime `config.yaml` as persistent settings source of truth.
12. Realtime-model selection and fallback.
13. Coach model selection and automatic key/model failover.

---

## 2. Product and engineering principles reinforced

User repeatedly emphasized:
- clean code;
- modular responsibilities;
- easy maintenance and upgrades;
- good runtime performance;
- avoid overengineering;
- prefer small targeted changes over rewrites;
- use branches/PR/CI and merge to `main` after verification.

The implementation decisions in this segment followed those constraints:
- no frontend framework;
- no bundler/npm migration;
- no database;
- no Redis/background worker;
- no extra STT/classifier unless clearly justified;
- server remains lightweight Python;
- browser continues direct Live WebSocket audio path.

---

## 3. AI playback speed

### User request

Add adjustable playback speed for AI audio.

### Final behavior

- range: `0.5x` to `1.5x`;
- step: `0.1x`;
- default: `0.8x`;
- applied client-side using Web Audio `AudioBufferSourceNode.playbackRate`;
- playback queue timing adjusted by `buffer.duration / rate`;
- no extra inference/API cost;
- pitch changes naturally with playback rate; no pitch-preserving DSP added.

### PR

PR #4: `Add configurable AI response playback speed`

Squash merge commit:
`211300389467278456948d97800676da82512bf9`

---

## 4. Compact pronunciation / Coach UI

### Initial compact design

The previous verbose pronunciation block was simplified.

Target UX evolved toward:

```text
YOU
Can you hear me?
        ----

AI
Yes, I can hear you clearly.

COACH   85
```

### Main ideas

- only one overall pronunciation score is shown inline;
- detailed pronunciation/fluency/intonation appears on hover/focus;
- pronunciation issue details appear on hover/focus over the problematic word;
- You / AI / Coach labels use visually distinct colors.

### PR #5

`Compact pronunciation coach UI`

Squash merge commit:
`4fd9d0bc91bfb1439ff18d7b2d39092f125fb768`

---

## 5. Pronunciation problems highlighted in the original user transcript

User corrected the UX direction:

Problem words should NOT appear as a separate list beside `Pronunciation`.
Instead, the matching word inside the original `You` sentence should be underlined.

### Final behavior

For `problems[].word`:
- match against `turn.userText`;
- underline matched word yellow/red;
- red takes precedence if duplicate problem entries exist;
- hover/focus word shows:
  - sound issue;
  - `heard_like`;
  - correction tip;
- only first 3 pronunciation problems are considered for compact UI;
- if pronunciation is disabled/unavailable, render the user sentence normally.

### PR #6

`Highlight pronunciation issues in user transcript`

Squash merge commit:
`e916d4b79fff8c6b2cf211e324954015d1024efb`

---

## 6. Multilingual / misheard transcript research

User observed behavior where Gemini sometimes displayed a transcript in another language even though the user intended English.

Examples discussed:

```json
"user_text": "duyaya hiye me"
```

while Coach returned:

```text
Do you hear me?
```

and another low-volume utterance became:

```json
"user_text": "Bangkok, da gibt's doch"
```

### Research conclusion

The app has several different interpretation paths that can disagree:

```text
Mic audio
  -> Gemini Live native audio understanding
  -> inputTranscription display text
  -> Coach correction from displayed transcript
  -> pronunciation model from saved WAV
```

Important conclusion:

```text
inputTranscription
!= guaranteed ground truth
!= necessarily what Gemini Live semantically understood
!= necessarily what pronunciation scoring model heard
```

`gemini-3.1-flash-live-preview` is a native Live audio model, so its conversation behavior can be better than the text transcript generated for display.

The Coach correction model can also infer intended English from phonetic-looking corrupted text because its prompt strongly frames the input as learner English.

Example:

```text
duyaya hiye me
~ do ya hear me
-> Do you hear me?
```

The German-looking transcript after speaking quietly was treated as likely acoustic ambiguity plus multilingual transcription decoding rather than proof that the conversation model actually believed the user was speaking German.

---

## 7. Important languageCode finding

Earlier design assumed Live `inputTranscription.languageCode` would reliably be available.

Real logs showed:

```json
"input_language_codes": [],
"output_language_codes": [],
"language_mode": "unknown"
```

This exposed an important limitation: in the current general Gemini Live path, language metadata was not reliably available in practice.

Because the language mode remained `unknown`, the compatibility rule kept Coach enabled.

This explains why some apparently non-English transcripts still triggered Coach.

---

## 8. English-first multilingual rescue UX

User approved the English-first rescue approach with one important rule:

The selected support language determines rescue language.

Existing setting reused:
- `vi` -> Vietnamese support/rescue;
- `ja` -> Japanese support/rescue.

Detected input language must NOT override this selection.

Example:

```text
input appears Japanese
support language = vi
-> AI rescue should be Vietnamese + English phrase
```

### Intended behavior

English turn:
- AI responds normally in English;
- Coach remains visible;
- pronunciation remains available.

Non-English / mixed turn:
- AI handles short rescue;
- provide useful English phrase and pull learner back to English;
- do not permanently switch conversation language;
- do not call Coach;
- do not show Coach heading/content.

Unknown language metadata:
- retain existing Coach behavior initially for compatibility;
- log enough metadata for later analysis.

---

## 9. Multilingual rescue plan

Created:

`.agent/chatgptplan/02_multilingual_rescue_ux_plan.txt`

The plan defined:
- English-first system instruction;
- support language behavior;
- language policy module;
- Coach gating;
- structured logging;
- no extra model/classifier;
- no raw audio debug logging initially.

Plan was first reviewed in draft PR #7, then later consolidated into `main` with the rest of repository cleanup.

---

## 10. Multilingual rescue implementation

A clean language policy module was introduced:

```text
src/web/language_policy.js
```

Responsibilities kept pure:
- normalize language code;
- record input/output language codes;
- finalize turn language mode;
- decide Coach eligibility;
- choose support language;
- build Live English-first system instruction;
- expose language policy version.

### Runtime behavior

For non-English/mixed turns:
- `/api/coach` is skipped;
- no PCM->base64 conversion for Coach;
- no Coach audio upload;
- no correction/pronunciation Gemini calls;
- Coach section is hidden entirely.

### Logging added

Per-turn structured fields include:
- input/output language codes;
- language mode;
- support language;
- language policy version;
- Coach eligible/called/skip reason;
- teacher;
- pronunciation enabled;
- silence timeout;
- AI playback speed.

### PR #8

`Implement multilingual rescue UX and Coach gating`

Squash merge commit:
`b39fb414d8bd7d6ca85d5ca3c4d24db106d0d1cf`

---

## 11. Coach hover UI refinement

User requested another small UI cleanup based on screenshot review.

### Problems

1. Pronunciation underline was visually broken inside one word.
2. `Pronunciation 45` was too verbose.
3. Coach details consumed vertical space.
4. `coach 8.67s` should be inside Coach details.

### Final UX

```text
Coach   [45]
```

- pronunciation underline is continuous;
- CSS disables browser skip-ink behavior for the underline;
- `45` is a light circular score badge;
- hover/focus score shows pronunciation breakdown;
- default view shows only `Coach`;
- hover/focus `Coach` shows Correction + explanation;
- Coach runtime such as `8.67s` is shown at the bottom of the Coach tooltip;
- keyboard focus/touch accessibility retained.

### PR #9

`Refine compact Coach hover UI`

Squash merge commit:
`87eed2376825cb834f0417d2332dfded22eb0e88`

---

## 12. Branch cleanup

User requested all old branch states be consolidated into `main` and eventually only `main` retained.

Because earlier feature branches had mostly been squash-merged, blindly merging diverged branches again could reintroduce old changes.

Strategy used:
- identify whether any branch contained content not already represented on `main`;
- merge only missing plan/content;
- move old branch refs to current main commit when connector deletion was unavailable;
- user was given the exact `git push origin --delete ...` commands for final remote-name deletion when required.

---

## 13. Gemini model-role research

User asked about:

```text
gemini-3.1-flash-live-preview
gemini-3.5-transcribe-live
gemini-3.5-flash-lite
```

### Role distinction

`gemini-3.1-flash-live-preview`
- production conversation model;
- realtime Live audio-to-audio;
- receives mic audio;
- generates spoken AI response;
- also provides transcript text for UI.

`gemini-3.5-transcribe-live`
- dedicated realtime transcription/STT model;
- not currently used in production code;
- text transcription role, not audio conversation brain.

`gemini-3.5-flash-lite`
- GenerateContent-style model;
- suitable for Coach text/JSON work and audio analysis;
- not a Live audio-to-audio conversation model.

---

## 14. Realtime conversation model choices

User accepted the following architecture.

Realtime conversation selector should expose only models with compatible Live audio-to-audio capability:

```text
gemini-3.1-flash-live-preview                     default/recommended
gemini-2.5-flash-native-audio-preview-12-2025    fallback/test
```

Do NOT mix transcription-only or ordinary GenerateContent models into this selector.

---

## 15. Coach model architecture

Coach stays a separate sidecar pipeline.

Recommended model order accepted by user:

```text
gemini-3.5-flash-lite
  -> gemini-3.1-flash-lite
  -> gemini-3.6-flash
```

UI choice:

```text
Auto (recommended)
Gemini 3.5 Flash-Lite
Gemini 3.1 Flash-Lite
Gemini 3.6 Flash
```

### Key/model failover rule

Important policy:

```text
rotate API keys first
-> only after all active keys fail for a retryable reason, rotate model
```

Auto example:

```text
3.5-flash-lite + key1
3.5-flash-lite + key2
3.5-flash-lite + key3
...
-> 3.1-flash-lite + key1
-> 3.1-flash-lite + key2
...
-> 3.6-flash + key1
...
```

API key slot #4 remains skipped.

Manual Coach mode:
- only selected model is used;
- keys may rotate;
- model must not silently change.

Retryable failures:
- HTTP 429;
- RESOURCE_EXHAUSTED/quota;
- HTTP 5xx;
- timeout;
- network/transient service errors.

Non-retryable examples:
- malformed request;
- unsupported input;
- deterministic local validation/config errors.

Structured JSON parse failure:
- one controlled retry maximum;
- no infinite loops.

---

## 16. Runtime settings plan

Created:

`.agent/chatgptplan/03_runtime_settings_and_model_failover_plan.md`

Plan goals:
- root `config.yaml` persists current settings;
- UI loads settings from server;
- user setting changes update YAML;
- realtime model selection/fallback;
- Coach Auto/manual model selection;
- rotate keys then models;
- model/key attempt logging;
- no duplicated permanent state in localStorage.

---

## 17. Runtime `config.yaml`

Implemented root:

```yaml
version: 1

settings:
  teacher: Normal
  support_language: vi
  pronunciation_enabled: true
  silence_duration_ms: 1000
  ai_playback_rate: 0.8

models:
  realtime_conversation:
    selected: gemini-3.1-flash-live-preview
    fallback: gemini-2.5-flash-native-audio-preview-12-2025

  coach:
    mode: auto
    selected: gemini-3.5-flash-lite
    fallbacks:
      - gemini-3.1-flash-lite
      - gemini-3.6-flash
```

Secrets remain outside YAML.
`api.txt` remains the API-key source.

---

## 18. Settings persistence architecture

New module:

```text
src/e_kaiwa/settings.py
```

Responsibilities:
- default config generation;
- YAML loading;
- field validation/normalization;
- in-memory snapshot;
- locking;
- atomic temp-file + replace writes;
- public API payload;
- partial settings update;
- realtime model/fallback access;
- Coach policy access.

New dependency:

```text
PyYAML>=6.0,<7
```

### Source of truth

Final architecture:

```text
server startup
  -> load config.yaml
  -> validate/normalize
  -> hold normalized state in SettingsStore

frontend
  -> GET /api/settings
  -> display settings

setting change
  -> POST /api/settings
  -> server validates
  -> atomic YAML write
  -> return normalized state
```

Old localStorage persistence for runtime settings was removed.

---

## 19. Model policy module

New module:

```text
src/e_kaiwa/model_policy.py
```

Responsibilities:
- allowed realtime models;
- allowed Coach models;
- default models/fallbacks;
- alternate realtime fallback;
- Coach model order;
- per-turn key rotation;
- Coach attempt order;
- retryable error classification.

This keeps retry/failover loops out of `server.py`.

---

## 20. Realtime model runtime behavior

`/api/session` now reads the selected realtime model from `SettingsStore`.

Server response includes model information such as:
- effective model;
- requested model;
- configured fallback;
- whether fallback was used.

Frontend no longer owns a hard-coded Live model constant.

Browser uses:

```text
model returned by /api/session
```

for Gemini setup.

### Reconnect behavior

Session-level setting changes:
- support language;
- silence timeout;
- realtime model.

If idle:
- reconnect automatically.

If a conversation is currently recording:
- do not cut it;
- apply after Stop and reconnect.

### Realtime fallback safety

A primary setup/session failure can trigger one fallback attempt.

Important bug prevention added during review:
- do not compare fallback effective model directly with the dropdown and cause repeated reconnect loops;
- retain requested vs effective model separately;
- only reconnect when the user's configured/session-level setting actually changes.

---

## 21. Coach failover implementation

`CoachService` now uses the runtime settings/model policy instead of fixed constants.

Correction and pronunciation remain parallel:

```text
Coach turn
  |-- correction job
  `-- pronunciation job
```

Both use the same failover abstraction, but can resolve to different effective models if one path fails independently.

### Auto mode

Attempt order:

```text
selected model x all rotated keys
-> fallback model x all rotated keys
-> next fallback model x all rotated keys
```

### Manual mode

Attempt order:

```text
selected model x all rotated keys
-> fail
```

No hidden model switching.

---

## 22. Coach settings authority

During implementation review, one important improvement was made:

Coach should not trust frontend payload values as authoritative for persisted settings.

Teacher / support language / pronunciation settings are resolved from `SettingsStore` on the backend so `config.yaml` is truly the source of truth rather than merely a backup copy.

---

## 23. Structured model/failover logs

Coach logs now include information such as:

```json
{
  "coach_model_mode": "auto",
  "coach_requested_model": "gemini-3.5-flash-lite",
  "correction_effective_model": "gemini-3.1-flash-lite",
  "correction_key_slot": 3,
  "correction_llm": {
    "attempts": [
      {"model":"gemini-3.5-flash-lite","key_slot":1,"status":429},
      {"model":"gemini-3.5-flash-lite","key_slot":2,"status":429},
      {"model":"gemini-3.1-flash-lite","key_slot":3,"status":200}
    ]
  }
}
```

Pronunciation gets analogous metadata.

Realtime logs include:
- requested model;
- effective model;
- fallback model;
- whether fallback was used;
- fallback reason.

Raw API keys are never logged.

---

## 24. Settings UI after runtime persistence work

Existing Settings panel now includes:

```text
Teacher
Support / correction language
Realtime model
Coach model
AI response speed
Silence timeout
Pronunciation coaching
```

Realtime labels are human-readable but canonical model IDs are persisted.

Coach selector:

```text
Auto (recommended)
Gemini 3.5 Flash-Lite
Gemini 3.1 Flash-Lite
Gemini 3.6 Flash
```

Realtime selector:

```text
Gemini 3.1 Flash Live (recommended)
Gemini 2.5 Native Audio
```

---

## 25. Runtime settings/model failover tests

Added/updated regression coverage for:
- missing YAML -> defaults;
- valid YAML load;
- partial update;
- invalid setting rejection/normalization;
- atomic write;
- bool/number validation;
- key rotation;
- key #4 exclusion remains intact;
- Auto model rotation only after keys;
- manual mode never changes model;
- retryable HTTP/network failures;
- finite attempt count;
- settings UI wiring;
- removal of localStorage persistence;
- realtime model comes from server;
- browser JS syntax;
- existing language-policy JS tests;
- existing pronunciation/Coach UI regressions.

CI workflow was updated to install runtime dependencies before Python tests so PyYAML is available.

---

## 26. PR #10 — runtime settings and model failover

Branch:

`feature/runtime-settings-model-failover`

PR:

`#10 Add persisted runtime settings and model failover`

Final scope:
- 12 changed files;
- root config YAML;
- SettingsStore;
- model policy;
- server settings API;
- realtime model/fallback wiring;
- Coach model/key failover;
- UI dropdowns;
- structured logs;
- tests;
- PyYAML dependency.

CI run:
- Python core regression tests: PASS;
- JavaScript language policy tests: PASS;
- Python syntax: PASS;
- browser JavaScript syntax: PASS.

Squash merge commit:

`95f4d37fcfe987fb4822abe1b9c30106f900c0b9`

After merge, the feature branch ref was moved to the new main head so it contained no independent code state.

---

## 27. Current production architecture at end of this log

```text
Browser mic
  |
  +--> Gemini Live WebSocket
  |      selected runtime Live model
  |      default: gemini-3.1-flash-live-preview
  |      fallback: gemini-2.5-flash-native-audio-preview-12-2025
  |      |
  |      +--> AI spoken response
  |      +--> input/output transcript for UI
  |
  `--> after eligible English turn
         browser -> /api/coach
                    |
                    +--> correction
                    |      Coach model policy
                    |
                    `--> pronunciation
                           Coach model policy

config.yaml
  |
  +--> Teacher
  +--> support language
  +--> pronunciation enabled
  +--> silence timeout
  +--> AI playback rate
  +--> realtime selected/fallback model
  `--> Coach mode/model/fallbacks
```

Non-English/mixed turns remain designed to skip Coach when language policy can confidently classify them.
Unknown language metadata remains backward-compatible and can still allow Coach.

---

## 28. Current important files

```text
config.yaml

src/e_kaiwa/
  coach.py
  config.py
  gemini.py
  model_policy.py
  server.py
  sessions.py
  settings.py

src/web/
  live.html
  live.css
  live.js
  language_policy.js

src/tests/
  python/
  js/
```

Plans:

```text
.agent/chatgptplan/01_realtime_production_refactor_plan.md
.agent/chatgptplan/02_multilingual_rescue_ux_plan.txt
.agent/chatgptplan/03_runtime_settings_and_model_failover_plan.md
```

---

## 29. Normal local commands after PR #10

Because PyYAML was added, run setup after pulling the new main:

```bat
git checkout main
git pull
src\scripts\setup.bat
src\tests\run_python.bat
src\scripts\run.bat
```

System smoke when needed:

```bat
src\tests\run_system.bat
```

---

## 30. Known follow-up observations / caveats

1. General Gemini Live transcript can disagree with native audio understanding.
2. Display transcript should not be treated as absolute ground truth.
3. Current Live language metadata may be absent, so `language_mode=unknown` remains common.
4. Therefore non-English Coach gating cannot rely only on languageCode unless future API/model behavior improves.
5. `gemini-3.5-transcribe-live` is not part of production pipeline at this point.
6. A dedicated transcription side-channel remains a future option, but intentionally was not added because it increases complexity/bandwidth.
7. Realtime fallback is session/setup-level only; model cannot safely switch mid-conversation without reconnect.
8. Coach Auto may resolve correction and pronunciation to different effective models after failures; logs capture this.
9. `api.txt` remains separate from runtime settings and must never be copied into `config.yaml`.

---

## 31. Final state

At the end of this conversation segment:
- multilingual rescue and Coach gating feature was merged;
- Coach/pronunciation UI refinements were merged;
- runtime settings persistence was implemented;
- realtime model selection/fallback was implemented;
- Coach Auto/manual model selection was implemented;
- API-key-first then model failover was implemented;
- structured diagnostics were expanded;
- CI was green;
- PR #10 was squash-merged;
- production main was at:

```text
95f4d37fcfe987fb4822abe1b9c30106f900c0b9
```
