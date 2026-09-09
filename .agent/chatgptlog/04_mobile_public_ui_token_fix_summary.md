# Chat Summary — Mobile Public UI + Ephemeral Token Fix

Date: 2026-09-09

## 1. UI #2 decisions

User approved the general UI direction and requested these changes:

- AI icon/avatar and learner icon/avatar must stay on opposite sides.
  - AI: left.
  - Learner: right.
- One language selector should control both:
  - interface language;
  - Coach feedback/explanation language.
- Settings must include Light/Dark mode.
- Architecture should stay ready for future Japanese/Chinese learning without implementing those modes now.

Plan updated:

`.agent/chatgptplan/04_mobile_public_ui_audio_security_plan.md`

Important language boundary:

```text
app_language
  = UI language
  = Coach feedback/explanation language

target_language
  = language being learned

V1 target_language = en
Future: ja / zh may be added later
```

## 2. Public/mobile implementation

User requested implementation with these constraints:

- clean code;
- modular;
- easy maintenance/upgrades;
- good performance;
- avoid overengineering.

The public/mobile refactor was completed and merged to `main`.

Main implementation commit before token fix:

`ecb61522d511f38963dfb8745d0fa9b446f326ea`

Main pieces added/refactored:

- public/dev runtime modes;
- mobile-first public UI #2;
- AI left / learner right layout;
- local App Language + theme preferences;
- Light/Dark mode;
- `preferences.js`;
- `audio.js` with PlaybackCoordinator + browser TTS/replay;
- `ui.js` renderer split;
- public settings read-only;
- random public session IDs;
- origin/rate-limit hardening;
- temporary public Coach WAV cleanup;
- expanded Python/JS regression tests.

CI passed for the implementation.

## 3. How to run

Dev/local runner:

```bat
src\scripts\run.bat
```

Public mode directly:

```bat
python src\app.py --mode public
```

Local URL:

```text
http://127.0.0.1:7860
```

Phone testing needs HTTPS, for example Cloudflare tunnel:

```bat
cloudflared tunnel --url http://127.0.0.1:7860
```

## 4. Public mode token failure discovered

Running public mode produced:

```text
[TOKEN ERROR] token HTTP 400: INVALID_ARGUMENT:
Invalid JSON payload received.
Unknown name "liveConnectConstraints" at 'auth_token': Cannot find field.
```

Root cause:

- the public hardening change added `liveConnectConstraints` to the Gemini `/v1beta/auth_tokens` request;
- the current auth-token endpoint used by this app rejects that field;
- this broke `/api/session` before Gemini Live WebSocket setup could begin.

This was not an API key failure and not a realtime model failure.

## 5. Why `liveConnectConstraints` was added

It was added as an extra security layer so an ephemeral token would ideally only be usable with the intended Live model/config.

The goal was to reduce abuse if a user inspected the browser and copied the ephemeral token.

However, the browser already receives only a temporary token, not the master API key.

The V1 protections already in place are:

- `uses = 1`;
- short token/new-session lifetime;
- `/api/session` rate limiting;
- origin checks;
- server-side master API key remains hidden.

User decided this is sufficient for the current MVP/public beta.

Decision:

```text
Do not use liveConnectConstraints in V1.
Revisit model/config token constraints later when Gemini's supported schema is stable and verified for this flow.
```

This decision was added to plan 04.

## 6. Token fix

Fix scope was intentionally small:

- remove `liveConnectConstraints` from ephemeral token creation;
- restore token body to the working single-use/expiry fields;
- keep all other public hardening intact;
- update tests so unsupported constraints do not regress back in;
- update plan 04 with the explicit V1 decision.

Files changed in the fix:

- `.agent/chatgptplan/04_mobile_public_ui_audio_security_plan.md`
- `src/e_kaiwa/gemini.py`
- `src/e_kaiwa/server.py`
- `src/tests/python/test_live_core.py`

PR:

`#13 Fix Gemini ephemeral token creation`

CI passed and PR was squash-merged.

Current `main` after fix:

`6f9de58530ff1f91818a7c31ba8723e05e1ae467`

Commit message:

`Fix Gemini ephemeral token creation`

## 7. Current V1 token policy

Current intended behavior:

```text
Server master Gemini API key
        |
        v
/api/session
        |
        +--> create ephemeral token
               uses = 1
               short expireTime
               short newSessionExpireTime
        |
        v
Browser receives only ephemeral token
        |
        v
Gemini Live WebSocket
```

Security remains layered by:

- master key never sent to browser;
- single-use ephemeral token;
- short new-session window;
- public `/api/session` rate limit;
- same-origin/allowed-origin protection;
- random server session identity;
- public settings cannot mutate server-global configuration.

## 8. State at end of chat

- UI #2/public mobile work is on `main`.
- AI/user side layout decision is implemented.
- App Language controls UI + Coach language.
- Light/Dark mode exists.
- Future target-language boundary is documented; Japanese/Chinese learning is not implemented yet.
- `liveConnectConstraints` is intentionally deferred.
- Gemini ephemeral token creation has been restored to the simpler compatible V1 flow.
- Latest relevant `main` commit: `6f9de58530ff1f91818a7c31ba8723e05e1ae467`.
