# E-KAIWA — Checklist kỹ thuật sơ bộ (3 giai đoạn cải tiến trải nghiệm)

Mục đích file này: liệt kê **sơ bộ** những chỗ trong code cần sửa/thêm để hoàn thành từng giai đoạn của plan retention. Không đi sâu vào code cụ thể — chỉ đủ để bạn tự triển khai.

Quy ước:
- 🟢 Effort thấp · 🟡 Effort trung bình · 🔴 Effort cao
- File path đều tính từ gốc repo.

---

## Giai đoạn 1 — Chỉ frontend, dùng `localStorage`, KHÔNG đụng backend/DB

Mọi thứ ở giai đoạn này chạy được bằng dữ liệu đã có sẵn trong `state.turns` (bộ nhớ phiên hiện tại) + `localStorage` mới. Không cần sửa `e_kaiwa/*`.

### 1.1 Onboarding lần đầu mở app 🟢
- **Mục tiêu:** giải thích cách nói, xin quyền mic có ngữ cảnh, cho ví dụ câu mở đầu.
- **File cần sửa:**
  - `src/web/live.html` — thêm markup overlay onboarding mới (tái dùng cấu trúc `#overlay-root` / `#overlay-surface` đang có).
  - `src/web/ui_overlay.js` — thêm `'onboarding'` vào `DYNAMIC_OVERLAYS`, thêm hàm `openOnboarding()`.
  - `src/web/ui_render.js` — thêm hàm render `onboardingHtml()`.
  - `src/web/preferences.js` (hoặc file mới `progress.js`) — thêm cờ `hasSeenOnboarding` lưu localStorage để chỉ hiện 1 lần.
  - `src/web/live.js` — gọi mở onboarding trước khi trigger `getUserMedia()` thật, chỉ khi cờ trên = false.
  - `src/web/ui.js` — thêm chuỗi i18n mới (ja/vi) cho phần copy onboarding.

### 1.2 Gợi ý chủ đề mở đầu (chip) 🟢
- **Mục tiêu:** giảm cảm giác "không biết nói gì" khi màn hội thoại còn trống.
- **File cần sửa:**
  - `src/web/live.html` — thêm khu vực chip trong `.conversation-card` (hoặc render động).
  - `src/web/ui_render.js` — hàm render danh sách chip khi `conversation` rỗng, thay `empty-state` mặc định.
  - `src/web/ui.js` — xử lý click chip → gọi hàm gửi prompt khởi tạo trong `live.js` (không cần đổi giao thức Gemini, chỉ gửi 1 câu mở đầu như user tự nói).
  - Nội dung chủ đề: có thể để tạm dạng mảng hardcode trong JS ở bước này (chưa cần cấu hình phía server).
  - `src/web/public.css` — style cho chip.

### 1.3 Tổng kết cuối buổi (session recap) 🟡
- **Mục tiêu:** màn hình "vừa luyện xong" hiển thị số lượt nói, điểm TB, câu tốt nhất, từ cần luyện.
- **File cần sửa:**
  - `src/web/live.html` — thêm nút "Kết thúc buổi" (control-dock hoặc header).
  - `src/web/live.js` — hàm tổng hợp từ `state.turns` (đếm turn, tính điểm TB từ `turn.coach.pronunciation`, gom `problems`).
  - `src/web/ui_render.js` — hàm `sessionRecapHtml()`.
  - `src/web/ui_overlay.js` — thêm loại overlay `'recap'`.
  - `src/web/ui.js` — i18n cho recap.
  - Lưu ý: đây là bước dùng dữ liệu **đã có sẵn trong bộ nhớ**, chưa cần lưu localStorage — làm trước để có "khung" cho streak ở mục 1.6.

### 1.4 Làm mềm copy trạng thái lỗi/kết nối lại 🟢
- **File cần sửa:**
  - `src/web/live.js` — các chỗ gọi `setStatus(...)` / `state.ui.setStatus(...)` khi lỗi/reconnect (tìm theo `error: true`, `'reconnect'`).
  - `src/web/ui.js` — object chuỗi i18n tương ứng (đổi giọng văn, không đổi logic).

### 1.5 Đổi nhãn "AI response speed" dễ hiểu hơn 🟢
- **File cần sửa:**
  - `src/web/live.html` — `<select id="ai-speed">`: đổi label hiển thị (giữ nguyên `value` số thập phân để không phá logic).
  - `src/web/ui.js` — nếu label lấy qua i18n thì sửa ở đây thay vì HTML.

### 1.6 Streak & thống kê nhẹ (localStorage) 🟡
- **Mục tiêu:** lưu ngày luyện tập, tổng số buổi, tổng phút nói, điểm TB theo ngày — tồn tại qua các lần mở app.
- **File cần thêm mới:**
  - `src/web/progress.js` (module mới) — API kiểu giống `PreferencesStore` trong `preferences.js`: `recordSession({turns, avgScore, durationSec})`, `getStreak()`, `getStats()`. Tự viết vào `localStorage` key riêng, ví dụ `e-kaiwa.progress`.
- **File cần sửa:**
  - `src/web/live.js` — gọi `progress.recordSession(...)` tại thời điểm kết thúc buổi (chỗ nối với mục 1.3).
  - `src/web/ui_render.js` — thêm block hiển thị streak/thống kê (trong recap hoặc trong Settings).
  - `src/web/live.html` — chỗ hiển thị streak (ví dụ trong `.settings-panel` hoặc `.dock-meta`).
  - `src/web/public.css` — style badge streak.
  - `src/web/assets/icons/` — cần thêm icon mới (ví dụ "flame"/lửa cho streak) — hiện chưa có trong `assets/icons/`.

### 1.7 Sổ từ khó (vocab notebook) 🟡
- **Mục tiêu:** gom các từ phát âm sai lặp lại (`problem.word`) qua nhiều buổi để ôn lại.
- **File cần sửa:**
  - `src/web/progress.js` — thêm `recordProblemWords(problems)` + `getTopProblemWords()`.
  - `src/web/live.js` — sau mỗi turn có `coach.pronunciation.problems`, gọi hàm ghi nhận.
  - `src/web/ui_render.js` — màn hình mới liệt kê từ khó tích luỹ (tái dùng style `problem-card` đã có ở `problemCards()`).
  - `src/web/ui_overlay.js` — thêm loại overlay `'vocab-notebook'`.
  - Có thể mở lối vào từ Settings (`live.html`, khu `.settings-scroll`).

### 1.8 Mốc nhẹ nhàng / milestone toast 🟢
- **Mục tiêu:** thông báo nhỏ khi đạt "10 buổi", "3 ngày liên tiếp"... không bảng xếp hạng, không áp lực.
- **File cần sửa:**
  - `src/web/progress.js` — hàm kiểm tra mốc mới đạt được sau mỗi `recordSession()`.
  - `src/web/ui.js` hoặc `ui_render.js` — component toast nhỏ (có thể tái dùng cơ chế status hiện có, không cần overlay riêng).
  - `src/web/public.css` — animation toast đơn giản.

---

## Giai đoạn 2 — Thêm hạ tầng nhẹ: PWA + backend tối thiểu (SQLite) + nhắc nhở

Đây là giai đoạn duy nhất cần đụng vào `e_kaiwa/*` (backend Python) và deploy config. Vẫn giữ nguyên triết lý "1 process, không framework".

### 2.1 PWA hoá (add to home screen) 🟡
- **Mục tiêu:** tăng tỷ lệ quay lại nhờ icon trên màn hình chính, không cần gõ URL.
- **File cần thêm mới:**
  - `src/web/manifest.json` — tên app, icon, theme color (đã có `theme-color` trong `live.html`, tái dùng).
  - `src/web/service-worker.js` — cache tối thiểu (assets tĩnh), **không cache audio/WebSocket**.
- **File cần sửa:**
  - `src/web/live.html` — thêm `<link rel="manifest">` và đăng ký service worker trong `live.js` hoặc script riêng.
  - `e_kaiwa/server.py` — đảm bảo route serve đúng `manifest.json`/`service-worker.js` với header phù hợp (scope `/`).
  - `deploy/caddy/*` — kiểm tra Caddyfile có serve đúng static path mới, cache-control hợp lý cho service worker (không cache quá lâu).

### 2.2 Lưu trữ nhẹ phía server để đồng bộ đa thiết bị 🔴
- **Mục tiêu:** streak/lịch sử không mất khi đổi thiết bị/xoá cache.
- **File cần thêm mới:**
  - `e_kaiwa/storage.py` (mới) — lớp truy cập SQLite tối giản (1 file `.db`, không ORM nặng).
  - Schema sơ bộ: bảng `devices` (device_id ẩn danh), bảng `sessions` (ngày, số turn, điểm TB), bảng `problem_words`.
- **File cần sửa:**
  - `e_kaiwa/server.py` — thêm route API mới (ví dụ `POST /api/progress/sync`, `GET /api/progress/:device_id`).
  - `e_kaiwa/access.py` — cấp/đọc `device_id` ẩn danh (cookie hoặc header, không cần tài khoản/mật khẩu ở bước này).
  - `src/web/progress.js` — thêm chế độ đồng bộ: đọc/ghi local trước, đẩy lên server khi có mạng (offline-first, giữ đúng tinh thần "reliability" hiện tại của app).
  - `src/requirements.txt` — không cần thêm gì nếu dùng `sqlite3` built-in của Python.
  - `src/tests/python/` — thêm test cho `storage.py`.
  - `deploy/systemd/` — kiểm tra thư mục data (`.db` file) có quyền ghi đúng, không nằm trong path bị xoá khi cập nhật (`deploy/install_update.sh`, `deploy/updater/`).

### 2.3 Nhắc nhở opt-in (push hoặc email) 🔴
- **Mục tiêu:** kéo người dùng quay lại khi bỏ lỡ ngày luyện.
- **File cần thêm mới:**
  - `e_kaiwa/notify.py` (mới) — gửi web push hoặc email tối giản.
  - `src/web/service-worker.js` — xử lý `push` event (nếu chọn web push thay vì email).
- **File cần sửa:**
  - `e_kaiwa/server.py` — endpoint đăng ký subscription (`POST /api/notify/subscribe`), cần opt-in rõ ràng trong UI.
  - `src/web/live.html` + `ui_overlay.js` — thêm switch bật/tắt nhắc nhở trong Settings (`.settings-scroll`, cạnh mục `pron`/`talk-mode` hiện có).
  - Cần cơ chế lên lịch (cron đơn giản hoặc kiểm tra khi server có request) — cân nhắc kỹ vì đây là phần "nặng" nhất so với triết lý hiện tại của app, có thể để cuối cùng hoặc làm dạng tối giản nhất (email digest 1 lần/ngày qua cron thủ công trên VPS, không cần thêm service).

---

## Giai đoạn 3 — Nội dung chiều sâu (giữ chân dài hạn)

### 3.1 Kịch bản hội thoại theo chủ đề (scenario profile) 🟡
- **Mục tiêu:** mở rộng ngoài "nói chuyện tự do" — nhà hàng, phỏng vấn, du lịch...
- **File cần sửa:**
  - `e_kaiwa/languages.py` — đây là nơi định nghĩa `LanguageProfile`; thêm khái niệm "scenario" theo đúng pattern registry đang có (không phá kiến trúc "1 engine chung + profile").
  - `e_kaiwa/coach.py` — nếu scenario ảnh hưởng tới rubric chấm điểm, cần truyền thêm context vào prompt Coach.
  - `config.yaml` — có thể thêm danh sách scenario mặc định/bật-tắt tại đây (giống cách `models`/`settings` đang cấu hình).
  - `src/web/live.html` + `ui_render.js` — màn chọn chủ đề trước khi bắt đầu (mở rộng chip ở mục 1.2 thành màn chọn đầy đủ).
  - `src/web/ui.js` — i18n tên các chủ đề.
  - `src/tests/python/` — test cho scenario mới trong `languages.py`.

### 3.2 Lộ trình mục tiêu theo tuần (goal-setting) 🟢
- **File cần sửa:**
  - `src/web/progress.js` — thêm khái niệm "mục tiêu tuần" (ví dụ số phút/số buổi), tính % hoàn thành từ dữ liệu đã lưu ở Giai đoạn 1.
  - `src/web/ui_render.js` + `live.html` — hiển thị thanh tiến độ mục tiêu (Settings hoặc màn chính).

### 3.3 Chia sẻ điểm/streak 🟡
- **File cần thêm mới:**
  - `src/web/share_card.js` (mới) — vẽ ảnh chia sẻ bằng `<canvas>` từ dữ liệu streak/điểm.
- **File cần sửa:**
  - `src/web/ui_render.js` / `ui_overlay.js` — nút "Chia sẻ" trong recap (mục 1.3) hoặc màn streak.
  - Không cần backend — xuất ảnh client-side, dùng Web Share API nếu trình duyệt hỗ trợ, fallback tải ảnh về.

---

## Phụ lục — Bản đồ file liên quan (tra nhanh)

| File | Vai trò hiện tại | Liên quan giai đoạn |
|---|---|---|
| `src/web/live.html` | Cấu trúc DOM chính, overlay, settings | 1, 2, 3 |
| `src/web/live.js` | Orchestration realtime, state.turns, status | 1, 2 |
| `src/web/ui.js` | i18n, cập nhật DOM cơ bản, empty state | 1, 2, 3 |
| `src/web/ui_render.js` | Render HTML cho turn/overlay/coach | 1, 3 |
| `src/web/ui_overlay.js` | Quản lý overlay động (mở/đóng/focus) | 1, 2 |
| `src/web/preferences.js` | Lưu preferences UI vào localStorage | tham chiếu pattern cho `progress.js` |
| `src/web/public.css`, `live.css` | Style mobile/public | 1, 2, 3 |
| `src/web/assets/icons/` | Icon SVG | 1 (cần thêm icon mới) |
| `e_kaiwa/server.py` | Route HTTP chính | 2 |
| `e_kaiwa/access.py` | Quản lý truy cập/token | 2 |
| `e_kaiwa/languages.py` | Registry profile ngôn ngữ | 3 |
| `e_kaiwa/coach.py` | Logic chấm Coach | 3 (nếu scenario ảnh hưởng rubric) |
| `config.yaml` | Cấu hình runtime/model | 3 |
| `deploy/caddy/`, `deploy/systemd/` | Hạ tầng VPS | 2 |
| `src/tests/python/`, `src/tests/js/` | Regression test | 2, 3 (thêm test cho module mới) |

---

## Gợi ý thứ tự làm (không bắt buộc)

1. 1.4 → 1.5 (copy/label, gần như miễn phí)
2. 1.1 → 1.2 (onboarding + chủ đề, tác động lớn tới người dùng mới)
3. 1.3 → 1.6 → 1.8 (recap → streak → milestone, tạo thành 1 vòng "habit loop" hoàn chỉnh)
4. 1.7 (vocab notebook, có thể làm song song)
5. 2.1 (PWA — rẻ, tác động lớn) trước khi làm 2.2/2.3 (nặng hơn)
6. 3.x làm sau cùng, khi vòng lặp giữ chân cơ bản đã hoạt động ổn.
