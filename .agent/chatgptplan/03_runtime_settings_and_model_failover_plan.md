# Runtime Settings + Model Failover Plan

Status: draft for review only. No production code changes in this plan.

## 1. Goal

Add a single root-level `config.yaml` as the persistent source of truth for current runtime/user settings, while keeping the implementation small, modular, and easy to debug.

Main requirements:
- Existing UI settings are loaded from `config.yaml`.
- When the user changes a setting, the server persists the new value back to `config.yaml`.
- Realtime conversation model can be selected from supported Live audio-to-audio models only.
- Coach model supports `Auto` plus manual model selection.
- Coach failover policy: rotate API keys first, then rotate models.
- Existing rule to skip API key slot #4 stays unchanged.
- Logging should record selected model, effective model, key slot, fallback attempts, and final error reason.
- Avoid introducing extra databases, background workers, or duplicated config state.

## 2. Capability boundaries

Do not treat all Gemini models as interchangeable.

### Realtime conversation

Allowed models:
- `gemini-3.1-flash-live-preview` — default / recommended.
- `gemini-2.5-flash-native-audio-preview-12-2025` — fallback/test option.

These are the only models exposed in the realtime model selector because this role requires Live audio-to-audio behavior.

Do not place these in the same selector:
- `gemini-3.5-transcribe-live` — transcription-only role.
- `gemini-3.5-flash-lite` — GenerateContent text output, not Live audio-to-audio.

### Coach

Coach remains a separate sidecar pipeline.

Default automatic model order:
1. `gemini-3.5-flash-lite`
2. `gemini-3.1-flash-lite`
3. `gemini-3.6-flash`

UI choices:
- `Auto (recommended)`
- `gemini-3.5-flash-lite`
- `gemini-3.1-flash-lite`
- `gemini-3.6-flash`

Manual mode uses only the selected model, but still rotates API keys for retryable failures.

## 3. Proposed root `config.yaml`

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

Notes:
- `selected` under Coach is the preferred/default model when `mode: auto`.
- In manual Coach mode, `selected` is the only model used.
- Realtime fallback should not silently switch mid-conversation unless reconnect/session creation fails; switching model requires a new Live session.
- Keep secrets out of YAML. `api.txt` remains separate and ignored.

## 4. Source of truth

Use `config.yaml` as the persistent source of truth.

Recommended flow:

```text
server startup
  -> load config.yaml
  -> validate + normalize
  -> expose current settings to frontend

frontend setting change
  -> POST /api/settings
  -> server validates
  -> atomically writes config.yaml
  -> returns normalized settings
  -> frontend applies immediately when safe
     or reconnects when model/session-level setting changes
```

Avoid keeping independent permanent values in both `localStorage` and YAML.

Migration rule:
- Existing localStorage values may be read once only for migration if desired.
- After server persistence exists, YAML should win.

## 5. Module layout

Keep responsibilities separated.

Suggested additions:

```text
src/e_kaiwa/
  settings.py          # YAML load/validate/save + defaults
  model_policy.py      # allowed model lists + failover order/rules
```

Keep existing files focused:
- `config.py`: static constants/paths and teacher definitions.
- `settings.py`: mutable runtime settings persisted in YAML.
- `model_policy.py`: pure model/key retry policy.
- `server.py`: HTTP orchestration only.
- `coach.py`: Coach request execution only.
- `live.js`: UI/orchestration; no YAML parsing in browser.

Do not put failover loops directly into `server.py`.

## 6. YAML persistence

Use one small YAML dependency rather than a custom parser.

Recommended:
- `PyYAML`

Write behavior:
1. Validate incoming field.
2. Update in-memory settings under a lock.
3. Write to temporary file in the project root.
4. Flush/replace `config.yaml` atomically.
5. Return normalized settings to frontend.

Reason:
- Avoid corrupted YAML if two setting changes arrive close together or process exits during write.

Do not rewrite YAML for every audio turn; only write on actual setting changes.

## 7. Settings API

Suggested endpoints:

### `GET /api/settings`

Returns normalized current settings and allowed model choices.

Example:

```json
{
  "settings": {
    "teacher": "Normal",
    "support_language": "vi",
    "pronunciation_enabled": true,
    "silence_duration_ms": 1000,
    "ai_playback_rate": 0.8
  },
  "models": {
    "realtime_conversation": "gemini-3.1-flash-live-preview",
    "coach_mode": "auto",
    "coach_model": "gemini-3.5-flash-lite"
  },
  "choices": {
    "realtime_conversation": [
      "gemini-3.1-flash-live-preview",
      "gemini-2.5-flash-native-audio-preview-12-2025"
    ],
    "coach": [
      "auto",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.6-flash"
    ]
  }
}
```

### `POST /api/settings`

Accept partial updates only.

Example:

```json
{
  "ai_playback_rate": 0.9
}
```

or:

```json
{
  "realtime_conversation_model": "gemini-2.5-flash-native-audio-preview-12-2025"
}
```

Server validates before persistence.

## 8. Realtime conversation model behavior

`/api/session` must read the current configured realtime model instead of a hard-coded `LIVE_MODEL`.

Session creation flow:

```text
configured realtime model
  -> create ephemeral token
  -> return selected model to browser
  -> browser setup uses returned model
```

Important:
- Browser must stop using its own hard-coded model constant.
- Server response should be authoritative.
- Model change while idle: reconnect automatically.
- Model change while recording: do not cut current conversation; mark pending and reconnect after Stop.

Fallback policy for realtime:
- Primary configured model first.
- If session/token/setup fails for a retryable model/service error, try configured fallback once.
- Log the fallback event.
- Do not bounce repeatedly between models.

## 9. Coach failover policy

### Auto mode

Retry order:

```text
model A + key 1
model A + key 2
model A + key 3
...
model A + last active key
  -> if all retryable failures
model B + key 1
model B + key 2
...
  -> model C ...
```

Key slot #4 stays skipped because key loading already excludes it.

Model order:

```text
gemini-3.5-flash-lite
  -> gemini-3.1-flash-lite
  -> gemini-3.6-flash
```

### Manual mode

Example:

```text
selected: gemini-3.1-flash-lite
```

Behavior:

```text
gemini-3.1-flash-lite + key 1
  -> key 2
  -> key 3
  -> ...
  -> fail Coach if all active keys fail
```

Do not silently change to another model in manual mode.

## 10. Retryable vs non-retryable failures

Retry / rotate key/model for:
- HTTP 429
- RESOURCE_EXHAUSTED / quota exhaustion
- HTTP 5xx
- timeout
- network/connectivity error
- transient service unavailable errors

Do not rotate keys/models for deterministic request problems:
- invalid payload / malformed request
- unsupported input
- invalid model configuration
- parsing/validation errors caused by local code

Structured-output parse failures:
- allow at most one controlled retry on the same model with the next key or same model policy decision.
- avoid infinite loops.

## 11. Correction + pronunciation behavior

Keep the current parallel Coach architecture.

```text
Coach turn
  ├─ correction job
  └─ pronunciation job
```

Both should use the same model policy abstraction, but they may resolve to different effective models if one request fails and falls back.

Do not expose separate correction/pronunciation model dropdowns in the first implementation.

Reason:
- backend stays extensible;
- UI stays simple.

Future config may split them later without redesigning the UI.

## 12. Logging for debugging

Add structured fields to Coach logs:

```json
{
  "coach_model_mode": "auto",
  "coach_requested_model": "gemini-3.5-flash-lite",
  "correction_effective_model": "gemini-3.1-flash-lite",
  "correction_key_slot": 3,
  "correction_attempts": [
    {"model":"gemini-3.5-flash-lite","key_slot":1,"status":429},
    {"model":"gemini-3.5-flash-lite","key_slot":2,"status":429},
    {"model":"gemini-3.1-flash-lite","key_slot":3,"status":200}
  ]
}
```

Pronunciation should have the same attempt metadata.

Realtime session logs should include:
- requested realtime model
- effective realtime model
- whether fallback occurred
- fallback reason

Do not log raw API keys.

## 13. UI changes

Inside existing Settings panel, add:

```text
Realtime model
  Gemini 3.1 Flash Live (recommended)
  Gemini 2.5 Native Audio

Coach model
  Auto (recommended)
  Gemini 3.5 Flash-Lite
  Gemini 3.1 Flash-Lite
  Gemini 3.6 Flash
```

Keep model labels human-readable but persist canonical model IDs.

Model-level changes should show a small status message explaining reconnect behavior.

No new settings page or frontend framework.

## 14. Validation/default behavior

If `config.yaml` is missing:
- create it from defaults at startup.

If one field is invalid:
- normalize that field to default;
- keep valid fields;
- log a warning;
- avoid crashing the whole app where possible.

If YAML is completely unreadable:
- fail startup with a clear error rather than silently overwriting user configuration.

Allowed values must live in one backend policy module to avoid duplication.

## 15. Tests

Minimum offline tests:

### settings.py
- missing YAML -> defaults
- valid load
- partial update
- invalid value normalization/rejection
- atomic write
- bool/number handling

### model_policy.py
- key #4 remains excluded
- retry same model across keys first
- then rotate model
- manual mode never rotates model
- 429/5xx/timeout are retryable
- 400 invalid request is not retryable
- finite attempt count

### server/UI wiring
- GET settings returns persisted values
- POST settings persists YAML
- UI renders model choices
- realtime session uses server-selected model
- changing realtime model requires/reuses reconnect behavior

### regressions
- existing realtime audio flow unchanged
- existing multilingual rescue unchanged
- existing Coach hidden on non-English behavior unchanged
- existing pronunciation UI unchanged

## 16. Performance considerations

- Parse YAML once at startup; keep normalized config in memory.
- Persist only on actual changes.
- Use a lightweight lock around config writes.
- Do not reread YAML on every audio chunk, Coach request, or render.
- Model/key failover is sequential only after an actual failure.
- No extra inference call for model selection.

## 17. Suggested implementation order

1. Add root `config.yaml` defaults.
2. Add `settings.py` with load/validate/atomic save.
3. Add `model_policy.py` pure failover logic.
4. Add settings GET/POST API.
5. Load all existing UI settings from server and persist changes.
6. Move realtime model ownership from hard-coded JS/Python constant to runtime settings.
7. Add realtime fallback handling.
8. Refactor Coach calls through model/key failover helper.
9. Add Settings dropdowns for Realtime model + Coach model.
10. Extend structured logs.
11. Add/adjust regression tests.
12. Run CI + manual Live audio smoke.
13. Cleanup duplicated constants/localStorage paths.
14. Squash merge.

## 18. Explicit non-goals for first implementation

Do not add:
- database
- Redis
- background task queue
- automatic model benchmarking
- health-check daemon continuously probing models
- separate UI dropdown for correction vs pronunciation
- `gemini-3.5-transcribe-live` as the realtime conversation model
- arbitrary free-text model IDs from frontend

## 19. Review decisions already agreed

- Realtime default: `gemini-3.1-flash-live-preview`.
- Realtime fallback/test option: `gemini-2.5-flash-native-audio-preview-12-2025`.
- Coach default mode: `Auto`.
- Coach primary: `gemini-3.5-flash-lite`.
- Coach fallbacks: `gemini-3.1-flash-lite`, then `gemini-3.6-flash`.
- Coach failover: rotate API keys first, then rotate models.
- API key slot #4 remains skipped.
- Root `config.yaml` persists current settings.
- User setting changes persist back to YAML.
- Keep the implementation modular and minimal; no overengineering.
