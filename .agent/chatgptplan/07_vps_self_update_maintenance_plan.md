# Plan 07 — VPS Self-Update + Global Maintenance Overlay

Status: **planning only**. Plan này chỉ chốt kiến trúc/flow; chưa sửa production code.

## 1. Mục tiêu

Build một cơ chế update E-KAIWA trực tiếp từ UI đang chạy trên VPS:

- user giữ nút `Update` trong **5 giây** mới trigger;
- updater kéo code mới từ `origin/main` về VPS;
- toàn bộ browser đang mở nhìn thấy maintenance overlay + progress `%`;
- khi maintenance bắt đầu, browser phải dừng microphone, dừng playback, đóng Gemini Live WebSocket và khóa mọi interaction;
- E-KAIWA backend được stop trong thời gian apply update + chạy checks/tests;
- **mọi test/check đều chạy đến cuối**, check fail không làm updater dừng giữa chừng;
- sau khi tổng hợp kết quả update/test xong mới `START ekaiwa`;
- sau start phải GET `/health` xác nhận app thực sự ready;
- nếu app ready: tất cả browser hiện result ngắn rồi reload để load code mới;
- nếu test/check có lỗi: vẫn start/deploy, popup chỉ nêu ngắn gọn lỗi ở đâu;
- nếu app không start/health fail: maintenance overlay giữ nguyên, không giả vờ thành công;
- version public bắt đầu từ `0.1`; update quan trọng tăng thủ công `0.2`, `0.3`, ...;
- version hiển thị chữ nhỏ ở đầu Settings;
- code phải clean, module hóa vừa đủ, dễ bảo trì/nâng cấp và nhẹ cho VPS ~1 GB RAM.

## 2. Quyết định đã chốt

### 2.1 Tạm thời không có admin auth

V1 **không build account/admin/password**.

Trigger update dùng hold 5 giây để tránh bấm nhầm.

Lưu ý rõ: hold 5 giây chỉ là UX guard, **không phải security**. User biết endpoint vẫn có thể tự gọi update. Đây là trade-off được chấp nhận tạm thời; auth có thể thêm sau mà không đổi updater core.

### 2.2 Không rollback khi test fail

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

### 2.3 `START ekaiwa` đặt sau kết quả update/test

Flow semantic phải phân biệt:

```text
CHECK SUMMARY COMPLETE
        ↓
START ekaiwa
        ↓
HEALTH READY
        ↓
DEPLOY FINAL STATUS
```

`check summary` có thể xong trước start, nhưng chỉ được gọi deployment `ready/success` sau khi process mới lên và health check pass.

### 2.4 Caddy phải sống xuyên maintenance

E-KAIWA có thể stop, nhưng Caddy không stop.

Caddy có 2 trách nhiệm trong maintenance:

1. reverse proxy E-KAIWA khi app đang chạy;
2. serve maintenance status file trực tiếp khi E-KAIWA đang stop.

Do đó browser vẫn nhận `%` và final status dù backend Python đã chết.

## 3. Architecture mục tiêu

```text
                         ┌────────────────────────┐
                         │      GitHub main       │
                         └───────────┬────────────┘
                                     │ fetch/pull
                                     ▼
Browser ── HTTPS ──> Caddy ──> E-KAIWA :7860
  │                   │               │
  │                   │               └─ POST update request marker
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

Important: Gemini Live hiện là browser → Gemini trực tiếp. Vì vậy chỉ stop backend không đủ để pause user. Frontend maintenance state phải chủ động đóng Live WebSocket và mic trước khi updater stop service.

## 4. Nguyên tắc tránh overengineering

Không làm trong Plan 07:

- không Docker;
- không Kubernetes;
- không blue/green deploy;
- không multi-instance zero-downtime;
- không GitHub webhook/CD server;
- không Redis/message queue;
- không SSE/WebSocket server riêng cho progress;
- không database cho update history;
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
src/e_kaiwa/
  version.py            # canonical app-version reader
  server.py             # chỉ expose health/update trigger facade
  ...                   # realtime/coach giữ ownership hiện tại
```

`server.py` không được chứa git/systemctl/test orchestration.

### 5.2 Frontend

```text
src/web/
  live.js                    # realtime orchestration; expose pause/resume boundary
  maintenance.js             # polling + maintenance state machine
  ui_maintenance.js          # full-screen progress/result overlay only
  ui.js                      # UI facade hiện tại
  ui_overlay.js              # Coach/settings overlay hiện tại, không gộp maintenance vào đây
  live.html
  live.css
```

Maintenance overlay phải tách khỏi `UiOverlayController` hiện tại vì semantics khác hoàn toàn:

- không click backdrop để đóng;
- không Escape để đóng;
- không close button;
- phải khóa cả app;
- phải tồn tại xuyên backend downtime.

### 5.3 Deployment/update code

Đề xuất:

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
    maintenance.caddy         # reference snippet/documentation
```

Không tách thêm module nếu chưa cần.

## 6. Versioning: một nguồn duy nhất

Hiện repo có `__version__ = "0.2.0"` và `config.yaml version: 1`; hai khái niệm này không được trộn.

Plan 07 chuẩn hóa như sau:

### App release version

Canonical public version:

```text
VERSION
```

Nội dung hiện tại khi implement Plan 07:

```text
0.1
```

Mỗi update quan trọng tăng thủ công:

```text
0.1
0.2
0.3
0.4
...
```

Không bắt buộc semantic `0.1.0` cho MVP.

`src/e_kaiwa/version.py` chỉ đọc source này.

`e_kaiwa.__version__` nếu còn cần thì phải derive từ cùng source, không hardcode lần hai.

### Config schema version

`config.yaml version: 1` tiếp tục là version/schema của settings/config nếu code hiện tại cần nó.

Không hiển thị nó như app release.

### Git revision

Ngoài `app_version`, updater/health nên giữ `git_revision` (short SHA) nội bộ.

Lý do: có commit nhỏ không tăng `0.1 → 0.2` nhưng vẫn cần biết VPS đã chạy đúng commit mới.

Public Settings chỉ cần hiện:

```text
E-KAIWA v0.1
```

Không cần show SHA cho user bình thường.

## 7. Health contract

`GET /health` sau Plan 07 nên trả tối thiểu:

```json
{
  "ok": true,
  "mode": "public",
  "version": "0.2",
  "revision": "abc1234"
}
```

Health update phải dùng **GET**, không dùng HEAD.

Updater chỉ coi app ready khi:

- HTTP 200;
- `ok == true`;
- version/revision khớp checkout vừa deploy khi dữ liệu đó có sẵn.

## 8. Maintenance status transport

Runtime state file:

```text
/var/lib/ekaiwa-update/status.json
```

Caddy serve file này trực tiếp ở một path cố định, ví dụ:

```text
/maintenance/status.json
```

Không proxy path này vào E-KAIWA.

Headers nên là `Cache-Control: no-store`.

### Status schema V1

```json
{
  "schema": 1,
  "update_id": "20260910T...",
  "state": "testing",
  "progress": 63,
  "message": "Running browser tests",
  "from_version": "0.1",
  "to_version": "0.2",
  "from_revision": "123abcd",
  "to_revision": "789efgh",
  "failures": [],
  "updated_at": "..."
}
```

`failures` public chỉ chứa summary ngắn, không chứa stack trace, API key, filesystem secret hay raw command output.

Full details đi vào `journalctl -u ekaiwa-update`.

### Atomic write

`update_status.py` phải:

1. write temp file cùng filesystem;
2. flush/close;
3. `os.replace(temp, status.json)`.

Không write trực tiếp từng byte vào status file vì browser poll có thể đọc trúng JSON dở dang.

## 9. Progress model

Không giả vờ đo thời gian chính xác. `%` là phase progress cố định.

Baseline:

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

Nếu step được skip vì không cần, progress nhảy sang phase tiếp theo.

Nếu check fail, progress vẫn tiến.

## 10. Trigger architecture: không để E-KAIWA tự update chính nó

Không chạy updater như child process sống trong `ekaiwa.service` rồi hy vọng nó survive `systemctl stop ekaiwa`.

Đề xuất privilege boundary:

```text
POST /api/update
      ↓
E-KAIWA ghi request marker
      ↓
ekaiwa-update.path phát hiện
      ↓
ekaiwa-update.service chạy độc lập
```

Runtime request path ví dụ:

```text
/run/ekaiwa-update/request
```

Directory được provision sao cho E-KAIWA user `ubuntu` chỉ có quyền tạo request marker, không có quyền chạy arbitrary root command.

`ekaiwa-update.service` là root-owned oneshot vì cần stop/start service.

Các command làm việc trong repo (`git`, pip nếu cần) phải chạy dưới user `ubuntu` để tránh biến file repo thành root-owned.

Không cấp cho web app sudo shell tổng quát.

## 11. Long-press Update UX

Update control đặt trong Settings, gần version nhưng không làm header rối.

Behavior:

```text
pointer/key down
    ↓
start 5-second hold progress
    ↓
release/cancel trước 5s → cancel, không request
    ↓
đủ 5s → trigger đúng 1 lần
```

Sau khi trigger:

- button disabled;
- maintenance overlay hiện ngay ở browser initiator, không đợi poll vòng đầu;
- server/updater duplicate request phải được reject/no-op khi update đang chạy.

Cần handle:

- `pointerdown`;
- `pointerup`;
- `pointercancel`;
- `lostpointercapture`;
- keyboard Space/Enter nếu giữ lâu.

Không dùng một `setTimeout` rải rác trong `live.js`; encapsulate long-press helper/controller.

## 12. Global browser maintenance state

Mỗi browser đang mở chạy lightweight poll tới Caddy status path.

Đề xuất polling:

```text
visible + idle      : ~2 s
hidden + idle       : ~5 s
active maintenance  : ~0.5–1 s
visibility becomes visible -> immediate poll
```

Status file nhỏ và do Caddy serve nên không tạo load đáng kể cho Python app.

Không dùng SSE vì E-KAIWA sẽ stop và ta không muốn thêm status server riêng.

### Enter maintenance

Khi state chuyển khỏi `idle/complete` vào maintenance:

```text
maintenanceActive = true
        ↓
block future reconnect/new session
        ↓
inputForwarding = false
        ↓
cancel push-to-talk hold/activity
        ↓
stop/cleanup microphone
        ↓
stop live/manual playback
        ↓
close Gemini WebSocket intentionally
        ↓
set application inert
        ↓
show non-dismissible maintenance overlay
```

Important: intentional WebSocket close trong maintenance không được chạy normal reconnect/fallback path.

`live.js` cần một boundary rõ, ví dụ:

```text
pauseForMaintenance()
```

`maintenance.js` gọi function này; nó không được tự sửa sâu tất cả realtime state từ ngoài.

### Interaction lock

Maintenance overlay root nên nằm ngoài normal app shell.

Ví dụ:

```html
<main id="app-shell">...</main>
<div id="maintenance-root" hidden>...</div>
```

Khi maintenance:

```text
app-shell.inert = true
maintenance-root.hidden = false
```

CSS thêm fallback `pointer-events` nếu cần.

Do đó:

- Talk disabled;
- Settings không thao tác;
- Coach/replay không thao tác;
- keyboard focus không lọt vào app;
- Gemini không còn interaction.

## 13. Updater state machine

### Phase A — preflight, app vẫn chạy

```text
request received
      ↓
acquire update lock
      ↓
git fetch origin
      ↓
read current HEAD/version
      ↓
read origin/main target HEAD/version
```

Nếu `HEAD == origin/main`:

- không stop app;
- status `already_latest`;
- browser trả result ngắn;
- không tạo downtime vô ích.

Nếu tracked working tree dirty hoặc fast-forward không hợp lệ:

- không stop app;
- status failed;
- hiện summary;
- không tự merge/reset phá local state.

### Phase B — announce maintenance

Updater write:

```text
state=preparing
progress=5
```

Cho active browsers một grace window ngắn để poll status, đóng Gemini/mic và dựng overlay trước khi backend stop.

Grace này là config constant rõ ràng, không hardcode magic sleep rải rác.

### Phase C — stop app

```text
systemctl stop ekaiwa
```

Từ đây E-KAIWA backend unavailable.

Caddy + maintenance status vẫn available.

### Phase D — apply code

Dùng fast-forward only.

Không merge tự động.

Không reset force local repo.

Expected conceptual command:

```text
git merge --ff-only origin/main
```

hoặc equivalent pull `--ff-only`.

### Phase E — dependencies

Tối ưu downtime:

- compare old/new `src/requirements.txt` hash;
- nếu không đổi → skip pip install;
- nếu đổi → dùng E-KAIWA venv hiện tại để install.

Không recreate `.venv` mỗi update.

### Phase F — run all checks

Check registry chạy sequential trên VPS 1 GB để tránh peak RAM.

Mỗi check:

```text
start
  ↓
run subprocess
  ↓
capture exit code + short summary
  ↓
append result
  ↓
continue regardless pass/fail
```

Không dùng một shell chain kiểu:

```bash
cmd1 && cmd2 && cmd3
```

vì command đầu fail sẽ chặn command sau.

### Phase G — freeze check summary

Trước START:

```text
progress=90
state=checks_complete
failures=[...]
```

Đây là status cuối của phần update/test theo yêu cầu.

### Phase H — always attempt start

Sau khi app đã bị stop, orchestration phải có `finally`-style guarantee:

```text
try:
    update + checks
finally:
    attempt START ekaiwa
```

Ngay cả khi:

- pip fail;
- git apply fail giữa phase;
- test runner exception;
- một check timeout;

updater vẫn phải thử start service một lần ở cuối.

Không để exception khiến VPS nằm lại trong trạng thái app stopped mà không attempt recovery.

### Phase I — health

Sau start:

- GET `http://127.0.0.1:7860/health`;
- retry trong bounded timeout;
- không dùng HEAD;
- validate version/revision nếu có.

Nếu health pass:

```text
state=complete
progress=100
```

Nếu health fail:

```text
state=start_failed
progress=100
```

Browser không auto reload khi `start_failed`.

## 14. Check registry V1

Bám CI hiện tại, tối thiểu:

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

Equivalent của CI hiện tại cho `src/web/*.js`.

Nếu tool như `node` không có trên VPS:

- không báo fake success;
- record `Browser tests: node unavailable`;
- tiếp tục remaining checks;
- popup summary ngắn;
- full detail ở journal.

Không cài tool lớn tự động giữa update trừ khi deployment prerequisites đã quyết định rõ.

## 15. Result UX

### Success

```text
✓ E-KAIWA v0.2
Update complete
```

### Có check fail nhưng app healthy

```text
⚠ E-KAIWA v0.2
Failed: Browser tests (1)
```

Nếu nhiều failure:

```text
⚠ E-KAIWA v0.2
Failed: Python tests, JS syntax
```

Không dump stack trace lên popup.

### Start/health fail

```text
✕ Update incomplete
E-KAIWA failed to start
```

Overlay giữ nguyên; không unlock interaction với một backend chưa ready.

## 16. Reload tất cả browser

Khi poll thấy:

```text
state=complete
progress=100
```

browser:

1. ghi `update_id` đã consume;
2. show short result;
3. gọi `location.reload()`;
4. page mới lấy static assets mới (`no-store` hiện tại hỗ trợ flow này).

Cần chống reload loop bằng `update_id`.

Đề xuất lưu `lastCompletedUpdateId` trong `sessionStorage` hoặc local storage phù hợp.

Status có thể tiếp tục ở `complete`; browser đã consume cùng `update_id` không reload lần hai.

Nếu browser bị background/throttled, khi trở lại foreground phải immediate status check và catch up update result.

## 17. Settings UI

Settings header public sau Plan 07 dự kiến:

```text
Settings                         E-KAIWA v0.1
```

hoặc visual tương đương theo UI hiện tại.

Version:

- chữ nhỏ;
- secondary/muted;
- không lấy `config.yaml version`;
- lấy app release source duy nhất.

Update control không nên chiếm diện tích lớn.

Có thể đặt compact row gần version:

```text
E-KAIWA v0.1
[ Hold 5s to Update ]
```

## 18. Caddy responsibilities

Plan implementation cần thêm route static maintenance status trước generic reverse proxy.

Concept:

```text
/maintenance/status.json
    → /var/lib/ekaiwa-update/status.json

all other paths
    → reverse_proxy 127.0.0.1:7860
```

Caddy phải:

- serve status khi ekaiwa.service stopped;
- set no-store;
- không expose cả `/var/lib/ekaiwa-update/` directory listing;
- chỉ expose file/status path cần thiết.

Optional later: static maintenance fallback page cho user mở site mới đúng lúc backend đang stop. Không bắt buộc V1 vì requirement hiện tại tập trung browser đã đang mở.

## 19. systemd responsibilities

### Existing

```text
ekaiwa.service
caddy.service
```

### New

```text
ekaiwa-update.path
    └─ watches update request marker

ekaiwa-update.service
    └─ root oneshot updater
```

`ekaiwa-update.service`:

- không Restart loop vô hạn;
- stdout/stderr vào journald;
- one update at a time;
- bounded timeout cho external commands;
- explicit working paths;
- không phụ thuộc shell activation.

## 20. Updater self-modification rule

Updater đang chạy không nên phụ thuộc vào code bị thay đổi sau `git pull` một cách lazy/khó đoán.

Implementation phải chọn một trong hai cách rõ ràng:

### Preferred

Install stable updater copy ngoài repo, ví dụ:

```text
/opt/ekaiwa-updater/
```

Repo giữ source/reference ở `deploy/updater/`.

Updater hiện tại hoàn thành deployment bằng code stable đang load; source updater mới chỉ dùng cho lần sau.

### Acceptable MVP

Nếu chạy updater trực tiếp từ repo, toàn bộ updater modules phải import/load trước phase git mutation và không lazy-import sau pull.

Không trộn hai mô hình mơ hồ.

## 21. Performance rules cho VPS ~1 GB

- Caddy serve tiny status JSON thay vì hit Python backend;
- idle poll thấp tần suất;
- update poll tăng tần suất chỉ khi cần;
- tests sequential để tránh RAM spike;
- không spawn nhiều workers;
- skip pip nếu requirements không đổi;
- skip update hoàn toàn nếu HEAD đã latest;
- không rebuild venv mỗi lần;
- không tải dependency/tooling không cần thiết;
- full logs ở journald, status JSON rất nhỏ;
- timeout mọi subprocess/network step để updater không treo vô hạn.

## 22. Failure classification

Không gom mọi lỗi thành một boolean.

### Preflight failure

Ví dụ:

- git fetch fail;
- local tracked changes;
- non-fast-forward.

App chưa stop → giữ app đang chạy, show failure.

### Check failure

Ví dụ:

- Python unit test fail;
- browser test fail;
- syntax check fail.

Continue all checks → start app → health.

Nếu health OK: deployed nhưng warning.

### Dependency/update operational failure

Record failure; dependent checks có thể fail/skip; cuối cùng vẫn attempt start.

### Start/health failure

Maintenance không được release.

Status file/Caddy vẫn báo lỗi cho clients.

## 23. Code-quality rules

### Backend

- handler chỉ validate request + create request marker;
- không `subprocess(git...)` trong HTTP handler;
- không systemctl trong `server.py`;
- update state schema tập trung một module;
- no broad mutable globals cho update runtime.

### Frontend

- maintenance state chỉ có một owner;
- realtime code expose small pause boundary;
- không rải `if (updating)` ở hàng chục event handler nếu có thể gate ở controller/UI facade;
- overlay maintenance riêng khỏi Coach/settings overlay;
- pure render function cho progress/result nếu có thể test độc lập.

### Deployment

- subprocess argument list, hạn chế `shell=True`;
- explicit timeout;
- explicit user khi chạy git/pip;
- atomic status file;
- no secret in public status;
- no force reset/merge.

## 24. Tests cần thêm cho Plan 07

### Python

- app version reader đọc đúng canonical version;
- maintenance status writer atomic/schema đúng;
- check aggregator tiếp tục sau failure;
- multiple failures aggregate ngắn đúng;
- update lock chống concurrent run;
- health validation version/revision;
- preflight latest branch không stop service;
- dirty/non-FF preflight abort trước downtime.

### JavaScript

- 5s long press trigger đúng một lần;
- release trước 5s cancel;
- maintenance status enters overlay;
- app becomes non-interactive;
- maintenance pauses realtime exactly once;
- reconnect bị suppress trong maintenance;
- progress render đúng;
- complete result reload once;
- same `update_id` không reload loop;
- failed checks vẫn complete/reload nếu health OK;
- `start_failed` không reload/unlock.

### Manual VPS acceptance

- 2 browser cùng mở site;
- browser A hold update;
- A và B cùng thấy maintenance overlay;
- mic/Live Gemini của cả hai dừng;
- E-KAIWA stop nhưng progress vẫn chạy;
- test fail giả lập vẫn chạy các check còn lại;
- updater start app sau summary;
- health pass;
- cả hai reload;
- Settings hiển thị version mới;
- journal có full result;
- status public chỉ có summary an toàn.

## 25. Implementation phases

### Phase 07A — version foundation

- canonical `VERSION` = `0.1`;
- `version.py`;
- health trả app version + git revision;
- Settings show version nhỏ.

### Phase 07B — maintenance transport

- status schema/writer;
- runtime directory permissions;
- Caddy static status route;
- initial idle status;
- polling controller frontend.

### Phase 07C — frontend freeze

- dedicated maintenance overlay;
- progress ring/%;
- `pauseForMaintenance()` boundary;
- mic/playback/WS shutdown;
- inert app;
- reload/result handling.

### Phase 07D — update trigger + systemd bridge

- long-press control;
- minimal update endpoint;
- request marker;
- `.path` + `.service`;
- concurrency lock.

### Phase 07E — updater

- preflight/fetch;
- no-op if latest;
- stop;
- ff-only apply;
- conditional requirements install;
- sequential all-check registry;
- failure aggregation;
- start in finalization;
- health;
- complete/fail status.

### Phase 07F — regression + VPS real test

- automated tests;
- two-browser maintenance test;
- simulated test failure;
- simulated app start failure;
- verify Caddy status survives E-KAIWA stop;
- verify browser reload no loop.

## 26. Acceptance criteria

Plan 07 chỉ coi hoàn thành khi tất cả điều sau đúng:

1. Settings hiện `E-KAIWA v0.1` (hoặc version release hiện tại) từ một canonical source.
2. Hold Update < 5s không trigger.
3. Hold đủ 5s trigger đúng một update.
4. Concurrent update request không tạo hai updater.
5. Tất cả browser đang mở thấy overlay khi maintenance bắt đầu.
6. Trong overlay không thể Talk/settings/replay/Coach interaction.
7. Mic đã stop và Gemini Live WS đã close trước backend downtime.
8. E-KAIWA stop trong apply + tests.
9. Caddy status `%` vẫn available khi E-KAIWA stopped.
10. Tất cả checks chạy đến cuối dù một/một số check fail.
11. Check failure không tự rollback.
12. `START ekaiwa` chỉ sau check summary.
13. Updater luôn attempt start nếu app đã bị stop.
14. Health dùng GET và xác nhận app ready.
15. Healthy + check failures → popup warning ngắn + reload.
16. Healthy + all pass → success + reload.
17. Start/health fail → giữ maintenance/error, không fake success.
18. Reload không loop.
19. Public status không leak secret/raw logs.
20. VPS không cần thêm framework/service nặng ngoài systemd/Caddy hiện tại.

## 27. Future extension points — không làm ngay

Sau V1 có thể thêm mà không rewrite core:

- Caddy Basic Auth/admin session cho trigger endpoint;
- release notes/version history;
- rollback tới previous known-good revision;
- maintenance page cho new visitors trong downtime;
- GitHub Actions deploy trigger;
- zero-downtime dual instance nếu traffic tăng;
- signed update/release policy.

Các extension này phải ngồi ngoài realtime/Gemini logic.

## 28. Final target flow

```text
HOLD UPDATE 5s
      ↓
preflight/fetch while app alive
      ↓
latest? → no-op, no downtime
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
GET /health (version + revision)
      ↓
healthy?
  ├─ YES → 100% + result popup + reload all clients
  └─ NO  → error overlay stays, no fake completion
```

Đây là kiến trúc mục tiêu cho Plan 07: updater độc lập với app, maintenance state độc lập với backend, frontend pause Gemini đúng nghĩa, flow fail-safe đủ cho một VPS nhỏ nhưng vẫn giữ code đơn giản và dễ nâng cấp.