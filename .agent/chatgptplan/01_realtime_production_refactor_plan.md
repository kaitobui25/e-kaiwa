# E-KAIWA – Realtime production refactor plan

Date: 2026-09-08
Branch: `refactor/realtime-modular-v1`

## 1. Goal

Hoàn thiện realtime E-KAIWA hiện tại thành codebase gọn, modular, dễ bảo trì và nâng cấp nhưng **không overengineer**.

Giữ nguyên product flow đã test thành công:

```text
Tap Start một lần
→ mic mở liên tục
→ Gemini Live Automatic VAD tự chia turn
→ streaming audio reply phát ngay
→ coach sidecar chạy riêng sau mỗi turn
→ mic tiếp tục nghe turn sau
```

Không thay đổi kiến trúc chính đang đúng:

```text
Browser mic
  ↕ direct WebSocket PCM
Gemini Live

Browser
  → /api/coach
  → correction + pronunciation feedback
```

## 2. Current problems

Code hiện tại hoạt động nhưng còn coupling cao:

- `live_app.py` đang chứa config, API key loading, token creation, session/logging, PCM WAV, coach orchestration và HTTP routing.
- `web/live.html` đang chứa HTML + CSS + toàn bộ realtime state machine + audio DSP + Gemini WebSocket + rendering + API calls.
- `web_coach.py` nhận object `full` từ test module, làm production code phụ thuộc ngược vào `tests/test_full_loop.py`.
- Root production path đang import code từ `tests/`, khó bảo trì về lâu dài.
- Một số input chưa clamp/validate rõ ràng (`turn`, `sample_rate`, payload shape).
- Static assets chưa có routing riêng vì mọi frontend logic nằm trong một HTML lớn.
- Pure logic chưa có regression tests riêng cho session/config/validation.

## 3. Refactor principles

1. **Preserve behavior first.** Không rewrite product flow.
2. **Thin entrypoint.** `live_app.py` chỉ parse args + start server.
3. **Production must not import tests.** Shared Gemini REST helpers/coach config chuyển vào package production.
4. **Few modules, clear ownership.** Không tạo layer/service/repository abstraction dư thừa.
5. **Stdlib-first backend.** Giữ footprint thấp cho VPS 1 GB RAM.
6. **No database yet.** Runtime logs vẫn filesystem JSONL + WAV.
7. **Frontend state lifecycles stay separated:**
   - Live session lifecycle
   - microphone lifecycle
   - per-turn lifecycle
8. **Coach never blocks spoken reply.** Đây là invariant product quan trọng.

## 4. Target structure

```text
e_kaiwa/
  __init__.py
  config.py          # paths, models, teacher modes, API key loading
  gemini.py          # Gemini REST helper + ephemeral token
  sessions.py        # session registry + JSONL logging + WAV save
  coach.py           # correction/pronunciation sidecar
  server.py          # HTTP handler + routes + app bootstrap

live_app.py           # tiny backward-compatible entrypoint

web/
  live.html           # semantic markup only
  live.css            # styles
  live.js             # realtime app/state/audio/websocket logic

web_coach.py          # compatibility shim; delegates to e_kaiwa.coach

tests/
  test_live_core.py   # pure regression tests for config/session helpers
```

This deliberately stops at ~5 backend modules + 3 frontend files. No framework, DI container, database, bundler, TypeScript or build step.

## 5. Backend module responsibilities

### `e_kaiwa/config.py`

Own:

- project paths
- Live/coach model names
- skipped key slots (`#4`)
- teacher mode mapping/rules
- API key file parsing
- host/port defaults

Rules:

- de-duplicate keys
- ignore comments/blank lines
- preserve original 1-based key slot numbers
- never log raw API keys

### `e_kaiwa/gemini.py`

Own:

- JSON POST helper
- Gemini response text extraction
- ephemeral token creation

No product/session knowledge.

### `e_kaiwa/sessions.py`

Own:

- unique session directory creation
- in-memory session id → path registry
- session id validation
- JSONL event append
- PCM16 → WAV persistence

Keep filesystem logging because it is simple, debuggable and sufficient for current scale.

### `e_kaiwa/coach.py`

Own:

- correction prompt
- pronunciation prompt
- language selection (`vi` / `ja`)
- strictness rules
- parallel correction + pronunciation jobs
- normalized response payload

Coach receives a validated request object/data, not HTTP handler state.

### `e_kaiwa/server.py`

Own:

- HTTP routes
- JSON body size validation
- static file serving
- `/health`
- `/api/session`
- `/api/coach`
- `/api/metric`
- startup/shutdown

Routes should remain small and delegate actual work.

## 6. Frontend split

### `web/live.html`

Only markup and element ids.

### `web/live.css`

Only presentation.

### `web/live.js`

Keep one JS file for now. Splitting further would add complexity before the codebase needs bundling/import maps.

Internally organize functions by sections:

1. DOM/config
2. UI/rendering
3. Live connection
4. audio input/output
5. turn lifecycle
6. coach/metrics API
7. event bindings/bootstrap

Important regression rule:

```text
mic streaming must depend on recording + WebSocket readiness,
NOT on activeTurn existing.
```

PCM can continue going to Gemini while the next turn object is armed around playback boundaries.

## 7. Validation / reliability improvements

Backend:

- clamp `turn >= 1`
- only accept supported feedback languages
- only accept reasonable PCM sample rates
- reject empty/invalid base64 PCM
- enforce JSON request max size
- prevent arbitrary filesystem paths via session id validation + registry lookup
- static files served only from fixed allowlisted routes

Frontend:

- reconnect state remains explicit
- no duplicate session connect while `connecting=true`
- settings persisted only where useful (`silenceDurationMs`)
- network errors render as coach errors without breaking conversation
- stop conversation cleans microphone nodes/tracks

## 8. Compatibility

Must keep these commands working:

```bat
scripts\run_web_test.bat
```

and internally:

```text
python live_app.py
```

No new runtime dependency is required for the realtime server.

Existing experimental/benchmark tests remain untouched unless a compatibility import needs adjustment.

## 9. Tests

Add lightweight stdlib `unittest` coverage for pure behavior:

- key parsing skips duplicate/comment/slot #4
- teacher mapping resolves fallback safely
- session id validation rejects path traversal / invalid characters
- WAV writer creates valid mono PCM16 WAV metadata
- language normalization only returns `vi` or `ja`

Manual browser regression checklist:

1. server starts with `scripts\run_web_test.bat`
2. page loads CSS/JS
3. setup indicator turns green
4. tap Start once
5. complete at least 3 conversation turns without another tap
6. AI audio streams every turn
7. coach appears after spoken reply path has already started/completed independently
8. change Teacher / language / pronunciation
9. change silence timeout, reconnect, verify setting applies
10. Stop releases mic; Start can begin again
11. Live expiry/error shows Reconnect
12. runtime log contains `session_start`, `live_turn`, `coach`

## 10. Implementation order

### Phase 1 — foundation

- add package `e_kaiwa/`
- extract config, Gemini REST, sessions/logging

### Phase 2 — coach

- move production correction/pronunciation logic out of `web_coach.py`
- remove production dependency on `tests/`
- keep compatibility shim if useful

### Phase 3 — HTTP server

- move routes to `e_kaiwa/server.py`
- reduce `live_app.py` to entrypoint
- add static CSS/JS routes

### Phase 4 — frontend

- split `web/live.html` → HTML/CSS/JS
- preserve continuous multi-turn fix exactly
- preserve Automatic VAD settings and coach sidecar behavior

### Phase 5 — tests/docs

- add pure regression tests
- update README current architecture/run command
- syntax/test pass

## 11. Definition of done

Refactor is complete when:

- realtime app no longer imports modules from `tests/`
- `live_app.py` is a thin entrypoint
- backend responsibilities are separated by module
- frontend markup/style/logic are separated
- current hands-free multi-turn behavior is preserved
- coach remains non-blocking relative to Gemini Live audio path
- no new heavyweight infrastructure/dependency is introduced
- tests cover core pure logic
- README describes the new structure and run flow

## 12. Out of scope for this refactor

Do **not** add yet:

- database/user accounts
- Docker/Kubernetes
- Redis/task queue
- React/Vue/Svelte
- TypeScript/build pipeline
- WebRTC gateway
- dedicated phoneme engine
- analytics platform
- auth/product billing

Those should be added only when product requirements justify them.
