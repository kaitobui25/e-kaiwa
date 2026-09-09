# Mobile-First Public UI + Audio Playback/TTS + Public Session Hardening Plan

Status: draft for review only. **No production code changes in this plan.**

## 1. Goal

Prepare E-KAIWA for a first public mobile-web release while preserving the current lightweight developer experience.

Main scope:
- Build the selected **UI #2 direction** as the public/mobile-first experience.
- Preserve a **minimal developer UI close to the current interface** when the app runs in `dev` mode.
- Extract audio playback/replay/TTS behavior behind small modules so microphone gating and echo protection have one owner.
- Harden `/api/session`, `/api/coach`, metrics, runtime settings, and anonymous public sessions before exposing the site to everyone.
- Keep the existing direct Browser <-> Gemini Live audio path.
- Keep the implementation framework-light, modular, testable, and suitable for a small Tokyo VPS.

Non-goals for this phase:
- No native iOS/Android app.
- No React/Vue/Svelte migration.
- No database unless a later feature truly requires one.
- No Redis/background workers/message queue.
- No user account system yet.
- No long-term cloud storage of user recordings.
- No heavy avatar/3D tutor UI.
- No new STT pipeline.

## 2. Product modes

Treat `dev` and `public` as **startup/runtime modes**, not user-selectable settings.

Suggested modes:

```text
DEV MODE
- minimal UI close to current live.html
- full diagnostics/status
- model selectors
- teacher/support language/runtime settings controls
- setupReady / effective model / debug information
- local development tools remain easy to inspect

PUBLIC MODE
- mobile-first UI #2
- learner-facing controls only
- no model IDs/API/debug internals exposed
- no global config mutation from arbitrary browsers
- rate limits + anonymous session ownership
- privacy-oriented audio lifecycle
```

Recommended source of mode:
1. explicit CLI argument or environment variable at server startup;
2. default to `dev` for local scripts;
3. deployment service explicitly starts with `public`.

Do **not** persist `app_mode` inside normal `/api/settings`. A public browser must never be able to switch the server into development mode.

## 3. UI architecture

Do not fork the realtime/business logic into two applications.

Use one shared application core and two presentation shells.

Suggested browser layout:

```text
src/web/
  app_core.js                 # shared realtime/session/turn orchestration
  audio/
    playback_coordinator.js   # exclusive playback + mic gating
    user_audio_replay.js      # replay captured learner audio
    speech_service.js         # provider-neutral TTS interface
    browser_speech.js         # Web Speech implementation for V1

  ui/
    dev_ui.js                 # minimal current-style renderer/debug controls
    public_ui.js              # UI #2 mobile-first renderer
    turn_view_model.js        # normalized UI-facing turn data

  live.js                     # thin bootstrap/composition layer
  live.css                    # shared/base tokens if still useful
  dev.css                     # intentionally plain/minimal
  public.css                  # mobile-first product UI
```

Exact filenames may change during implementation, but responsibilities should remain separated.

Important rule:
- UI modules render and dispatch intents.
- Realtime/session modules own state and network lifecycle.
- Audio modules own playback and microphone forwarding coordination.
- UI code must not directly manipulate Gemini protocol details.

Avoid building a generic component framework. Plain ES modules are enough for this phase.

## 4. Public UI #2: mobile-first scope

Primary target:
- iPhone Safari
- Android Chrome
- portrait phone layout first

Desktop/tablet should remain usable through responsive CSS, but should not drive the design.

### 4.1 Main screen

Keep the public screen focused on conversation:

```text
Header
  E-KAIWA
  connection/listening state
  small settings button

Conversation
  AI bubble
  learner bubble + score
  replay learner voice button
  AI reply

Coach summary
  pronunciation score
  highlighted problem words
  correction
  concise Japanese support text
  speaker buttons for correct word / corrected sentence

Bottom action
  large mic / conversation status
```

No bottom navigation for Home/History/Growth/Profile in V1.
Those routes do not yet provide enough value and would reduce conversation space.

### 4.2 Visual rules

Use UI #2 direction but keep it restrained:
- predominantly white/light neutral background;
- one primary blue accent;
- green/yellow/red only when they carry semantic meaning;
- rounded cards, but avoid excessive gradients/glass effects;
- typography and spacing carry hierarchy, not decoration;
- animation only for speaking/listening state and small transitions;
- no expensive continuous visualizations.

### 4.3 Coach interaction

Default Coach display stays compact.

Learner bubble:

```text
YOU                                      82
I like listening to J-pop.
       ━━━━━━━━━
▶ My voice
```

Coach expanded panel:

```text
Pronunciation Coach
82 Good

Correction
I like listening to J-pop.              🔊

Problem
listening                                🔊
short pronunciation guidance in Japanese
```

Do not duplicate the same information in several cards.

## 5. Developer UI

`dev` mode intentionally remains visually simple and close to the current app.

Goals:
- quick load;
- easy inspection;
- low CSS complexity;
- expose runtime/debug settings that are hidden in public mode;
- maintain existing debugging workflows and logs.

Keep or expose:
- teacher mode;
- support language;
- realtime model;
- Coach model;
- playback rate;
- silence duration;
- pronunciation toggle;
- echo guard;
- connection/setupReady state;
- effective/fallback model information when useful;
- raw-ish conversation/Coach presentation sufficient for debugging.

Do not spend design effort making dev mode polished.
Its job is engineering visibility.

## 6. Settings ownership: critical public-mode change

Current runtime settings are server-global. That is acceptable for a developer UI but unsafe for a public website.

Split configuration conceptually into two groups.

### 6.1 Server-owned configuration

Examples:
- realtime selected/fallback models;
- Coach model policy;
- API credentials;
- rate limits;
- public session limits;
- ephemeral token constraints;
- maximum request/audio sizes;
- default teacher policy if product-wide;
- echo guard default/allowed range;
- deployment mode.

Public clients can read only the safe subset needed to operate the UI.
They cannot mutate these values.

### 6.2 Anonymous learner preferences

Examples:
- support UI language;
- AI playback speed;
- pronunciation display preference;
- possibly teacher strictness if product decides this should be per-user.

Before accounts exist, store lightweight preferences locally in the browser where appropriate.
Do not write them into a shared global YAML merely because one anonymous user changed a selector.

### 6.3 Endpoint behavior

DEV:
- existing settings read/write behavior may remain available for engineering use.

PUBLIC:
- `/api/settings` GET returns sanitized public defaults/capabilities only;
- public POST must not mutate server-global runtime configuration;
- if a per-session preference must affect Coach behavior, send it through an allowlisted per-session/preference path rather than changing global config.

Avoid introducing a database just to solve anonymous preferences.

## 7. Audio module plan

The most important refactor is to give all speaker playback one coordinator.

### 7.1 PlaybackCoordinator

One owner for:
- Live AI audio playback;
- learner self-replay;
- Coach correction TTS;
- Coach problem-word TTS.

Responsibilities:

```text
request playback
  -> pause microphone forwarding
  -> stop/resolve conflicting playback according to policy
  -> play requested source
  -> wait configured echo guard
  -> resume microphone forwarding only when conversation state allows it
```

It must prevent each UI button from implementing its own mic mute/unmute logic.

Desired API shape conceptually:

```text
play(source)
stop()
isPlaying
onStateChange(...)
```

Do not over-generalize beyond sources the app actually has.

### 7.2 Live AI playback

Move existing Web Audio source tracking/clear/interruption behavior behind PlaybackCoordinator where practical.

Preserve:
- current playback-rate support;
- `serverContent.interrupted` handling;
- echo guard;
- direct Gemini Live WebSocket audio path.

### 7.3 Learner voice replay

During a turn, keep the captured user PCM available in browser memory long enough for replay.

Flow:

```text
mic PCM
  -> Gemini Live
  -> Coach request
  -> in-memory replay source
```

Requirements:
- no additional API call to replay the learner voice;
- no server download round trip;
- release old audio buffers on session cleanup / retention limit;
- use a small bounded history so memory cannot grow for an unlimited conversation.

Suggested initial retention:
- keep audio only for recent rendered turns in current session;
- clear everything on page unload/session reset;
- tune the exact turn count after measuring memory usage.

### 7.4 Correct-word / corrected-sentence TTS

Introduce a provider-neutral `SpeechService`.

V1 provider:
- browser `speechSynthesis` / Web Speech API;
- English voice preference where available;
- zero server/API cost;
- no generated audio storage.

Future provider can be Gemini TTS without changing Coach UI:

```text
SpeechService
  -> BrowserSpeechProvider   # V1
  -> GeminiTtsProvider       # optional future
```

Do not implement the future provider in this phase unless browser TTS proves unacceptable in testing.

### 7.5 Playback priority

Simple policy:
- only one playback source at a time;
- tapping another playback stops/replaces the current one;
- starting/stopping a Live session clears manual replay/TTS;
- manual Coach/user replay must not accidentally create a new Gemini user turn.

## 8. Recording privacy and storage

Current Coach flow writes `turn_NNN_user.wav` into the session directory for pronunciation analysis.
That is useful in dev but should not become indefinite public storage by accident.

DEV:
- current WAV/log retention can remain for debugging.

PUBLIC target:
- user audio should be temporary by default;
- save only as long as required for Coach processing;
- delete temporary WAV after the Coach request finishes unless explicit diagnostic retention is enabled server-side;
- never expose arbitrary filesystem audio paths to browsers;
- learner self-replay comes from browser memory, not persisted server recordings.

Conversation text logs also need a documented public retention policy before launch.
Do not silently retain more personal data than debugging/product needs justify.

## 9. Public anonymous session ownership

Current timestamp-like session identifiers are designed for local logging, not as security credentials.
Before public launch, separate internal storage directory naming from public session identity.

Recommended lightweight design:

```text
/api/session
  -> internal session directory
  -> cryptographically random public session token/id
  -> browser keeps token only for this session

/api/coach
/api/metric
  -> require valid owned session token
```

Properties:
- high entropy / non-guessable;
- expires with the server session;
- no database required for a single-process V1 server;
- SessionStore can keep the mapping in memory.

Do not rely on sequential/timestamp session names as authorization.

## 10. `/api/session` hardening

Public `/api/session` creates Gemini ephemeral access and therefore deserves the strongest controls.

Add in implementation phase:
- same-origin validation for browser requests;
- strict allowed Host/Origin configuration;
- in-memory rate limiting by trusted client IP + anonymous browser/session identity where possible;
- maximum active sessions per client/IP;
- short cooldown for repeated token creation;
- ephemeral token constrained to the intended Live model/config where supported;
- never return master Gemini credentials;
- structured rejection logs without secrets.

Keep rate limiting in-process for V1.
A single Tokyo VPS does not need Redis.

## 11. `/api/coach` hardening

Requirements:
- require valid anonymous session ownership token;
- keep strict transcript/body/audio size limits;
- bound Coach requests per session and per minute;
- reject requests for already expired/unknown sessions;
- server remains authoritative for allowed Coach models and sensitive settings;
- do not accept arbitrary model IDs from public clients;
- do not trust frontend fields for secrets/system policy.

The browser may send allowed learner preferences, but backend validates all values.

## 12. Metrics endpoint hardening

Metrics should never be a free arbitrary-log ingestion endpoint.

Public mode:
- valid session ownership required;
- small payload limit;
- allowlisted fields only;
- rate limited;
- text length bounded;
- never record API keys/tokens.

If metrics become noisy or expensive, they can be sampled later without affecting realtime conversation.

## 13. Abuse protection without overengineering

Phase 1 protections:
- in-memory fixed-window or token-bucket limiter;
- per-IP `/api/session` limit;
- per-session Coach limit;
- active-session cap;
- global emergency cap;
- request size limits;
- origin checks.

Do not add CAPTCHA initially unless actual abuse appears.

Future only if needed:
- Cloudflare Turnstile;
- external rate-limit store;
- authenticated accounts;
- paid usage tiers.

## 14. Reverse proxy / deployment shape

Target V1 deployment:

```text
Mobile Browser
      |
    HTTPS
      |
   Caddy
      |
E-KAIWA Python server
  |             |
  |             +--> Gemini GenerateContent / Coach
  |
  +--> ephemeral token creation

Mobile Browser ------------------> Gemini Live WebSocket
                 direct audio path
```

Recommended server region: Tokyo.

Caddy responsibilities:
- HTTPS certificate;
- HTTP -> HTTPS redirect;
- reverse proxy to localhost Python service;
- safe forwarded client IP handling;
- basic security headers where appropriate.

Python service should bind localhost behind Caddy in public deployment unless there is a clear reason not to.

## 15. Performance rules

Frontend:
- no frontend framework/bundler migration in this phase;
- lazy-create AudioContext when user interaction permits;
- bound PCM/audio history in memory;
- avoid repeated DOM rebuilds for the full conversation when a small turn update is enough, if profiling shows it matters;
- avoid decorative continuous animation;
- use system fonts;
- keep CSS/JS payload small.

Backend:
- preserve direct Browser <-> Gemini Live audio so VPS does not proxy realtime PCM;
- avoid audio transcoding beyond what Coach/replay actually requires;
- bound thread/concurrent Coach work;
- temporary file lifecycle must be deterministic;
- no database/network cache in V1.

Optimization priority:
1. correctness;
2. low latency conversation;
3. bounded resources;
4. only then micro-optimization.

## 16. Suggested implementation phases

### Phase A — Mode boundary + shared state contracts

Goal:
- introduce `dev/public` server mode;
- define sanitized public configuration contract;
- ensure public mode cannot mutate global runtime settings;
- keep existing dev UI working.

Acceptance:
- dev mode looks/behaves approximately like current UI;
- public mode has no model/debug controls;
- one public user cannot change global settings for another user.

### Phase B — Audio PlaybackCoordinator + learner replay + browser TTS

Goal:
- one audio owner;
- user can replay own sentence;
- Coach correction and problem word have speaker playback;
- all manual playback respects mic gating and echo guard.

Acceptance:
- replay does not create false Gemini turns;
- only one audio source plays at a time;
- interruption/stop/reconnect clears playback correctly;
- no API call required for learner replay or V1 Coach TTS.

### Phase C — Public mobile UI #2

Goal:
- build restrained mobile-first production UI on top of shared state/audio modules.

Acceptance:
- usable at common 360-430 px phone widths;
- conversation remains primary content;
- Coach panel compact by default;
- touch targets comfortable;
- iOS Safari and Android Chrome smoke tested;
- dev UI remains separate and unaffected visually.

### Phase D — Anonymous session + endpoint hardening

Goal:
- secure public API usage before deployment.

Acceptance:
- random session ownership token/id;
- `/api/session`, `/api/coach`, metrics protected by rate/ownership checks;
- public clients cannot select arbitrary backend models;
- master Gemini credentials never reach browser;
- ephemeral Live tokens are constrained where supported;
- abuse produces bounded resource usage.

### Phase E — Public privacy lifecycle

Goal:
- public recordings/logs have deliberate retention behavior.

Acceptance:
- user WAV temporary by default in public mode;
- self-replay stays client-side;
- cleanup succeeds after Coach/session completion;
- dev diagnostic retention remains available only in dev/server-controlled configuration.

### Phase F — Deploy/smoke test

Goal:
- Tokyo VPS + HTTPS + real phones.

Test matrix:
- iPhone Safari;
- Android Chrome;
- headphones;
- phone speaker at low/high volume;
- slow network;
- reconnect;
- repeated Coach playback;
- AI speech -> user turn transition;
- anonymous usage limits.

## 17. Test strategy

Keep tests close to module boundaries.

Browser/JS unit tests:
- PlaybackCoordinator state transitions;
- playback replacement/stop;
- mic gating + echo guard;
- SpeechService provider behavior with mocks;
- user audio replay bounded retention;
- public/dev UI state mapping;
- public mode does not expose debug/model controls.

Python tests:
- app mode validation;
- public settings sanitization/read-only behavior;
- anonymous session token generation/validation/expiry;
- rate limiter boundaries;
- Coach/metric session ownership;
- request limits;
- temporary WAV cleanup;
- ephemeral token request constraints.

System smoke tests:
- current realtime conversation still works;
- Coach English gating still works;
- user replay and TTS do not feed back into Gemini;
- dev mode regression;
- public mode endpoint rejection cases.

## 18. Clean-code rules for implementation

- One module = one clear responsibility.
- Prefer pure helper functions for policy/validation.
- Avoid global mutable state outside explicit stores/controllers.
- Do not duplicate playback/mic gating logic in UI handlers.
- Do not duplicate dev/public business logic; vary presentation and permissions.
- Backend remains authoritative for security-sensitive values.
- No abstraction layer without at least one concrete responsibility today or a clearly planned provider boundary such as SpeechService.
- Delete obsolete code after migration instead of leaving two hidden paths active.
- Add structured logs at lifecycle boundaries, not every audio chunk.
- Never log secrets, ephemeral tokens, or raw authorization headers.

## 19. Decisions intentionally deferred

Decide after public-user feedback:
- Sign in with Google/accounts;
- persistent conversation history;
- streak/growth UI;
- database;
- cloud object storage;
- Gemini TTS instead of browser TTS;
- Turnstile/CAPTCHA;
- multi-instance deployment/Redis;
- PWA install/offline shell;
- native mobile apps.

## 20. Recommended V1 end state

```text
PUBLIC USER
  -> mobile-first UI #2
  -> anonymous high-entropy session
  -> own local preferences
  -> direct Gemini Live WebSocket via constrained ephemeral token
  -> Coach through hardened backend
  -> My Voice replay from browser memory
  -> corrected sentence / problem word through BrowserSpeechProvider
  -> PlaybackCoordinator prevents speaker-to-mic self-capture

DEV USER
  -> minimal current-style UI
  -> full runtime/debug controls
  -> diagnostic logs/audio retention as explicitly configured

SERVER
  -> one lightweight Python process behind Caddy
  -> Tokyo VPS
  -> no DB / Redis / frontend framework
  -> bounded rate limits, sessions, audio retention and Coach concurrency
```

This phase should make E-KAIWA safe and pleasant enough for an anonymous mobile-web beta without turning the current small codebase into a platform prematurely.
