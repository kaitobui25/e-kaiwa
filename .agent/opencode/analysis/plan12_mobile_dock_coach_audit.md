# Plan 12 — Mobile Conversation + Coach UI: audit chi tiết điểm cần fix

Ngày: 2026-09-18
Plan gốc: `.agent/chatgptplan/12_mobile_conversation_coach_ui_plan.md`
Phạm vi rà: `src/web/live.html`, `src/web/live.css`, `src/web/public.css`,
`src/web/ui.js`, `src/web/ui_render.js`, `src/web/ui_overlay.js`,
`src/web/live.js`, `src/web/replay_policy.js`, `src/web/preferences.js`
Trạng thái worker OpenCode trước đó: timeout, `git diff` trống — chưa sửa file nào.

## Tóm tắt

- Bug xác nhận (cần fix): **§2** (khoảng hở conversation–dock), **§4** (cụm dock-meta lệch).
- Nit nhỏ nên gộp chung: **§5** (`message-actions` 52px làm bubble dày), **§1** (talk label kẹt ngôn ngữ cũ sau khi đổi UI language).
- Khớp plan, không cần sửa: **§3, §6, §7, §8, §9** (chi tiết + bằng chứng bên dưới).

---

## §1. Talk dock cleanup — OK, 1 gợn nhỏ

Plan: hiện instruction push-to-talk đúng 1 lần dưới mic, giữ các state tạm
(connecting / waiting / speaking / reconnect / error), không trùng idle text.

Hiện trạng (đúng):
- `src/web/ui.js:313-321` (`_renderStatus`): ẩn `status` khi `lastStatus === currentTalkLabel`
  ở public mode, không phải error.
- `src/web/public.css:349`: `.status:empty { display: none; }` — không chiếm chỗ khi ẩn.
- `src/web/ui.js:371-375`: mỗi `setTalkState` cập nhật `currentTalkLabel` + render lại status.
- `src/web/live.html:36,44`: 1 `#status` trên mic + 1 `#talk-label` dưới mic — đúng 1 vị trí mỗi loại.

Gợn nhỏ (nit, nên fix):
- `UiController.setLanguage` (`ui.js:278-292`) render lại `status` bằng `lastStatus` cũ
  nhưng **không dịch lại `talkLabel`/`currentTalkLabel`** cho tới lần `setTalkState` kế tiếp.
  Kịch bản: đang ở `ready` ("Chạm và giữ để nói") → đổi UI VI→JA → label vẫn tiếng Việt
  trong khi UI còn lại đã tiếng Nhật (không trùng, nhưng sai ngôn ngữ).
- Fix gợi ý: trong `setLanguage`, sau khi đổi `this.language`, suy lại `currentTalkLabel`
  theo state hiện tại của talk button (hoặc gọi lại phần tính label của `setTalkState`)
  rồi render cả `talkLabel` + `status`.

## §2. Giảm khoảng hở conversation–dock — BUG, cần fix

Plan: thu hẹp nhẹ khoảng cách giữa conversation card và dock cố định, giữ safe-area,
không overlap iPhone, không làm conversation chật, chỉ tune spacing/reserve hiện có.

Hiện trạng (chưa đạt):
- `src/web/public.css:36`: `--control-dock-safe-area: 176px`
  (mobile ≤380px: `170px` ở `public.css:952`).
- `src/web/public.css:75`: `.app-shell` padding-bottom ăn theo biến này
  cộng `env(safe-area-inset-bottom)`.
- Dock thật (mic 70px — 64px ở ≤380px — + talk-label + dock-meta + padding
  `public.css:296`) chỉ cao khoảng **140–150px** → reserve dư ~25px thành khoảng hở lộ rõ.
- Trước đó đã hạ 200px → 176px nhưng vẫn chưa đủ; `min-height: 61dvh` của
  conversation-card (`public.css:100`) còn làm cảm giác hở rõ hơn.

Fix gợi ý (chỉ `public.css`, không đụng layout mới):
- Hạ `--control-dock-safe-area` về khoảng **150–160px**, bản ≤380px về **144–152px**.
- Giữ nguyên công thức `padding-bottom: calc(var(--control-dock-safe-area) + env(...))`
  và `scroll-margin-bottom` của `.turn` để không overlap iPhone.
- Không sửa `live.css` (fallback dev) — chỉ chạm biến trong `public.css`.

## §3. Dock language hiện ngôn ngữ đang học — OK

Plan: `quick-language` hiện target language (`en`→English, `ja`→日本語,
`zh-Hans`→中文), tách khỏi feedback/UI language, reuse state hiện có.

Hiện trạng (đúng):
- `src/web/ui.js:147-156`: `TARGET_LANGUAGE_LABELS` + `targetLanguageLabel()`.
- `src/web/ui.js:294-299`: `setTargetLanguage()` render vào `#quick-language`.
- `src/web/live.js:363` (init) và `src/web/live.js:1257-1260` (đổi target) đều gọi
  `setTargetLanguage` + `syncLanguageDot`.
- `setLanguage` không còn đụng `quickLanguage` — đúng tách biệt.
- `src/web/live.js:163-164`: `syncLanguageDot` set `document.body.dataset.targetLanguage`
  nên accent JA/ZH trong `public.css:40-41,70-71` vẫn ăn.
- HTML mặc định `live.html:48` là `English`, khớp default `TARGET_LANGUAGE`.

Không cần sửa.

## §4. Center dock metadata thành 1 cụm — BUG, cần fix

Plan: language + speed (vd `English 0.8×`) nằm cùng 1 hàng, centered thành 1 cụm
dưới mic, style phụ lặng, đủ thoáng nhưng không giạt 2 bên.

Hiện trạng (sai):
- `src/web/public.css:420-429`: `.dock-meta { width:100%; justify-content:center; gap:0; }`.
- `src/web/public.css:435-439`: separator `·` là `::before` của item thứ 2,
  chỉ có `margin-right: 18px`, **không có khoảng trái** → `·` dính sát `English`,
  `0.8×` bị đẩy xa → cụm lệch, không centered đối xứng.
- Base `src/web/live.css:429-441`: `gap: 56px` (≤380px còn `38px` ở `live.css:917`)
  — nếu override public mất hiệu lực sẽ giạt 2 bên, sai plan.
- Icon đã `display:none` ở public (`public.css:431-433`) — đúng, giữ nguyên.

Fix gợi ý (chỉ CSS):
- `.dock-meta`: giữ `justify-content: center`, dùng `gap: 10-12px`, **không**
  `space-between`.
- Separator có khoảng **đối xứng 2 bên** (gap container hoặc margin cả trái lẫn phải),
  không chỉ `margin-right`.
- Giữ icon ẩn ở public mode, giữ style phụ hiện tại
  (`font-size:12px`, `font-weight:500`, `text-muted`).

## §5. Bỏ nút replay/mic trong bubble user — OK chức năng, 1 nit spacing

Plan: bubble user chỉ còn score ring/badge (bấm mở Coach), không còn replay riêng.

Hiện trạng (đúng chức năng):
- `src/web/ui_render.js:96-102`: `publicTurnHtml` chỉ render `inlineScore`,
  `inlineReplay` đã xóa; `actionRow` rỗng khi không có score.
- Markup xác nhận: không còn `data-ui-action="open-replay"` trong conversation.

Nit spacing (nên gộp vào fix §2/§4):
- `src/web/public.css:212-219`: `.message-actions { min-height: 52px; margin: 6px -2px -2px 0; }`
  giữ hàng 52px cho pill 48px (`public.css:232-244`) → bubble dày hơn cần thiết.
- Gợi ý: hạ về ~48px hoặc `auto`, kiểm tra 320–430px.
- Code chết vô hại: `_applyReplayAvailability` (`ui.js:242-255`) + nhánh `open-replay`
  (`ui.js:218`, `ui_overlay.js:214-217`) + style `.inline-action` còn sót — không cần xóa gấp.

## §6. Coach pronunciation thành disclosure — OK

Plan: mặc định ẩn metric, bấm score hero/ring toggle `Chi tiết phát âm`,
hiện Accuracy/Fluency/Intonation ngay dưới score, có `aria-expanded`, focus/keyboard.

Hiện trạng (đúng):
- `src/web/ui_render.js:176-188`: `pronunciationMetrics` render
  `#coach-pronunciation-details` với `hidden` khi chưa expand.
- `src/web/ui_render.js:247-254`: score hero là `<button>` với
  `aria-expanded` + `aria-controls="coach-pronunciation-details"`.
- `src/web/ui_overlay.js:149-150,158-163`: toggle đúng 1 chỗ, set `aria-expanded`,
  ẩn/hiện `#coach-pronunciation-details`.
- `openCoach(..., {resetMetrics})`: mở mới reset, `back-coach` giữ trạng thái — đúng.
- `public.css:625-647`: chevron xoay khi expand, details `margin-top:12px` — đúng.
- Toggle sửa DOM trực tiếp nhưng lần `refresh` → `renderActive` sau sẽ tái khớp markup
  theo `metricsExpanded` nên không lệch state.

Không cần sửa.

## §7. Learner replay ngay dưới score — OK

Plan: 1 control gọn dưới score, reuse PCM hiện có, play/stop, vòng progress theo
duration, reset khi xong/stop, ẩn/disable khi không có data hoặc bị block.

Hiện trạng (đúng):
- `src/web/ui_render.js:205-222`: `learnerReplayCard` ngay sau metrics, có
  `data-audio-action="replay-user"`, vòng progress `pathLength=100`,
  `stroke-dashoffset:100` ban đầu, hiện duration qua `replayDuration()`.
- `src/web/ui_overlay.js:279-290`: `setReplayProgress` cập nhật ring + `aria-pressed`,
  đúng turn mới nhận.
- `src/web/live.js:1169-1193,1207-1219`: `startReplayProgress`/`resetReplayProgress`,
  bấm khi đang phát thì stop + reset, `finally` reset sau await.
- Ẩn đúng: `hasPlayableReplay` (`replay_policy.js:3-6`, ngưỡng 800 samples Int16Array)
  + `audioActionsAllowed = replayEnabled && !handsFree` (`ui.js:201`).

Nit (không cần fix ngay):
- Sample rate hardcode `16000` ở `live.js:1181,1213` + default `replayDuration`
  (`ui_render.js:312`) — nhất quán hiện tại, chỉ lệch nếu sau đổi rate ghi âm.
- Progress theo wall-clock + cờ `manualPlaying`, không theo audio clock thật —
  có thể lệch chút khi audio giật; chấp nhận được.

## §8. Natural expression + playback cùng hàng — OK

Plan: `Cách nói tự nhiên hơn` dưới learner replay, câu + nút phát cùng hàng,
dùng correction speech action, bấm hàng vẫn mở detail.

Hiện trạng (đúng):
- `src/web/ui_render.js:224-240`: `natural-row` gồm `natural-main` (mở correction)
  + `.natural-audio` (`data-audio-action="speak-correction"`), đúng thứ tự sau replay.
- `src/web/live.js:1220-1224`: `speak-correction` dùng `coach.correction || userText` — đúng.
- CSS `public.css:713-749`: flex cùng hàng, nút 42px `primary-soft` — đúng.

Nit: selector chết `.natural-card:active` (`public.css:275`, class cũ) — vô hại vì
`.natural-main:active` đã có ở `public.css:759`.

## §9. Problem words dưới Natural Expression — OK

Plan: thứ tự Header → score → details (ẩn) → replay → natural → problem words → note.

Hiện trạng (`coachOverviewHtml`, `ui_render.js:242-261`): đúng thứ tự
score → `pronunciationMetrics` → `learnerReplayCard` → `naturalExpressionCard` →
`problemCards` → summary. Drill (`open-word`) không đổi.

Không cần sửa.

---

## Danh sách fix đề xuất (gộp 1 lần)

1. `public.css` §4: `.dock-meta` centered 1 cụm, separator đối xứng, `gap:10-12px`,
   không `space-between`, giữ icon ẩn.
2. `public.css` §2: hạ `--control-dock-safe-area` 176→~150-160 (mobile 170→~144-152),
   giữ công thức padding + scroll-margin.
3. `public.css` §5 (nit): `.message-actions` `min-height:52px` → ~48px/`auto`.
4. `ui.js` §1 (nit): `setLanguage` dịch lại `talkLabel`/`currentTalkLabel` theo state hiện tại.

## Checklist verify sau fix (từ plan)

- Mobile 320/375/390/430px, safe-area iPhone, light/dark, UI VI/JA, target EN/JA/ZH.
- Push-to-talk ready/pressed/waiting/speaking, không trùng instruction, đổi UI language
  label vẫn đúng.
- Dock: `English 0.8×` centered 1 cụm; conversation–dock khít nhưng không overlap.
- Bubble user chỉ có score; Coach đúng thứ tự; metrics ẩn mặc định, bấm score toggle;
  replay chạy/progress/reset; natural phát đúng; problem-word navigation còn chạy.
- Test: JS tests UI/render/overlay/audio liên quan + smoke Python nếu chạm behavior chung.
