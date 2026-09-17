# E-KAIWA — Kế hoạch triển khai kỹ thuật (redesign UI)

Tài liệu này dịch bản kế hoạch thiết kế ("giọng nói hoá thành ánh sáng") thành các thay đổi cụ thể trong source code, để một agent/coding assistant có thể thao tác trực tiếp trên repo mà không cần hỏi lại ngữ cảnh. Mỗi phase nêu rõ: file nào, selector/hàm nào, giá trị cũ → mới, và cách kiểm chứng.

Repo gốc: `kaitobui25/e-kaiwa`. Toàn bộ đường dẫn trong tài liệu này là tương đối so với thư mục gốc repo.

---

## 0. Ràng buộc bắt buộc (đọc trước khi sửa bất kỳ file nào)

1. **Không thêm dependency mới.** Không React/Vue, không thư viện animation, không build step mới. Repo hiện là vanilla JS + CSS thuần theo đúng "Design principles" trong README — giữ nguyên.
2. **Không đổi tên state/class hiện có.** `data-state` trên `#talk` (`connecting|ready|pressed|recording|waiting|speaking|reconnect`) và class `talk-${state}` do `ui.js#setTalkState()` sinh ra phải giữ nguyên chuỗi. Chỉ được **thêm** CSS selector nhắm vào các class này, không đổi logic sinh class trong JS trừ khi mục đó nói rõ.
3. **Không đổi cấu trúc DOM trong `live.html`** trừ khi phase nói rõ là cần. Ưu tiên tuyệt đối: dùng CSS (`::before`, `::after`, `:has()`) thay vì thêm thẻ HTML mới, để giảm rủi ro hồi quy trên bộ test JS hiện có (`src/tests/js/ui.test.mjs`, `ui_overlay.test.mjs`).
4. **Tách biệt hai nhóm màu theo ngữ nghĩa, không dùng lẫn:**
   - Nhóm trạng thái hệ thống (giữ nguyên, không đổi ý nghĩa): `--success`, `--warning`, `--danger`.
   - Nhóm bản sắc thương hiệu/giọng nói (đổi giá trị + thêm mới ở Phase 1): `--primary` (đổi từ xanh dương → xanh ngọc), `--ember` (mới — chỉ dùng cho khoảnh khắc "AI đang nói"), `--sakura`/`--gold` (mới — chỉ dùng làm chấm nhận diện ngôn ngữ Nhật/Trung, không dùng cho icon cảnh báo).
5. **`--ember` là màu tạm thời, không phải màu thường trực.** Nó chỉ xuất hiện khi nút Talk ở trạng thái `talk-speaking`. Avatar AI tĩnh, header, v.v. không đổi sang cam — tránh hai lớp ý nghĩa chồng lên nhau trên cùng một yếu tố.
6. Sau mỗi phase, chạy:
   ```bash
   PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"
   node --test src/tests/js/*.test.mjs
   ```
   và mở `python src/app.py --mode public` để test bằng mắt trên di động thật hoặc DevTools responsive mode. Không sang phase kế tiếp nếu hai lệnh trên fail.
7. Tôn trọng `prefers-reduced-motion: reduce` cho **mọi** animation mới — xem quy tắc chi tiết trong Phase 2 và Phase 4.

---

## 1. Bảng tổng quan file bị ảnh hưởng

| File | Phase | Loại thay đổi |
|---|---|---|
| `src/web/live.css` | 1, 2, 3, 4 | Sửa token + selector hiện có, thêm keyframes mới |
| `src/web/public.css` | 1, 2, 3 | Sửa override hiện có (nhiều chỗ đang "làm phẳng" hiệu ứng cần được nới lại có chủ đích) |
| `src/web/live.html` | 5 | Thêm 1 `<span>` chấm màu cạnh `#target-language`, thêm `id="score-number"`/`id="score-ring-fg"` không áp dụng ở đây (được sinh động bởi JS ở Phase 4) |
| `src/web/live.js` | 5 | Thêm 3 dòng: set `body.dataset.targetLanguage` khi khởi tạo và khi đổi ngôn ngữ |
| `src/web/ui_render.js` | 4 | Thêm hàm `scoreRingSvg()`, sửa `coachOverviewHtml()` để dùng SVG ring thay `scoreBar()` cho điểm tổng |
| `src/web/ui_overlay.js` | 4 | Thêm ~15 dòng: animate đếm số điểm sau khi `renderActive()` chèn markup coach |
| `src/web/ui.js` | 3 | Thêm 3-4 dòng trong `render()`: đánh dấu `.turn` mới nhất để chạy animation xuất hiện |

Không đụng vào: `audio.js`, `live_recovery.js`, `language_policy.js`, `maintenance*.js/css`, `preferences.js`, `deploy/`, `src/e_kaiwa/`, `config.yaml`.

---

## 2. Phase 1 — Token màu nền tảng

**Mục tiêu:** đổi bản sắc màu chủ đạo từ xanh dương "SaaS" sang xanh ngọc, chỉ bằng cách sửa **giá trị** của biến đã tồn tại — không đổi tên biến, không đụng selector nào khác. Đây là thay đổi rủi ro thấp nhất nhưng có tác động thị giác lớn nhất, vì `--primary`/`--primary-strong`/`--primary-soft` đã được dùng ở hơn 25 chỗ trong hai file CSS.

### 2.1 `src/web/live.css` — khối `:root` (dòng 1–31)

Sửa các dòng sau (giữ nguyên toàn bộ biến khác):

```css
/* trước */
--primary: #3f86f7;
--primary-strong: #2f73e8;
--primary-soft: #eaf3ff;

/* sau */
--primary: #0EA89A;
--primary-strong: #0C8F84;
--primary-soft: #E4F6F3;
```

Thêm 2 biến mới ngay dưới `--danger` (dòng ~19):

```css
--ember: #E85B44;      /* chỉ dùng khi talk-speaking */
--ember-soft: #FCEAE6;
--sakura: #E85D89;     /* chấm ngôn ngữ Nhật, không dùng nơi khác */
--gold: #C9932A;       /* chấm ngôn ngữ Trung, không dùng nơi khác */
```

### 2.2 `src/web/live.css` — khối `body[data-theme="dark"]` (dòng 33–54)

```css
/* trước */
--primary: #6ca4ff;
--primary-strong: #5796ff;
--primary-soft: #1c3151;

/* sau */
--primary: #2FD9C4;
--primary-strong: #3EE6D2;
--primary-soft: #14332F;
```

Thêm:

```css
--ember: #FF6F5E;
--ember-soft: #3A211C;
--sakura: #FF8FB4;
--gold: #E8B33D;
```

### 2.3 `src/web/public.css` — hai khối token (dòng 4–27 và 29–46)

Áp dụng **cùng cặp giá trị** như 2.1/2.2 cho `--primary`, `--primary-strong`, `--primary-soft` trong cả block sáng và tối của `public.css` (hiện đang định nghĩa lại độc lập với `live.css`, ví dụ dòng 11–13 là `#2f6fed / #245ecf / #eaf1ff`). Thêm cùng bốn biến `--ember`, `--ember-soft`, `--sakura`, `--gold` vào cả hai block.

### 2.4 Việc không cần làm ở phase này

Không sửa `--user-surface`, `--ai-surface` ở bước này — chuyển sang Phase 3, vì hai biến này liên quan trực tiếp đến hệ màu "hai giọng" chứ không phải token thương hiệu chung.

### 2.5 Nghiệm thu Phase 1

- Toàn bộ nút, link, icon vốn đang xanh dương giờ chuyển xanh ngọc mà **không cần sửa gì khác**.
- `node --test src/tests/js/*.test.mjs` xanh (phase này không đụng JS nên chắc chắn không fail vì phase này).
- Kiểm tra độ tương phản: `--primary` (#0EA89A) trên `--surface` (#ffffff) và `--text` trên `--bg` mới đều đạt tối thiểu WCAG AA cho text 14px trở lên.

---

## 3. Phase 2 — Nút Talk & sóng âm

**Mục tiêu:** nút Talk "thở" khi chờ, gợn sóng khi người dùng nói, đổi sang `--ember` và hiện sóng cân bằng khi AI nói. Toàn bộ chỉ bằng CSS, không đổi `ui.js#setTalkState()`.

### 3.1 `src/web/live.css` — `.talk-button` (dòng ~327–352)

Hiện tại:
```css
.talk-button { background: linear-gradient(145deg, #5c9cff, var(--primary-strong)); ... }
.talk-pressed, .talk-recording { background: linear-gradient(145deg, #367df0, #1f64dc); box-shadow: 0 0 0 10px color-mix(in srgb, var(--primary) 18%, transparent), 0 10px 28px rgba(47, 115, 232, 0.3); }
```

Hai màu hex `#5c9cff`, `#367df0`, `#1f64dc` đang hardcode xanh dương, không đi qua biến — phải sửa để đồng bộ với Phase 1:

```css
.talk-button {
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--primary) 55%, white), var(--primary));
  animation: talk-breathe 3.4s ease-in-out infinite;
}
.talk-pressed, .talk-recording {
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--primary) 55%, white), var(--primary-strong));
  box-shadow: 0 0 0 10px color-mix(in srgb, var(--primary) 18%, transparent), 0 10px 28px rgba(14, 168, 154, 0.3);
  animation: talk-breathe-fast 1.6s ease-in-out infinite;
}
.talk-speaking {
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--ember) 55%, white), var(--ember));
}
@keyframes talk-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes talk-breathe-fast { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
```

Thêm gợn sóng bằng pseudo-element, không thêm DOM mới:

```css
.talk-button { position: relative; }
.talk-recording::before, .talk-recording::after,
.talk-pressed::before, .talk-pressed::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid var(--primary); pointer-events: none;
  animation: talk-ripple 1.8s cubic-bezier(.24,.72,.4,1) infinite;
}
.talk-recording::after, .talk-pressed::after { animation-delay: 0.6s; }
@keyframes talk-ripple { 0% { opacity: 0.5; transform: scale(0.9); } 100% { opacity: 0; transform: scale(1.6); } }
```

**Xoá** dòng `.talk-waiting, .talk-speaking { filter: saturate(0.72); }` (dòng ~350) — filter này đang làm nhạt màu ember mới thêm, không còn phù hợp ý đồ thiết kế.

### 3.2 `src/web/live.css` — `.replay-main` (dòng ~595–604)

Hardcode `#5c9cff` tương tự, sửa cùng cách:
```css
background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--primary) 55%, white), var(--primary-strong));
```

### 3.3 Sóng âm cân bằng khi AI nói — `src/web/public.css`

`public.css` dòng ~203–205 hiện đang **ẩn hoàn toàn** `.voice-waves` trong chế độ public:
```css
body[data-app-mode="public"] .voice-waves { display: none; }
```
Đây là quyết định thiết kế cũ ("no decorative pseudo-waveform" — xem comment đầu file `public.css`). Cần đảo ngược có chủ đích: chỉ hiện khi AI đang nói, dùng `:has()` để không phải sửa JS.

Thay dòng trên bằng:
```css
body[data-app-mode="public"] .voice-waves { display: flex; opacity: 0; transition: opacity 160ms ease; }
body[data-app-mode="public"] .voice-control-row:has(.talk-speaking) .voice-waves {
  opacity: 1; color: var(--ember);
}
body[data-app-mode="public"] .voice-control-row:has(.talk-speaking) .voice-waves span {
  animation: talk-eq 0.9s ease-in-out infinite;
}
body[data-app-mode="public"] .voice-waves span:nth-child(2) { animation-delay: 0.15s; }
body[data-app-mode="public"] .voice-waves span:nth-child(3) { animation-delay: 0.3s; }
body[data-app-mode="public"] .voice-waves span:nth-child(4) { animation-delay: 0.45s; }
body[data-app-mode="public"] .voice-waves span:nth-child(5) { animation-delay: 0.6s; }
@keyframes talk-eq { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }
```

`:has()` được hỗ trợ trên mọi trình duyệt mobile hiện hành (Safari ≥16.4, Chrome/Android ≥105) — phù hợp vì README ghi rõ mục tiêu là iPhone Safari + Android Chrome. Nếu muốn an toàn tuyệt đối không phụ thuộc `:has()`, phương án dự phòng: thêm 1 dòng trong `ui.js#setTalkState()` để đồng bộ `this.elements.talk.closest('.voice-control-row')?.dataset.state = state;` rồi style theo `[data-state="speaking"] .voice-waves`. Ưu tiên phương án CSS-only trước, chỉ dùng dự phòng nếu QA phát hiện thiết bị không hỗ trợ.

### 3.4 Tôn trọng chuyển động rút gọn

Thêm vào cuối `live.css` (đã có khối `@media (prefers-reduced-motion: reduce)` ở dòng 833 — bổ sung vào khối đó, không tạo khối mới):
```css
@media (prefers-reduced-motion: reduce) {
  .talk-button, .talk-recording, .talk-pressed, .talk-speaking { animation: none !important; }
  .talk-recording::before, .talk-recording::after,
  .talk-pressed::before, .talk-pressed::after { display: none !important; }
  body[data-app-mode="public"] .voice-waves span { animation: none !important; }
}
```

### 3.5 Nghiệm thu Phase 2

- Trạng thái `ready`: nút thở nhẹ liên tục, không giật.
- Trạng thái `pressed`/`recording`: hai vòng gợn sóng lan ra liên tục quanh nút.
- Trạng thái `speaking`: nút chuyển màu `--ember`, 5 vạch sóng bên trái/phải nút hiện ra và nhấp nháy lệch nhịp.
- Bật "Reduce Motion" trên hệ điều hành → toàn bộ animation trên tắt, nút vẫn đổi màu đúng theo state.
- `node --test src/tests/js/*.test.mjs` vẫn xanh (không file `.js` nào bị đổi ở phase này ngoại trừ phương án dự phòng ở 3.3).

---

## 4. Phase 3 — Hội thoại & avatar

**Mục tiêu:** áp dụng "hai giọng, hai sắc" cho bong bóng chat, và làm tin nhắn mới nhất xuất hiện có chuyển động (thay vì mọi tin nhắn cũ bị vẽ lại y hệt mỗi lần có lượt nói mới).

### 4.1 Ghi chú quan trọng về cách `render()` hoạt động

`src/web/ui.js` hàm `render()` (dòng 362–379) **thay toàn bộ `innerHTML`** của `#conversation` mỗi khi số lượt nói đổi (không phải mỗi khi có ký tự transcript mới — phần đó do `updateStreamingTurn()` xử lý riêng, không đụng DOM cha). Hệ quả: nếu chỉ thêm animation "xuất hiện" bằng CSS thuần trên `.turn` hoặc `.message-row`, animation sẽ **chạy lại trên toàn bộ lịch sử hội thoại** mỗi khi có lượt nói mới — gây hiệu ứng nhấp nháy toàn màn hình, không phải hiệu ứng mong muốn. Cần một thay đổi JS nhỏ để chỉ đánh dấu phần tử cuối cùng.

### 4.2 `src/web/ui.js` — sửa `render()` (dòng ~373–376)

```js
// trước
target.innerHTML = this.mode === 'public'
  ? this.turns.map(turn => publicTurnHtml(turn, key => this.t(key), pronunciationEnabled, conversationMode)).join('')
  : this.turns.slice().reverse().map(turn => devTurnHtml(turn, pronunciationEnabled)).join('');

// sau
target.innerHTML = this.mode === 'public'
  ? this.turns.map(turn => publicTurnHtml(turn, key => this.t(key), pronunciationEnabled, conversationMode)).join('')
  : this.turns.slice().reverse().map(turn => devTurnHtml(turn, pronunciationEnabled)).join('');
if (this.mode === 'public') {
  const last = target.lastElementChild;
  if (last) {
    last.classList.add('turn-enter');
    last.addEventListener('animationend', () => last.classList.remove('turn-enter'), {once: true});
  }
}
```

### 4.3 `src/web/public.css` — animation cho `.turn-enter`

Thêm mới (không có ở đâu khác trong repo hiện tại):
```css
body[data-app-mode="public"] .turn-enter { animation: turn-in 280ms ease-out both; }
@keyframes turn-in { from { opacity: 0; transform: translateY(10px); } }
@media (prefers-reduced-motion: reduce) {
  body[data-app-mode="public"] .turn-enter { animation: none; }
}
```

### 4.4 Hai giọng, hai sắc — bong bóng người dùng

`public.css` dòng ~15 (`--user-surface: #eaf1ff;`) và dòng ~40 (dark) đang hardcode một xanh dương riêng, tách khỏi `--primary`. Sửa để tint bong bóng luôn khớp với `--primary` mới thay vì một hex cố định:

```css
/* trước (light) */
--user-surface: #eaf1ff;
/* sau */
--user-surface: color-mix(in srgb, var(--primary) 14%, var(--surface));

/* trước (dark) */
--user-surface: #1d3154;
/* sau */
--user-surface: color-mix(in srgb, var(--primary) 22%, var(--surface));
```

Áp dụng tương tự cho hai khối token trong `live.css` (`--user-surface` ở dòng 14 và 45).

### 4.5 Avatar AI — quyết định thiết kế cần chốt

`live.css` dòng ~202–205 hiện có:
```css
.ai-avatar { background: linear-gradient(145deg, #7eb0ff, #4d8df4); color: #fff; }
```
Đây là gradient xanh dương hardcode, dùng ở **dev mode** (public mode đã override riêng ở `public.css` dòng 111–115 thành viền mảnh + icon màu `--primary`).

Quyết định: **không** đổi avatar AI sang `--ember`. Lý do: avatar là định danh cố định của AI trong suốt cuộc hội thoại, còn `--ember` được quy ước ở Phase 2 là tín hiệu tạm thời "AI đang nói ngay bây giờ". Gán cả hai cùng một màu sẽ làm mất phân biệt "đây là AI" và "AI đang nói". Chỉ cần đổi hex hardcode sang dùng biến để nhất quán với Phase 1:
```css
.ai-avatar { background: linear-gradient(145deg, color-mix(in srgb, var(--primary) 55%, white), var(--primary)); color: #fff; }
```

### 4.6 Nghiệm thu Phase 3

- Gửi một lượt nói mới → chỉ khối tin nhắn mới nhất trượt nhẹ lên khi xuất hiện, lịch sử phía trên đứng yên, không nhấp nháy lại.
- Bong bóng người dùng có sắc xanh ngọc nhạt thay vì xanh dương.
- `node --test src/tests/js/*.test.mjs` xanh — đặc biệt chú ý nếu `ui.test.mjs` có test đếm số lần gọi `render()`/kiểm tra `innerHTML`, đảm bảo đoạn thêm ở 4.2 không phá cấu trúc DOM mà test đang query.

---

## 5. Phase 4 — Coach & điểm số

**Mục tiêu:** khoảnh khắc chấm điểm sau mỗi lượt nói trở thành một vòng tiến trình vẽ dần + số điểm đếm lên, thay cho thanh 4px hiện tại.

### 5.1 `src/web/ui_render.js` — thêm hàm ring, sửa `coachOverviewHtml()`

Hàm hiện có `scoreBar()` (dòng 138–142) giữ nguyên (vẫn dùng cho 3 chỉ số phụ: phát âm/ngữ điệu/trôi chảy — xem nguyên tắc "một điểm sáng" ở Phase 1, không cần vẽ ring cho mọi chỉ số). Thêm hàm mới ngay dưới `scoreBar()`:

```js
function scoreRingSvg(value) {
  const normalized = scoreValue(value);
  if (normalized == null) return '';
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - normalized / 100);
  return `<svg class="score-ring" width="112" height="112" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-soft)" stroke-width="10"/>
    <circle class="score-ring-fg" cx="60" cy="60" r="${r}" fill="none" stroke="var(--primary)"
      stroke-width="10" stroke-linecap="round" transform="rotate(-90 60 60)"
      style="stroke-dasharray:${circumference};stroke-dashoffset:${offset}"/>
  </svg>`;
}
```

Sửa `coachOverviewHtml()` (dòng ~193–207), thay khối `score-hero` hiện tại:

```js
// trước
${overall == null ? '' : `<section class="score-hero">
  <div><span>${escapeHtml(t('score'))}</span><strong>${overall}<small>/100</small></strong></div>
  ${scoreBar(overall)}
</section>`}

// sau
${overall == null ? '' : `<section class="score-hero score-hero-ring">
  ${scoreRingSvg(overall)}
  <div class="score-hero-copy">
    <span>${escapeHtml(t('score'))}</span>
    <strong id="score-number" data-target="${overall}">0<small>/100</small></strong>
  </div>
</section>`}
```

Giữ nguyên `pronunciationMetrics()`, `problemCards()`, `naturalExpressionCard()` — không đổi.

### 5.2 `src/web/live.css` — style cho ring + animation vẽ dần

Thay style `.score-hero` hiện có (dòng ~451–464) bằng:
```css
.score-hero-ring { display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: var(--radius-md); background: var(--surface-soft); }
.score-ring-fg { animation: score-ring-grow 1.1s cubic-bezier(.22,.9,.3,1) both; }
@keyframes score-ring-grow { from { stroke-dashoffset: 326.7; } }
.score-hero-copy { display: flex; flex-direction: column; gap: 4px; }
.score-hero-copy span { color: var(--text); font-size: 13px; font-weight: 800; }
.score-hero-copy strong { color: var(--primary); font-family: var(--font-display, inherit); font-size: 34px; line-height: 1; }
.score-hero-copy strong small { margin-left: 4px; color: var(--text-muted); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .score-ring-fg { animation: none; } }
```
Ghi chú: `326.7` = `2 × π × 52`, khớp với bán kính `r=52` cố định trong `scoreRingSvg()`. Nếu sau này đổi bán kính, phải cập nhật hằng số này theo.

`public.css` dòng ~294–313 hiện override `.score-hero` cho chế độ public — cập nhật các selector đổi tên tương ứng (`.score-hero-ring`, `.score-hero-copy`) thay vì `.score-hero`/`.score-hero strong`, giữ nguyên phong cách "quiet" hiện có (không viền, không nền nếu đó là chủ đích ban đầu) nhưng vẫn giữ animation ring.

### 5.3 `src/web/ui_overlay.js` — đếm số điểm khi overlay mở

Trong `renderActive()` (dòng 207–231), sau dòng `this.dynamic.innerHTML = markup;` (dòng 220), chỉ chạy khi vừa render coach lần đầu:

```js
if (this.state.type === 'coach') this._animateScoreNumber();
```

Thêm method mới trong class (ví dụ ngay dưới `renderActive`):
```js
_animateScoreNumber() {
  const el = this.dynamic?.querySelector('#score-number');
  if (!el) return;
  const target = Number(el.dataset.target || 0);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !target) { el.firstChild.textContent = String(target); return; }
  const duration = 900;
  const start = performance.now();
  const step = now => {
    const p = Math.min(1, (now - start) / duration);
    el.firstChild.textContent = String(Math.round(target * p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
```
Lưu ý `el.firstChild` là text node `"0"` đứng trước `<small>/100</small>` trong markup ở 5.1 — chỉ đổi text node đó, không đụng `<small>`.

### 5.4 Nghiệm thu Phase 4

- Mở Coach sau một lượt nói → vòng tròn vẽ dần trong ~1.1s, số điểm chạy từ 0 lên điểm thật trong ~0.9s, cả hai kết thúc gần như đồng thời.
- Đóng rồi mở lại overlay Coach cho **cùng** lượt nói → animation chạy lại từ đầu (vì `renderActive` build lại markup và `_animateScoreNumber` được gọi lại) — chấp nhận được, đây không phải bug.
- Bật Reduce Motion → ring hiện đúng vị trí cuối cùng ngay lập tức, số điểm hiện thẳng giá trị cuối, không đếm.
- 3 chỉ số phụ (phát âm/ngữ điệu/trôi chảy) vẫn dùng thanh `scoreBar()` cũ, không đổi.

---

## 6. Phase 5 — Cài đặt: chấm màu ngôn ngữ

**Mục tiêu:** thêm tín hiệu màu cho ngôn ngữ đang luyện tập trong Settings, không thay `<select id="target-language">` bằng widget tuỳ biến (rủi ro cao, ảnh hưởng a11y và logic `elements.targetLanguage.addEventListener('change', ...)` trong `live.js` dòng 1165).

### 6.1 `src/web/live.html` — thêm chấm màu cạnh select (dòng ~80–85)

```html
<!-- trước -->
<div class="setting-control-row setting-control-row-primary">
  <label for="target-language" data-i18n="targetLanguage">Target language</label>
  <select id="target-language"></select>
</div>

<!-- sau -->
<div class="setting-control-row setting-control-row-primary">
  <label for="target-language" data-i18n="targetLanguage">
    <span id="target-language-dot" class="lang-dot" aria-hidden="true"></span>
    Target language
  </label>
  <select id="target-language"></select>
</div>
```

### 6.2 `src/web/live.js` — cập nhật chấm màu khi ngôn ngữ đổi

Thêm hàm nhỏ gần `setTargetLanguageChoices()` (dòng 162–177):
```js
function syncLanguageDot(value) {
  document.body.dataset.targetLanguage = value;
}
```
Gọi hàm này ở **hai chỗ** ngôn ngữ thực sự được set:
- Cuối `setTargetLanguageChoices()`, sau dòng `elements.targetLanguage.value = selectedValue;` → thêm `syncLanguageDot(selectedValue);`
- Trong listener `change` (dòng ~1165–1168), sau `elements.targetLanguage.value = target;` → thêm `syncLanguageDot(target);`

Đây là cách làm giống hệt `document.body.dataset.theme`/`dataset.appMode` đã có sẵn trong `ui.js` — không tạo pattern mới.

### 6.3 `src/web/public.css` — style chấm màu theo `data-target-language`

```css
.lang-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: middle; background: var(--primary); }
body[data-target-language="ja"] .lang-dot { background: var(--sakura); }
body[data-target-language="zh-Hans"] .lang-dot { background: var(--gold); }
```
Giá trị `"en"`, `"ja"`, `"zh-Hans"` khớp đúng key của `TARGET_LANGUAGE_METADATA` trong `language_policy.js` — không cần map lại.

### 6.4 Nghiệm thu Phase 5

- Mở Settings, đổi ngôn ngữ luyện tập → chấm màu cạnh nhãn "Target language" đổi tương ứng (teal/sakura/gold).
- Không có thay đổi hành vi nào khác của `<select>` — vẫn native, vẫn accessible, vẫn kích hoạt đúng luồng reconnect Live session như cũ.
- `PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"` xanh (phase này không đụng backend, chỉ để chắc chắn không có test nào assert nội dung `live.html`).

---

## 7. Phase 6 — Rà soát cuối

Danh sách kiểm tra thủ công trước khi merge:

- [ ] Chạy cả hai bộ test (`unittest`, `node --test`) — xanh hoàn toàn.
- [ ] Bật `prefers-reduced-motion: reduce` ở cấp hệ điều hành, đi qua toàn bộ luồng: chờ → nói → AI trả lời → xem điểm — không có animation nào còn chạy, nhưng trạng thái cuối cùng vẫn đúng.
- [ ] Kiểm tra `data-theme="dark"` và `light` — độ tương phản chữ/nền, độ rõ của glow (glow trong theme sáng cần nhạt hơn theme tối để không bị gắt).
- [ ] Test trên Android tầm trung thật (không chỉ Chrome desktop responsive mode) — theo dõi xem animation "thở" liên tục của nút Talk có gây giật khung hình hoặc hao pin bất thường khi một phiên nói kéo dài nhiều phút hay không, vì `README.md` nêu rõ mục tiêu "mobile reliability, low latency, low operational cost".
- [ ] Test chế độ Hands-free (`data-conversation-mode="hands_free"`) — animation `talk-speaking`/`talk-recording` vẫn hợp lý khi không cần giữ tay.
- [ ] Kiểm tra `--mode dev` (giao diện kỹ sư) không bị ảnh hưởng ngoài ý muốn — `body[data-app-mode="dev"]` đã override riêng phần lớn, nhưng cần xác nhận keyframes mới ở Phase 2–4 không vô tình áp cho dev mode nếu chưa được scope đúng theo `body[data-app-mode="public"]`.
- [ ] Deploy thử ở `--mode public` cục bộ trước khi đẩy lên VPS qua flow cập nhật 5 giây mô tả trong README.

---

## 8. Tổng hợp lệnh chạy nhanh cho từng phase

```bash
# Sau mỗi phase
PYTHONPATH=src python -m unittest discover -s src/tests/python -p "test_*.py"
node --test src/tests/js/*.test.mjs

# Xem trực quan (mobile UI thật)
python src/app.py --mode public
# rồi mở http://127.0.0.1:7860 trên trình duyệt điện thoại cùng mạng, hoặc dùng
# src/scripts/run.bat (Windows) để có HTTPS tunnel test trên điện thoại
```
