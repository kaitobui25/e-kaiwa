# E-KAIWA – Realtime production refactor plan

Date: 2026-09-08
Status: **COMPLETED**

Implemented through:

- PR #1 — modular realtime production refactor
- PR #2 — active `src/` + frozen `archive/precode/` repository layout
- PR #3 — separate active Python regression tests and runnable system tests

Current main commit after the active-test split:

```text
4a26f7fa4476c7fe4572bce1a3ebe0cece67d9ef
```

## 1. Goal

Hoàn thiện realtime E-KAIWA thành codebase gọn, modular, dễ bảo trì và nâng cấp nhưng **không overengineer**.

Giữ nguyên product flow đã test thành công:

```text
Tap Start một lần
→ mic mở liên tục
→ Gemini Live Automatic VAD tự chia turn
→ streaming audio reply phát ngay
→ coach sidecar chạy riêng sau mỗi turn
→ mic tiếp tục nghe turn sau
```

Kiến trúc chính:

```text
Browser mic
  ↕ direct WebSocket PCM
Gemini Live

Browser
  → /api/coach
  → correction + pronunciation feedback
```

Coach không được block spoken realtime path.

---

## 2. Problems that triggered the refactor

Trước refactor:

- `live_app.py` chứa quá nhiều trách nhiệm: config, API keys, token, session/logging, PCM WAV, coach orchestration và HTTP routes.
- `web/live.html` chứa HTML + CSS + toàn bộ realtime state machine/audio/WebSocket/rendering/API calls.
- Production path còn phụ thuộc code benchmark trong `tests/`.
- Script production và script benchmark đều có tên `test`, rất dễ nhầm.
- `e_kaiwa/`, `tests/`, `scripts/`, `web/`, `tools/` cùng nằm root nên khó nhìn đâu là code đang sống, đâu là code thử nghiệm cũ.
- Benchmark STT/LLM/TTS/pronunciation/full-loop đã hoàn thành vai trò pre-code nhưng vẫn trông như test đang được duy trì.
- Active test cũng cần tách rõ **Python regression** và **system smoke test** để người maintain biết test nào offline/CI-safe, test nào gọi hệ thống thật.

Các refactor liên tiếp giải quyết cả **code coupling**, **repository organization** và **test ownership**.

---

## 3. Refactor principles

1. **Preserve behavior first.** Không rewrite product flow đang hoạt động.
2. **Active code has one home.** Code còn chạy/còn sửa phải nằm trong `src/`.
3. **Historical experiments are frozen.** Benchmark/pre-code cũ nằm trong `archive/precode/`.
4. **Production must not import archived experiments.** Không dependency ngược từ `src/` sang archive.
5. **Active tests must be explicit.** Offline Python regression và real-system smoke test phải tách riêng.
6. **Few modules, clear ownership.** Không thêm layer/service abstraction dư thừa.
7. **Stdlib-first backend.** Phù hợp VPS nhỏ khoảng 1 GB RAM.
8. **No database yet.** Runtime logs vẫn JSONL + WAV filesystem.
9. **Frontend lifecycles separated:**
   - Live session lifecycle
   - microphone lifecycle
   - per-turn lifecycle
10. **Coach never blocks spoken reply.** Đây là invariant quan trọng.
11. **No frontend build system yet.** Không React/Vue/TypeScript/bundler khi chưa cần.

---

## 4. Final repository structure

```text
src/                    ACTIVE — code đang chạy và còn bảo trì
  app.py                 realtime server entrypoint

  e_kaiwa/
    __init__.py
    config.py             paths, models, teacher modes, API key loading
    gemini.py             Gemini REST helpers + ephemeral token
    sessions.py           session registry + JSONL + WAV persistence
    coach.py              correction + pronunciation sidecar
    server.py             HTTP routes + app bootstrap

  web/
    live.html             semantic markup
    live.css              styles
    live.js               realtime state/audio/WebSocket/UI logic

  scripts/
    setup.bat             setup môi trường local
    run.bat               normal realtime runner

  tests/
    README.md
    run_python.bat        run fast offline Python tests
    run_system.bat        run real local system smoke test

    python/
      test_live_core.py   regression tests cho production helpers

    system/
      check_system.py     starts real app + HTTP/assets + Gemini token check

  requirements.txt        runtime-only dependencies

archive/precode/        FROZEN — code thử nghiệm trước production
  tests/                 STT/LLM/TTS/pronunciation/full-loop/Live benchmarks
  scripts/               benchmark runners cũ
  tools/                 preflight/environment utilities cũ
  legacy/                Gradio + compatibility code cũ
  requirements.txt       dependencies của pre-code experiments
  README.md              giải thích archive

.agent/
  chatgptlog/
  chatgptplan/

.github/
  workflows/ci.yml

api.txt                  local only, gitignored
runtime_logs/            runtime output, gitignored
.venv/                   local environment, gitignored
README.md
```

### Rule going forward

```text
Còn chạy / còn sửa / production-related → src/
Active automated test                   → src/tests/
Không còn chạy, chỉ giữ để tham khảo   → archive/precode/
```

Không đưa code mới vào `archive/precode/` trừ khi chủ động archive một experiment đã kết thúc.

---

## 5. Backend module responsibilities

### `src/e_kaiwa/config.py`

Own:

- repository/runtime paths
- Live/coach model names
- skipped API key slots (`#4`)
- teacher mode mapping/rules
- API key parsing
- host/port defaults

Rules:

- de-duplicate keys
- ignore comment/blank lines
- preserve 1-based key slot numbers
- never log raw API keys
- `api.txt` remains repository-root local config
- `runtime_logs/` remains repository-root runtime output

### `src/e_kaiwa/gemini.py`

Own:

- JSON POST helper
- Gemini response text extraction
- JSON response parsing helper
- ephemeral Live token creation

No session/UI/product state.

### `src/e_kaiwa/sessions.py`

Own:

- unique session directory creation
- session id registry
- session id validation
- JSONL append
- PCM16 → WAV persistence
- safe concurrent log writes

Filesystem logging remains intentional because it is simple and sufficient for the current MVP.

### `src/e_kaiwa/coach.py`

Own:

- correction prompt
- pronunciation prompt
- feedback language (`vi` / `ja`)
- teacher strictness
- correction + pronunciation parallel execution
- normalized coach response

### `src/e_kaiwa/server.py`

Own:

- HTTP server lifecycle
- static routes
- `/health`
- `/api/session`
- `/api/coach`
- `/api/metric`
- request validation

Routes stay small and delegate work to the modules above.

### `src/app.py`

Thin entrypoint only:

```text
import main
→ start server
```

No business logic belongs here.

---

## 6. Frontend structure

### `src/web/live.html`

Markup + element ids only.

### `src/web/live.css`

Presentation only.

### `src/web/live.js`

One plain JS file remains appropriate for now.

Logical sections:

1. DOM/config
2. UI/rendering
3. Gemini Live connection
4. microphone/audio conversion
5. AI audio playback
6. turn lifecycle
7. coach + metric requests
8. settings/event bindings
9. bootstrap/reconnect

Important regression invariant:

```text
session/microphone lifecycle != turn lifecycle
```

The bug fixed earlier must not return:

```text
turnComplete
→ activeTurn = null
→ microphone stream accidentally stops forwarding audio
```

Mic/session are long-lived during conversation; turn objects are created/finalized repeatedly.

---

## 7. Realtime behavior to preserve

```text
Tap Start once
→ get microphone permission
→ continuous PCM stream to Gemini Live
→ Automatic VAD detects silence / end of user turn
→ Gemini replies with streaming audio
→ user transcript + AI transcript update UI
→ coach runs separately
→ wait for AI playback boundary
→ arm next turn
→ continue listening
```

Settings currently supported:

```text
Teacher strictness     Easy / Normal / Strict
Correction language   Tiếng Việt / 日本語
Silence timeout       0.7 / 1.0 / 1.2 / 1.5 s
Pronunciation coach   ON / OFF
```

`silenceDurationMs` applies on Live reconnect/session setup.

---

## 8. Validation / reliability completed

Backend protections now include:

- `turn >= 1`
- normalized/allowlisted feedback language
- supported PCM sample rate validation
- invalid/empty base64 PCM rejection
- even-byte PCM16 validation
- request body max size
- transcript length guard
- session id validation
- registered-session lookup instead of arbitrary filesystem paths
- static file allowlist
- thread-safe session/log registry operations

Frontend reliability behavior includes:

- explicit reconnect state
- duplicate connection guard
- microphone cleanup on stop/error
- coach error does not kill realtime conversation
- coach remains outside spoken latency path
- silence timeout persistence in `localStorage`

---

## 9. Active tests and CI

Historical benchmark tests are no longer part of normal CI.

Active tests now have two explicit levels.

### 9.1 Python regression tests

Location:

```text
src/tests/python/test_live_core.py
```

Run:

```bat
src\tests\run_python.bat
```

Properties:

- fast
- offline
- no `api.txt` required
- no Gemini network call
- safe for CI

Coverage includes:

- API key parsing / duplicate removal / dead slot #4 skip
- teacher mode resolution
- feedback language normalization
- session id validation
- session creation/logging
- PCM16 WAV metadata
- Gemini JSON helper parsing

### 9.2 System smoke test

Location:

```text
src/tests/system/check_system.py
```

Run:

```bat
src\tests\run_system.bat
```

It starts `src/app.py` as a real subprocess on a temporary free local port and verifies:

1. app process starts;
2. `/health` responds correctly;
3. `/` serves the frontend HTML;
4. `/live.css` is served;
5. `/live.js` is served;
6. `/api/session` creates a real Gemini ephemeral token.

Requirements:

- internet access
- valid repository-root `api.txt`

The system smoke test always terminates the child server and prints server output when a failure occurs.

It intentionally does **not** automate browser microphone or the Gemini Live audio WebSocket. That remains the final manual phone/browser test.

### 9.3 CI

CI only runs tests that do not require secrets or external services:

```text
python -m unittest discover -s src/tests/python -p "test_*.py"
python -m compileall -q src/e_kaiwa src/app.py src/tests/system/check_system.py
node --check src/web/live.js
```

The system script is syntax-checked in CI but not executed there.

---

## 10. Normal commands going forward

### Setup

```bat
src\scripts\setup.bat
```

### Python regression test

```bat
src\tests\run_python.bat
```

### System smoke test

```bat
src\tests\run_system.bat
```

### Run realtime app / final phone test

```bat
src\scripts\run.bat
```

The old normal command:

```bat
scripts\run_web_test.bat
```

is intentionally retired because the word `test` made production usage ambiguous.

The old benchmark runners still exist only under:

```text
archive/precode/scripts/
```

They are historical reference, not normal app commands.

---

## 11. Implementation status

### Phase 1 — production modules

- [x] extract runtime config
- [x] extract Gemini REST/token helpers
- [x] extract session/logging/WAV responsibilities

### Phase 2 — coach

- [x] move production correction logic out of benchmark modules
- [x] move production pronunciation logic out of benchmark modules
- [x] correction + pronunciation run in parallel
- [x] production no longer imports pre-code tests

### Phase 3 — HTTP server

- [x] routes moved to `server.py`
- [x] thin entrypoint
- [x] static HTML/CSS/JS routes
- [x] input validation

### Phase 4 — frontend

- [x] HTML/CSS/JS separated
- [x] hands-free multi-turn preserved
- [x] Automatic VAD preserved
- [x] coach sidecar preserved

### Phase 5 — tests/docs

- [x] production regression tests
- [x] lightweight CI
- [x] README updated
- [x] syntax/regression checks pass

### Phase 6 — repository cleanup

- [x] all maintained code moved into `src/`
- [x] normal runner renamed to `src/scripts/run.bat`
- [x] setup moved to `src/scripts/setup.bat`
- [x] historical benchmarks moved to `archive/precode/`
- [x] legacy Gradio/preflight moved to archive
- [x] CI points only at active `src/` code
- [x] root cleaned of ambiguous production/test files

### Phase 7 — active test separation

- [x] offline Python tests moved to `src/tests/python/`
- [x] Python runner added: `src/tests/run_python.bat`
- [x] real-system smoke test added under `src/tests/system/`
- [x] system runner added: `src/tests/run_system.bat`
- [x] system test starts/stops the real app automatically
- [x] system test verifies frontend assets + real Gemini ephemeral token creation
- [x] CI remains secret-free and only runs offline checks

---

## 12. Definition of done — final result

Refactor is considered complete because:

- [x] maintained runtime source has one clear home: `src/`
- [x] pre-code experiments have one clear home: `archive/precode/`
- [x] realtime app does not import archived benchmark modules
- [x] backend responsibilities are modular
- [x] frontend markup/style/logic are separated
- [x] hands-free multi-turn behavior is preserved
- [x] coach is non-blocking relative to Gemini Live spoken reply
- [x] no heavyweight framework/infrastructure was introduced
- [x] regression tests protect core production helpers
- [x] Python regression and system smoke tests are clearly separated
- [x] user-runnable `.bat` commands exist for both active test levels
- [x] CI passes against active source only
- [x] normal setup/run commands no longer contain `test`
- [x] README documents ACTIVE vs FROZEN areas

---

## 13. Regression checklist after future realtime changes

Recommended order:

1. Run `src\tests\run_python.bat`.
2. Run `src\tests\run_system.bat`.
3. Run `src\scripts\run.bat` for the phone/browser realtime check.
4. Phone page loads HTML/CSS/JS.
5. `setupReady=true` appears after Gemini setup.
6. Tap Start once.
7. Complete at least 3 turns without another tap.
8. AI audio streams every turn.
9. Coach result arrives independently of AI playback.
10. Teacher mode changes affect correction/pronunciation strictness.
11. Feedback language switches between Vietnamese/Japanese.
12. Pronunciation ON/OFF behaves correctly.
13. Silence timeout persists and applies after reconnect.
14. Stop releases microphone resources.
15. Start works again after Stop.
16. Live expiration/error exposes Reconnect.
17. `runtime_logs/` contains `session_start`, `live_turn`, and `coach` events.

---

## 14. Out of scope

Do **not** add until product requirements justify them:

- database / user accounts
- Docker / Kubernetes
- Redis / task queue
- React / Vue / Svelte
- TypeScript / frontend build pipeline
- WebRTC gateway
- dedicated phoneme engine
- analytics platform
- auth / billing

The project should continue favoring the smallest architecture that supports the real product requirement.
