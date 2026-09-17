# E-KAIWA — Kế hoạch v2: làm cho nó "phê" thật sự

Bối cảnh: bản v1 (token màu, nút Talk thở/gợn sóng, score ring trong overlay Coach, lang-dot) đã được áp dụng đúng như plan — mình đã kéo lại repo và đối chiếu từng dòng, khớp 100%. Nhưng hiệu ứng ăn đúng như dự tính: **chỉ đổi ở đúng một điểm (nút Talk) và một màn hình ẩn sau một lượt bấm (overlay Coach)**. Còn lại — font chữ, nền, và nhất là cái điểm số hiện ngay trong mỗi tin nhắn — vẫn y hệt bản gốc, chỉ đổi tông màu xanh dương → xanh ngọc. Với người dùng, cái họ nhìn thấy nhiều nhất mỗi lượt nói lại là thứ chưa đổi gì cả.

Plan này vá đúng 3 lỗ hổng đó, cộng thêm vài khoảnh khắc "thưởng" nhỏ để tạo cảm giác dùng xong muốn nói tiếp — chứ không chỉ là app chấm điểm.

Tất cả ràng buộc ở plan v1 (mục 0 trong file trước) vẫn áp dụng nguyên: không thêm dependency, không đổi `data-state`/class hiện có, chạy lại 2 bộ test sau mỗi phase, tôn trọng `prefers-reduced-motion`.

---

## 1. Vì sao "chưa phê" — chẩn đoán cụ thể

| Vấn đề | Bằng chứng trong code hiện tại |
|---|---|
| Chưa có cá tính chữ | `public.css` dòng 25: `--font-display: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;` — chưa hề đổi, số điểm to trong overlay Coach (`live.css` dòng 499) dùng đúng font hệ thống, không khác gì text thường. |
| Khoảnh khắc thưởng bị giấu | `ui_render.js` hàm `inlineScore()` (dòng ~80–84) vẫn sinh ra `<button class="score-pill score-button">${overall}</button>` y hệt trước redesign. `.score-pill` trong `public.css` dòng 191–195 vẫn dùng `--success`/`--success-soft` — chưa đụng tới. Đây là thứ **xuất hiện ngay trong mỗi tin nhắn AI**, tần suất cao hơn overlay Coach rất nhiều lần, nhưng lại là thứ duy nhất chưa đổi gì. |
| Không có chiều sâu/không khí | `.app-header`, `.conversation-card`, `.control-dock` trong cả `live.css` và `public.css` đều là nền phẳng một màu (`var(--surface)`/`var(--bg)`), không có glow, không có gradient nền. Ánh sáng của nút Talk dừng lại đúng ở viền nút, không lan ra xung quanh. |
| Ấn tượng đầu tiên vẫn nhạt | `.empty-state` (live.html dòng 31, style ở `public.css` dòng 98–102) chỉ là text canh giữa, không có gì gợi cảm giác "bấm vào nói thử xem". |

---

## 2. Bảng file bị ảnh hưởng

| File | Việc chính |
|---|---|
| `src/web/live.html` | Thêm `<link>` Google Fonts trong `<head>` |
| `src/web/live.css` | Đổi `--font-display`, thêm ambient glow, style tier cho score-pill dùng chung (dev+public) |
| `src/web/public.css` | Đổi `--font-display`, glow quanh header/dock, redesign `.score-pill`, empty-state, celebratory burst |
| `src/web/ui_render.js` | Sửa `inlineScore()` để gắn `data-tier` theo mức điểm |
| `src/web/ui.js` | (Chỉ nếu làm Phase D — streak) thêm tính streak khi `render()` |

---

## 3. Phase A — Một font có cá tính, không phải system-ui

**Chọn font:** [Be Vietnam Pro](https://fonts.google.com/specimen/Be+Vietnam+Pro). Lý do chọn đúng font này chứ không phải một display font "trendy" bất kỳ: app có UI tiếng Việt thật (`feedback-language` có option "Tiếng Việt", nhãn `targetLanguageDescription` tiếng Việt trong `ui.js`) — Be Vietnam Pro được thiết kế có chủ đích để phủ đầy đủ dấu tiếng Việt, không rơi vào bẫy "font đẹp nhưng vỡ dấu" như nhiều display font Latin khác. Font có dải weight rộng (100–900) nên dùng được cho cả tiêu đề lẫn nội dung, không cần load thêm font phụ.

### 3.1 `src/web/live.html` — thêm vào `<head>`, sau dòng `<title>` (dòng 7)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
Chỉ 5 weight cần dùng — không load cả bộ 9 weight để tránh nặng tải trên mạng di động (đúng tinh thần "low cost" của README).

### 3.2 `src/web/live.css` — dòng 30

```css
/* trước */
--font-display: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
/* sau */
--font-display: "Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif;
```

### 3.3 `src/web/public.css` — dòng 25 (đổi y hệt 3.2)

### 3.4 Áp dụng `--font-display` vào đúng 3 chỗ có sức nặng thị giác nhất — không đổi toàn bộ UI

Không cần đổi font-family của mọi thẻ (rủi ro làm nội dung dày đặc khó đọc trên di động). Chỉ áp cho 3 chỗ là "mặt" của app:

- `live.css` dòng 128 (`h1`) — đã có `font-family: var(--font-display);` sẵn, giờ tự động nhận diện mới, không cần sửa gì thêm.
- `live.css` dòng 499 (`.score-hero-copy strong`) — đã dùng `var(--font-display)` sẵn, tự động ăn theo.
- **Thêm mới:** `public.css`, ngay dưới rule `.talk-label` (dòng 287–294) — số trên score-pill mới ở Phase B cũng cần dùng `--font-display` với `font-weight: 800`, xem chi tiết ở 4.3.

### 3.5 Nghiệm thu Phase A

- Tiêu đề "E-KAIWA", số điểm to trong overlay Coach đổi rõ rệt sang chữ có cá tính hơn — không phải mọi dòng text trong app đều đổi (tránh nặng, tránh mất mạch lạc).
- Test hiển thị tiếng Việt: mở app với `feedback-language=vi`, kiểm tra mọi dấu (ư, ơ, đ, dấu thanh) hiển thị đúng, không vỡ ký tự.
- Đo thời gian tải: 1 request font (~30–50KB nén woff2 cho 5 weight) — không ảnh hưởng đáng kể tới mục tiêu low-latency của README.

---

## 4. Phase B — Nâng cấp score-pill: khoảnh khắc thưởng xuất hiện *ngay trong chat*

Đây là phase quan trọng nhất trong plan này. Thay vì bọc điểm số trong một pill xanh lá phẳng, biến nó thành một badge có vòng màu theo mức điểm — nhìn thấy ngay, không cần bấm vào overlay.

### 4.1 `src/web/ui_render.js` — sửa `inlineScore()` (dòng ~80–84)

```js
// trước
function inlineScore(turn, t, pronunciationEnabled) {
  if (!pronunciationEnabled || !turn?.coachEligible) return '';
  const overall = turnScore(turn);
  if (overall == null) return '';
  return `<button class="score-pill score-button" type="button" data-ui-action="open-coach" data-turn="${turn.no}" aria-label="${escapeHtml(t('score'))} ${overall}">${overall}</button>`;
}

// sau
function scoreTier(value) {
  if (value >= 90) return 'gold';
  if (value >= 70) return 'teal';
  return 'muted';
}
function inlineScore(turn, t, pronunciationEnabled) {
  if (!pronunciationEnabled || !turn?.coachEligible) return '';
  const overall = turnScore(turn);
  if (overall == null) return '';
  const tier = scoreTier(overall);
  const circumference = 2 * Math.PI * 15; // r=15, khớp CSS ở 4.3
  const offset = circumference * (1 - overall / 100);
  return `<button class="score-pill score-button" type="button" data-ui-action="open-coach" data-turn="${turn.no}" data-score-tier="${tier}" aria-label="${escapeHtml(t('score'))} ${overall}">
    <svg class="score-pill-ring" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15" fill="none" stroke-width="3" class="score-pill-track"/>
      <circle cx="17" cy="17" r="15" fill="none" stroke-width="3" stroke-linecap="round" transform="rotate(-90 17 17)"
        style="stroke-dasharray:${circumference};stroke-dashoffset:${offset}" class="score-pill-arc"/>
    </svg>
    <span class="score-pill-num">${overall}</span>
  </button>`;
}
```

### 4.2 Vì sao dùng 3 mức (gold/teal/muted) thay vì gradient liên tục

Ba mức đủ để tạo cảm giác "cấp bậc" (giống streak/rank trong app học ngôại ngữ khác) mà không cần tính toán màu phức tạp mỗi lần render. Ngưỡng 90/70 có thể chỉnh lại tuỳ độ khó thang điểm thật của Coach — kiểm tra phân phối điểm thật trong `src/tests/python` hoặc log thật trước khi chốt số, tránh trường hợp hầu hết điểm đều rơi vào "muted" khiến hiệu ứng vô nghĩa.

### 4.3 `src/web/public.css` — thay toàn bộ style `.score-pill` cũ (dòng 191–195)

```css
/* xoá style cũ, thay bằng: */
body[data-app-mode="public"] .score-pill {
  position: relative;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
}
body[data-app-mode="public"] .score-pill-ring { position: absolute; inset: 0; }
body[data-app-mode="public"] .score-pill-track { stroke: var(--border); }
body[data-app-mode="public"] .score-pill-num {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 800;
  color: var(--text);
}
body[data-app-mode="public"] [data-score-tier="gold"] .score-pill-arc { stroke: var(--gold); }
body[data-app-mode="public"] [data-score-tier="gold"] .score-pill-num { color: var(--gold); }
body[data-app-mode="public"] [data-score-tier="teal"] .score-pill-arc { stroke: var(--primary); }
body[data-app-mode="public"] [data-score-tier="teal"] .score-pill-num { color: var(--primary); }
body[data-app-mode="public"] [data-score-tier="muted"] .score-pill-arc { stroke: var(--text-muted); }
body[data-app-mode="public"] .score-pill-arc {
  animation: score-pill-grow 700ms cubic-bezier(.22,.9,.3,1) both;
}
@keyframes score-pill-grow { from { stroke-dashoffset: 94.2; } }
```
`94.2` = `2 × π × 15`, khớp bán kính `r=15` trong SVG ở 4.1. Nếu đổi bán kính, cập nhật cả hai chỗ.

**Lưu ý quan trọng:** đổi từ `--gold` dùng cho tier điểm cao *và* dùng cho chấm ngôn ngữ Trung (Phase v1, mục "lang-dot") là **chấp nhận được** vì hai ngữ cảnh không xuất hiện cạnh nhau trên cùng một màn hình (một cái nằm trong Settings, một cái nằm trong bong bóng chat) — không gây nhầm lẫn thực tế, không vi phạm ràng buộc "không dùng lẫn màu ngữ nghĩa" ở plan v1 (ràng buộc đó nói về `--warning`/`--danger`, không phải về việc dùng lại `--gold` giữa hai ngữ cảnh không giao nhau).

### 4.4 `src/web/live.css` — thêm cùng style cho dev mode (không bắt buộc, nhưng để nhất quán)

Thêm khối tương tự 4.3 nhưng không có prefix `body[data-app-mode="public"]`, đặt ngay sau `.score-pill` cũ (dòng 268–281) nếu muốn dev mode cũng thấy ring — có thể bỏ qua bước này nếu dev mode không cần đẹp.

### 4.5 Nghiệm thu Phase B

- Sau mỗi lượt nói có chấm điểm, một vòng tròn nhỏ vẽ dần quanh số điểm ngay trong bong bóng chat — không cần bấm vào đâu cả.
- Điểm ≥90 hiện vòng vàng, 70–89 vòng xanh ngọc, dưới 70 vòng xám — thấy rõ sự khác biệt khi lướt lại lịch sử hội thoại.
- Bấm vào vẫn mở overlay Coach như cũ (không đổi `data-ui-action="open-coach"`).
- `node --test src/tests/js/*.test.mjs` — kiểm tra kỹ nếu có test nào assert `textContent` hoặc cấu trúc của `.score-pill` (trước đây là text thuần `${overall}`, giờ nằm trong `<span class="score-pill-num">`), cập nhật test tương ứng nếu cần.

---

## 5. Phase C — Không khí xung quanh nút Talk, không chỉ đúng cái nút

**Mục tiêu:** để glow của nút Talk lan ra thay vì dừng đột ngột ở viền 68px.

### 5.1 `src/web/public.css` — thêm glow layer cho `.control-dock` (sau dòng 221)

```css
body[data-app-mode="public"] .control-dock { position: relative; overflow: visible; }
body[data-app-mode="public"] .control-dock::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 60%;
  width: 220px;
  height: 220px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%);
  filter: blur(30px);
  opacity: 0.5;
  pointer-events: none;
  transition: opacity 300ms ease, background 300ms ease;
  z-index: -1;
}
body[data-app-mode="public"] .voice-control-row:has(.talk-speaking) ~ .control-dock::before,
body[data-app-mode="public"] .control-dock:has(.talk-speaking)::before {
  background: radial-gradient(circle, color-mix(in srgb, var(--ember) 24%, transparent), transparent 70%);
  opacity: 0.65;
}
```
Dùng `filter: blur()` ở đây **chấp nhận được** dù ràng buộc ở plan v1 (mục 3 cũ) khuyến cáo tránh `filter: blur()` chạy liên tục mỗi khung hình — khác biệt là: glow này **không animate liên tục**, chỉ đổi `opacity`/`background` khi state đổi (vài lần mỗi phút, không phải 60 lần/giây), nên không tốn hiệu năng như một blur chạy trong animation loop.

### 5.2 Thêm sắc thái nhẹ cho header

```css
body[data-app-mode="public"] .app-header {
  background: linear-gradient(180deg, color-mix(in srgb, var(--primary) 5%, var(--bg)), var(--bg));
}
```
Chỉ 5% — đủ để header không còn phẳng tuyệt đối, không đủ để gây chú ý làm mất tập trung khỏi nội dung hội thoại.

### 5.3 Nghiệm thu Phase C

- Nhìn tổng thể control-dock, có một quầng sáng mờ phía sau nút Talk thay vì nút "trôi nổi" trên nền trắng phẳng.
- Quầng sáng đổi màu (teal → ember) khi AI bắt đầu nói, khớp với chính nút Talk.
- Test hiệu năng: cuộn conversation card qua lại nhiều lần, kiểm tra không giật khung hình do lớp `blur()` tĩnh này (blur tĩnh không animate nên chi phí GPU chỉ trả một lần, không lặp lại mỗi frame).

---

## 6. Phase D (tuỳ chọn — cần quyết định trước khi làm) — Streak & khoảnh khắc ăn mừng

Phase này thêm yếu tố game hoá nhẹ, khác với các phase trên (thuần thị giác) — cần bạn quyết định có muốn hay không trước khi giao cho agent, vì nó thêm logic sản phẩm mới chứ không chỉ là style.

**Ý tưởng:** đếm số lượt liên tiếp đạt tier "gold" hoặc "teal" trở lên; khi đạt mốc (ví dụ 3 lượt liên tiếp ≥70), hiện một hiệu ứng ăn mừng ngắn quanh score-pill mới nhất (một vòng sáng bung ra rồi tắt, thuần CSS, không cần confetti thật).

### 6.1 `src/web/ui.js` — tính streak trong `render()` (khu vực dòng ~373)

Cần duyệt `this.turns` theo thứ tự, tính streak tại turn cuối cùng có điểm, truyền xuống `publicTurnHtml` qua một tham số mới `streakCount` chỉ áp cho turn cuối. Việc này đụng vào chữ ký hàm `publicTurnHtml()` trong `ui_render.js` — agent cần tự thiết kế cách truyền tham số sao cho không phá vỡ các lời gọi hiện có, ví dụ thêm object option cuối cùng thay vì thêm positional argument mới.

### 6.2 CSS ăn mừng (gợi ý, không bắt buộc theo đúng hiệu ứng này)

```css
.score-pill.is-milestone::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--gold);
  animation: milestone-burst 900ms ease-out;
}
@keyframes milestone-burst { from { opacity: 0.9; transform: scale(0.8); } to { opacity: 0; transform: scale(1.6); } }
```

### 6.3 Quyết định cần chốt trước khi giao việc này cho agent

- Mốc streak là bao nhiêu lượt? Ngưỡng điểm nào tính là "tốt"?
- Ăn mừng có cần lưu trạng thái streak qua lần tải lại trang không, hay chỉ tính trong phiên hiện tại (`this.turns` vốn cũng mất khi tải lại trang, nên mặc định "chỉ trong phiên" là lựa chọn nhất quán với hành vi hiện tại của app)?

Nếu chưa chắc, **bỏ qua Phase D**, làm A–C trước rồi xem phản hồi người dùng thật.

---

## 7. Phase E — Ấn tượng đầu tiên: empty state

### 7.1 `src/web/public.css` — thay style `.empty-state` (dòng 98–102)

```css
body[data-app-mode="public"] .empty-state {
  padding: 72px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  font-size: 15px;
  line-height: 1.6;
}
body[data-app-mode="public"] .empty-state::before {
  content: "";
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--primary) 55%, white), var(--primary));
  animation: talk-breathe 3.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  body[data-app-mode="public"] .empty-state::before { animation: none; }
}
```
Dùng lại đúng `@keyframes talk-breathe` đã có sẵn từ Phase v1 — không định nghĩa animation mới, giữ file gọn.

### 7.2 Nghiệm thu

- Mở app lần đầu (chưa có lượt nói nào) → thấy một chấm tròn thở nhẹ phía trên dòng chữ hướng dẫn, thay vì chỉ có text — gợi ý trực quan rằng "cái nút tròn dưới kia cũng sẽ như vậy khi bạn bấm vào".

---

## 8. Thứ tự làm & lệnh test

Làm theo thứ tự A → B → C → E trước (thuần thị giác, rủi ro thấp), test bằng mắt thật trên điện thoại sau mỗi phase, rồi mới cân nhắc D.

```bash
PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"
node --test src/tests/js/*.test.mjs
python src/app.py --mode public
```

Sau khi xong A–C–E, mở app trên điện thoại thật, đi qua đúng một lượt hội thoại đầy đủ (mở app → thấy empty state thở → giữ nói → thả tay → AI trả lời → thấy score-pill có vòng màu ngay trong chat) và tự hỏi: khoảnh khắc nào trong luồng đó vẫn thấy nhạt? Đó sẽ là đầu mối cho vòng lặp thiết kế tiếp theo, nếu cần.
