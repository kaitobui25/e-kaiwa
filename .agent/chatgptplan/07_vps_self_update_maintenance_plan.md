# Plan 07 — VPS Self-Update + Global Maintenance Overlay

Status: **planning only**. Plan này chỉ chốt kiến trúc/flow; chưa sửa production code.

## 1. Mục tiêu

Build cơ chế update E-KAIWA trực tiếp từ UI đang chạy trên VPS:

- user giữ nút `Update` trong **5 giây** mới trigger;
- updater kéo code mới từ `origin/main` về VPS;
- toàn bộ browser đang mở thấy maintenance overlay + progress `%`;
- khi maintenance bắt đầu, browser dừng microphone, playback, Gemini Live WebSocket và khóa toàn bộ interaction;
- E-KAIWA backend được stop trong thời gian apply update + chạy checks/tests;
- **mọi test/check đều chạy đến cuối**, fail không làm updater dừng giữa chừng;
- sau khi tổng hợp kết quả update/test xong mới `START ekaiwa`;
- sau start phải GET `/health` xác nhận app thực sự ready;
- app healthy + test fail vẫn deploy, popup chỉ nêu ngắn gọn fail ở đâu;
- app start/health fail thì maintenance overlay giữ nguyên, không fake success;
- app version bắt đầu từ `0.1`, nhưng **updater tuyệt đối không tự tăng version**;
- version chỉ thay đổi khi developer chủ động sửa canonical version trong source code/repo rồi commit/push;
- updater chỉ **đọc** version của code hiện tại và code vừa kéo về;
- UI tự load version từ app runtime sau reload, không hardcode version trong frontend;
- version hiển thị chữ nhỏ ở đầu Settings;
- code clean, module hóa vừa đủ, dễ bảo trì/nâng cấp và nhẹ cho VPS ~1 GB RAM.

## 2. Quyết định đã chốt

### 2.1 Tạm thời không có admin auth

V1 không build account/admin/password.

Trigger update dùng hold 5 giây để tránh bấm nhầm.

Hold 5 giây chỉ là UX guard, **không phải security**. Auth có thể thêm sau mà không đổi updater core.

### 2.2 Version thuộc source/release, không thuộc updater

Quy tắc bắt buộc:

```text
Developer sửa code
      ↓
nếu đây là release quan trọng thì developer tự sửa VERSION
      ↓
commit + push GitHub
      ↓
VPS Update chỉ pull code
      ↓
updater đọc VERSION mới
      ↓
app start
      ↓
UI load VERSION từ runtime
```

Updater không có logic:

```text
0.1 + 1 => 0.2
```

Updater không ghi/sửa file version.

Update mới hoàn toàn có thể xảy ra mà version **không đổi**:

```text
before revision: abc1111  version: 0.1
after revision : def2222  version: 0.1
```

Đây là trạng thái hợp lệ.

Chỉ khi developer chủ động đổi source version:

```text
before revision: def2222  version: 0.1
after revision : xyz3333  version: 0.2
```

UI sau reload mới tự hiện `v0.2`.

### 2.3 Không rollback khi test fail

Nếu một check fail:

```text
Python tests FAIL
    ↓
ghi result
    ↓
tiếp tục Browser tests
    ↓
tiếp tục syntax/compile checks
    ↓
collect summary
    ↓
START ekaiwa
```

Không rollback chỉ vì test fail.

### 2.4 `START ekaiwa` đặt sau kết quả update/test

Flow semantic:

```text
CHECK SUMMARY COMPLETE
        ↓
START ekaiwa
        ↓
HEALTH READY
        ↓
DEPLOY FINAL STATUS
```

Check summary có thể xong trước start, nhưng chỉ được gọi deployment `ready/success` sau khi process mới lên và health pass.

### 2.5 Caddy phải sống xuyên maintenance

E-KAIWA có thể stop, nhưng Caddy không stop.

Caddy:

1. reverse proxy E-KAIWA khi app chạy;
2. serve maintenance status trực tiếp khi E-KAIWA stop.

Browser vẫn nhận `%` và status dù backend Python đang chết.

## 3. Architecture mục tiêu

```text
                         ┌────────────────────────┐
                         │      GitHub main       │
                         └───────────┬────────────┘
                                     │ fetch/pull
                                     ▼
Browser ── HTTPS ──> Caddy ──> E-KAIWA :7860
  │                   │               │
  │                   │               └─ update trigger facade
  │                   │
  │                   └─ GET /maintenance/status.json
  │                          │
  │                          ▼
  │                 /var/lib/ekaiwa-update/
  │                      status.json
  │                          ▲
  │                          │ atomic writes
  │                          │
  │              ekaiwa-update.service
  │                  root orchestrator
  │                          │
  │             ┌────────────┼─────────────┐
  │             │            │             │
  │             ▼            ▼             ▼
  │          git/pip      tests/checks   systemctl
  │                                      stop/start
  │
  └─ maintenance controller
      ├─ stop mic
      ├─ stop playback
      ├─ close Gemini WS
      ├─ make app inert
      ├─ show progress
      └─ reload after READY
```

Gemini Live hiện là browser → Gemini trực tiếp. Vì vậy stop backend không đủ để pause user. Frontend maintenance state phải chủ động đóng Live WebSocket + mic trước downtime.

## 4. Nguyên tắc tránh overengineering

Không làm trong Plan 07:

- không Docker/Kubernetes;
- không blue/green;
- không multi-instance zero-downtime;
- không GitHub webhook/CD server;
- không Redis/message queue;
- không SSE/WebSocket progress server riêng;
- không database update history;
- không React/Vue migration;
- không auth/admin trong V1;
- không rollback engine;
- không nhét deployment logic vào Gemini/realtime core.

Giữ:

- systemd;
- Caddy;
- plain Python;
- plain ES modules;
- static JSON polling.

## 5. Module/file architecture đề xuất

### 5.1 Application runtime

```text
VERSION                     # canonical app release version, developer-owned

src/e_kaiwa/
  version.py                # read-only canonical version loader
  server.py                 # health/update trigger facade only
  ...                       # realtime/coach giữ ownership hiện tại
```

`server.py` không chứa git/systemctl/test orchestration.

### 5.2 Frontend

```text
src/web/
  live.js                    # realtime orchestration; expose maintenance pause boundary
  maintenance.js             # polling + maintenance state machine
  ui_maintenance.js          # full-screen progress/result overlay
  ui.js                      # UI facade hiện tại
  ui_overlay.js              # Coach/settings overlays hiện tại
  live.html
  live.css
```

Maintenance overlay tách khỏi normal overlay vì:

- không click backdrop để đóng;
- không Escape;
- không close button;
- khóa cả app;
- sống xuyên backend downtime.

### 5.3 Deployment/update code

```text
deploy/
  updater/
    update_runner.py          # orchestration/state machine
    update_status.py          # status schema + atomic JSON writer
    update_checks.py          # registry/run/aggregate checks

  systemd/
    ekaiwa-update.service
    ekaiwa-update.path

  caddy/
    maintenance.caddy         # reference config/snippet
```

Không split nhỏ hơn khi chưa có nhu cầu thật.

## 6. Versioning — một canonical source, updater read-only

Hiện repo có `e_kaiwa.__version__` và `config.yaml version`; hai khái niệm không được trộn.

### 6.1 Canonical app version

Plan 07 đề xuất root file:

```text
VERSION
```

Ví dụ initial value:

```text
0.1
```

Owner của file này là developer/release process.

Khi developer thấy code đủ quan trọng để đổi public version thì tự sửa:

```text
0.1 → 0.2
```

rồi commit cùng code.

Nếu chỉ fix nhỏ không muốn đổi public version thì giữ nguyên `0.1` dù Git revision mới.

### 6.2 Updater không mutate version

Updater chỉ đọc:

```text
current_version = VERSION ở checkout hiện tại
target_version  = VERSION trong origin/main
```

Có thể đọc target trước checkout bằng Git (`git show origin/main:VERSION`) hoặc đọc sau ff-only apply. Implementation chọn cách sạch nhất, nhưng tuyệt đối không tính/increment version.

`from_version == to_version` là hợp lệ.

### 6.3 Runtime version loader

`src/e_kaiwa/version.py` chỉ đọc canonical `VERSION`.

Nếu `e_kaiwa.__version__` vẫn cần thì derive từ loader này, không hardcode lần hai.

Frontend không hardcode `0.1`, `0.2`.

### 6.4 Config schema version

`config.yaml version: 1` tiếp tục là config/settings schema version nếu code cần.

Không hiển thị nó như app release.

### 6.5 Git revision vẫn là deployment identity chính xác

Updater/health giữ thêm short Git SHA.

Lý do:

```text
version 0.1 + revision aaa1111
version 0.1 + revision bbb2222
```

là hai deployments khác nhau dù public version giống nhau.

Khi xác nhận VPS đã kéo đúng code, **revision là điều kiện quan trọng nhất**.

Settings chỉ cần hiện:

```text
E-KAIWA v0.1
```

Không show SHA cho user bình thường.

## 7. UI version load

Version hiển thị trong Settings phải tới từ backend/runtime payload, không đọc hardcoded JS constant.

Có thể dùng một trong hai cách sạch:

1. `/api/settings` trả thêm `app_version`;
2. frontend bootstrap lấy `/health` rồi truyền `version` vào UI.

Ưu tiên tránh thêm request nếu `/api/settings` đã được load lúc bootstrap.

Flow:

```text
page load/reload
    ↓
backend đọc VERSION
    ↓
settings/bootstrap payload có app_version
    ↓
UI render E-KAIWA vX.Y
```

Do đó sau update:

- VERSION không đổi → UI vẫn version cũ, nhưng code/revision đã mới;
- VERSION đổi trong Git → UI tự hiện version mới;
- updater không cần sửa frontend/version state.

## 8. Health contract

`GET /health` sau Plan 07 nên trả tối thiểu:

```json
{
  "ok": true,
  "mode": "public",
  "version": "0.1",
  "revision": "abc1234"
}
```

Health dùng **GET**, không dùng HEAD.

Updater coi app ready khi:

- HTTP 200;
- `ok == true`;
- `revision == target_revision`;
- `version == target_version` đọc từ target checkout.

Version không cần khác `from_version`.

Ví dụ hợp lệ:

```text
from_version = 0.1
to_version   = 0.1
revision     = old → new
health       = new revision + version 0.1
=> READY
```

## 9. Maintenance status transport

Runtime state:

```text
/var/lib/ekaiwa-update/status.json
```

Caddy serve trực tiếp tại:

```text
/maintenance/status.json
```

Không proxy path này vào E-KAIWA.

Header: `Cache-Control: no-store`.

### Status schema V1

```json
{
  "schema": 1,
  "update_id": "20260910T...",
  "state": "testing",
  "progress": 63,
  "message": "Running browser tests",
  "from_version": "0.1",
  "to_version": "0.1",
  "from_revision": "123abcd",
  "to_revision": "789efgh",
  "failures": [],
  "updated_at": "..."
}
```

`to_version` được đọc từ Git target, không do updater tạo.

`failures` public chỉ chứa summary ngắn; full logs ở journald.

### Atomic write

`update_status.py`:

1. write temp cùng filesystem;
2. flush/close;
3. `os.replace(temp, status.json)`.

Không write trực tiếp status file từng phần.

## 10. Progress model

`%` là phase progress cố định, không giả độ chính xác theo thời gian.

```text
  0%  Preparing
  5%  Maintenance announced
 10%  Stopping E-KAIWA
 20%  Applying Git update
 35%  Dependencies
 45%  Python tests
 60%  Browser module tests
 72%  Python compile checks
 82%  JavaScript syntax checks
 88%  Collecting results
 90%  Check summary complete
 92%  Starting E-KAIWA
 97%  Health check
100%  Ready
```

Step skip thì progress nhảy tới phase tiếp.

Check fail vẫn tiếp tục.

## 11. Trigger architecture — app không tự update chính nó

Không spawn updater child rồi stop chính `ekaiwa.service`.

```text
POST /api/update
      ↓
E-KAIWA ghi request marker
      ↓
ekaiwa-update.path phát hiện
      ↓
ekaiwa-update.service chạy độc lập
```

Request marker ví dụ:

```text
/run/ekaiwa-update/request
```

Web app chỉ được tạo marker; không có general sudo shell.

`ekaiwa-update.service` root-owned oneshot vì cần stop/start service.

Git/pip trong repo chạy dưới user `ubuntu` để tránh root-owned files.

## 12. Long-press Update UX

Update control nằm trong Settings gần version.

```text
pointer/key down
    ↓
start 5-second hold
    ↓
release/cancel < 5s → cancel
    ↓
đủ 5s → trigger đúng 1 lần
```

Sau trigger:

- disable button;
- browser initiator show overlay ngay;
- duplicate updater request reject/no-op.

Handle pointerdown/up/cancel/lost capture + keyboard Space/Enter.

Long-press logic encapsulate riêng, không rải timeout trong `live.js`.

## 13. Global browser maintenance state

Mỗi browser poll Caddy status path.

```text
visible + idle      : ~2 s
hidden + idle       : ~5 s
active maintenance  : ~0.5–1 s
visibility visible  : immediate poll
```

Status JSON nhỏ, Caddy serve trực tiếp nên không tạo load đáng kể lên Python.

### Enter maintenance

```text
maintenanceActive = true
        ↓
block reconnect/new session
        ↓
inputForwarding = false
        ↓
cancel push-to-talk activity
        ↓
cleanup microphone
        ↓
stop playback
        ↓
close Gemini WS intentionally
        ↓
set application inert
        ↓
show non-dismissible overlay
```

Intentional WS close không được chạy normal reconnect/fallback.

`live.js` expose boundary nhỏ:

```text
pauseForMaintenance()
```

`maintenance.js` gọi boundary này; không sửa realtime internals từ ngoài.

### Interaction lock

```html
<main id="app-shell">...</main>
<div id="maintenance-root" hidden>...</div>
```

Maintenance:

```text
app-shell.inert = true
maintenance-root.hidden = false
```

Talk/Settings/Coach/Replay/keyboard focus đều bị khóa.

## 14. Updater state machine

### Phase A — preflight, app vẫn chạy

```text
request
  ↓
lock
  ↓
git fetch origin
  ↓
read current HEAD + current VERSION
  ↓
read origin/main HEAD + target VERSION
```

Nếu `HEAD == origin/main`:

- không stop app;
- status `already_latest`;
- không downtime.

Không dùng version để quyết định có update hay không.

**Chỉ Git revision quyết định latest.**

Ví dụ target commit mới nhưng version vẫn `0.1` → vẫn phải update.

Dirty tracked tree hoặc non-fast-forward:

- không stop app;
- failed status;
- không auto merge/reset phá local state.

### Phase B — announce maintenance

Write:

```text
state=preparing
progress=5
```

Cho clients grace window ngắn để đóng mic/Gemini trước backend stop.

Grace là config constant rõ ràng.

### Phase C — stop app

```text
systemctl stop ekaiwa
```

Caddy/status vẫn sống.

### Phase D — apply code

Fast-forward only.

Không auto merge.

Không force reset.

Concept:

```text
git merge --ff-only origin/main
```

### Phase E — dependencies

- compare old/new `src/requirements.txt` hash;
- không đổi → skip pip;
- đổi → install vào existing E-KAIWA venv;
- không recreate `.venv` mỗi update.

### Phase F — run all checks

Sequential trên VPS 1 GB.

Mỗi check:

```text
run
 ↓
capture exit + short result
 ↓
append result
 ↓
continue pass/fail
```

Không dùng `cmd1 && cmd2 && cmd3`.

### Phase G — freeze check summary

```text
progress=90
state=checks_complete
failures=[...]
```

### Phase H — always attempt start

Sau khi app đã stop, orchestration có `finally`-style guarantee để luôn attempt start một lần, kể cả pip/git/check có lỗi.

### Phase I — health

Sau start:

- GET `http://127.0.0.1:7860/health`;
- bounded retry;
- validate target Git revision;
- validate target VERSION value;
- không yêu cầu version phải tăng.

Pass:

```text
state=complete
progress=100
```

Fail:

```text
state=start_failed
progress=100
```

Không auto reload khi start failed.

## 15. Check registry V1

Bám CI hiện tại:

### Python unit tests

```bash
python -m unittest discover -s src/tests/python -p "test_*.py"
```

### Browser module tests

```bash
node --test src/tests/js/*.test.mjs
```

### Python compile

```bash
python -m compileall -q src/e_kaiwa src/app.py src/tests/system/check_system.py
```

### JavaScript syntax

Equivalent CI cho `src/web/*.js`.

Tool thiếu thì record warning/failure ngắn, tiếp tục checks; không fake success.

## 16. Result UX

Popup lấy version từ `to_version`/runtime, không tự suy ra version mới.

### Success, version không đổi

```text
✓ E-KAIWA v0.1
Update complete
```

### Success, developer đã đổi version trong Git

```text
✓ E-KAIWA v0.2
Update complete
```

### Check fail nhưng app healthy

```text
⚠ E-KAIWA v0.1
Failed: Browser tests (1)
```

Version nào hiện ra phụ thuộc canonical VERSION trong code vừa deploy.

### Start/health fail

```text
✕ Update incomplete
E-KAIWA failed to start
```

Không dump stack trace lên popup.

## 17. Reload tất cả browser

Khi:

```text
state=complete
progress=100
```

browser:

1. ghi `update_id` đã consume;
2. show short result;
3. `location.reload()`;
4. page mới tự load app version từ runtime payload.

Chống reload loop bằng `update_id` trong session/local storage phù hợp.

Browser background khi foreground lại phải immediate status check.

## 18. Settings UI

Ví dụ:

```text
Settings                         E-KAIWA v0.1
```

Version:

- nhỏ/muted;
- không lấy `config.yaml version`;
- không hardcode JS;
- không lấy từ update counter;
- lấy canonical app version qua runtime payload.

Update button compact gần version:

```text
E-KAIWA v0.1
[ Hold 5s to Update ]
```

Nhấn Update không làm UI đổi `v0.1 → v0.2` trừ khi code Git vừa pull thật sự chứa VERSION `0.2`.

## 19. Caddy responsibilities

Static maintenance status route trước generic reverse proxy:

```text
/maintenance/status.json
    → /var/lib/ekaiwa-update/status.json

all other paths
    → reverse_proxy 127.0.0.1:7860
```

Caddy:

- serve status khi app stopped;
- no-store;
- không expose directory listing;
- chỉ expose file cần thiết.

Maintenance fallback page cho visitor mới là optional later.

## 20. systemd responsibilities

Existing:

```text
ekaiwa.service
caddy.service
```

New:

```text
ekaiwa-update.path
    └─ watches request marker

ekaiwa-update.service
    └─ root oneshot updater
```

Updater service:

- one update at a time;
- bounded timeout;
- explicit paths;
- journald logs;
- không shell activation dependency;
- không restart loop vô hạn.

## 21. Updater self-modification rule

Preferred:

```text
/opt/ekaiwa-updater/
```

là stable installed updater copy; repo giữ source ở `deploy/updater/`.

Updater hiện tại hoàn thành bằng code stable đang load; updater source mới áp dụng cho lần sau.

Acceptable MVP nếu chạy từ repo: load/import updater modules trước Git mutation và không lazy-import sau pull.

## 22. Performance rules cho VPS ~1 GB

- Caddy serve tiny JSON;
- polling idle thấp;
- maintenance polling nhanh chỉ khi cần;
- tests sequential;
- skip pip nếu requirements không đổi;
- skip update nếu Git HEAD đã latest;
- không dùng version equality để skip update;
- không rebuild venv;
- không tải tooling không cần;
- full logs ở journald;
- subprocess/network đều có timeout.

## 23. Failure classification

### Preflight failure

Git fetch fail, dirty tree, non-FF.

App chưa stop → giữ app chạy + show failure.

### Check failure

Unit/browser/syntax fail.

Continue all → start → health.

Health OK → deployed warning.

### Operational failure

Git apply/pip/runtime issue.

Record; cuối cùng vẫn attempt start.

### Start/health failure

Maintenance không release.

Caddy status vẫn báo lỗi.

## 24. Code-quality rules

### Backend

- handler validate + create marker only;
- không subprocess git trong HTTP handler;
- không systemctl trong `server.py`;
- update state schema một owner;
- app version loader read-only;
- không logic tăng version trong updater/backend/frontend.

### Frontend

- maintenance state một owner;
- realtime expose small pause boundary;
- không rải `if (updating)` khắp handlers;
- maintenance overlay tách normal overlay;
- version render từ runtime data, không constant duplicate.

### Deployment

- subprocess argument list;
- hạn chế `shell=True`;
- explicit timeout/user/path;
- atomic status file;
- no secret public;
- no force reset/merge;
- VERSION là read-only đối với updater.

## 25. Tests cần thêm

### Python

- version loader đọc canonical VERSION đúng;
- updater không mutate VERSION;
- target version reader đọc đúng `origin/main:VERSION`;
- cùng version + khác revision vẫn update;
- health validation chấp nhận same version nhưng target revision mới;
- status writer atomic/schema;
- check aggregator tiếp tục sau failure;
- update lock chống concurrent run;
- latest Git branch không stop service;
- dirty/non-FF abort trước downtime.

### JavaScript

- 5s hold trigger một lần;
- release sớm cancel;
- maintenance enters overlay;
- app inert;
- realtime pause once;
- reconnect suppress;
- progress render;
- complete reload once;
- same update_id không loop;
- failed checks vẫn reload nếu health OK;
- start_failed không unlock/reload;
- Settings version render từ payload;
- update completion không tự increment version client-side.

### Manual VPS acceptance

- 2 browser cùng mở;
- A hold Update;
- A/B cùng overlay;
- mic/Gemini cả hai dừng;
- app stop nhưng progress chạy;
- fake test fail vẫn chạy checks còn lại;
- start sau summary;
- health pass;
- cả hai reload;
- nếu VERSION Git giữ 0.1 thì Settings vẫn 0.1;
- nếu developer commit VERSION 0.2 thì Settings tự hiện 0.2;
- journal full result;
- public status không leak secret.

## 26. Implementation phases

### Phase 07A — version foundation

- add canonical root `VERSION`, initial `0.1`;
- migrate existing `__version__` sang derive/read canonical source;
- giữ `config.yaml version` là config schema riêng;
- health trả app version + git revision;
- bootstrap/settings payload trả app version cho UI;
- Settings show version nhỏ;
- updater không có write permission/logic cho VERSION ngoài Git checkout update bình thường.

### Phase 07B — maintenance transport

- status schema/writer;
- runtime directory permissions;
- Caddy static route;
- initial idle status;
- frontend polling.

### Phase 07C — frontend freeze

- dedicated overlay;
- progress ring/%;
- `pauseForMaintenance()`;
- mic/playback/WS shutdown;
- inert app;
- reload/result handling.

### Phase 07D — update trigger + systemd bridge

- long-press;
- minimal trigger endpoint;
- request marker;
- `.path` + `.service`;
- lock.

### Phase 07E — updater

- preflight/fetch;
- read current/target revision + version;
- latest decision dựa Git revision;
- stop;
- ff-only apply;
- conditional requirements;
- all-check registry;
- aggregate failures;
- start finalization;
- health target revision/version;
- complete/fail status.

### Phase 07F — regression + VPS real test

- automated tests;
- two-browser maintenance test;
- update commit không đổi VERSION;
- update commit có đổi VERSION;
- simulated test fail;
- simulated app start fail;
- Caddy status survives app stop;
- no reload loop.

## 27. Acceptance criteria

Plan 07 chỉ hoàn thành khi:

1. Có đúng một canonical app VERSION source.
2. Version ban đầu dự kiến `0.1`.
3. Chỉ developer/source commit quyết định đổi version.
4. Nhấn Update không tự increment/mutate version.
5. Commit mới cùng version vẫn được updater deploy theo Git revision.
6. Settings tự load version runtime, không hardcode.
7. Hold <5s không trigger; đủ 5s trigger đúng một lần.
8. Concurrent update không tạo hai updater.
9. Tất cả browser đang mở thấy maintenance overlay.
10. Trong maintenance không Talk/Settings/Replay/Coach/Gemini interaction.
11. Mic stop + Gemini WS close trước backend downtime.
12. E-KAIWA stop trong apply + tests.
13. Caddy status `%` vẫn available khi E-KAIWA stopped.
14. Tất cả checks chạy hết dù fail.
15. Check fail không rollback.
16. `START ekaiwa` chỉ sau check summary.
17. Nếu app đã stop, updater luôn attempt start.
18. Health GET xác nhận target revision + target VERSION value.
19. Health không yêu cầu version phải tăng.
20. Healthy + check fail → warning ngắn + reload.
21. Healthy + all pass → success + reload.
22. Start/health fail → giữ maintenance/error.
23. Reload không loop.
24. Sau reload UI phản ánh VERSION thực tế của code vừa deploy.
25. Public status không leak secrets/raw logs.
26. Không thêm framework/service nặng ngoài systemd/Caddy hiện tại.

## 28. Future extension points — không làm ngay

- Caddy Basic Auth/admin session;
- release notes/version history;
- rollback previous revision;
- maintenance page cho visitor mới;
- GitHub Actions deploy trigger;
- zero-downtime dual instance;
- signed release/update policy.

Version release vẫn phải độc lập updater ngay cả khi sau này thêm các extension này.

## 29. Final target flow

```text
Developer code/change
      ↓
optional: developer manually edits VERSION
      ↓
commit + push GitHub

HOLD UPDATE 5s
      ↓
fetch while app alive
      ↓
read current revision/version
read target revision/version
      ↓
revision latest? → no-op, no downtime
      ↓
status PREPARING
      ↓
ALL browsers pause Gemini/mic + show overlay
      ↓
STOP ekaiwa
      ↓
FF-only code update
      ↓
dependencies if changed
      ↓
run ALL checks sequentially
      ↓
collect ALL failures
      ↓
CHECK SUMMARY COMPLETE (90%)
      ↓
START ekaiwa
      ↓
GET /health
  validate target revision
  validate target VERSION value
      ↓
healthy?
  ├─ YES → 100% + result popup + reload all clients
  │          ↓
  │       UI reads VERSION from new runtime
  └─ NO  → error overlay stays
```

Core rule của Plan 07:

> **Updater deploys Git revisions; developer owns release version.**
>
> Update không tự tăng version. Version UI chỉ thay đổi khi canonical VERSION trong code Git thay đổi.