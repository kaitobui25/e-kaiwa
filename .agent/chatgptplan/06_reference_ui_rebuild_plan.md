# Plan 06 — Reference UI Rebuild

Status: **draft / planning only**. Chưa sửa production UI trong plan này.

Reference chính:
- `.agent/assets/01_ui.png`
- ảnh gồm 8 trạng thái/màn hình mobile-first: welcome, conversation, Coach overview, natural-expression detail, word pronunciation practice, user voice replay, settings, session result.

## 1. Mục tiêu

Build public UI của E-KAIWA theo visual direction của `01_ui.png`, nhưng giữ architecture hiện tại nhẹ, dễ bảo trì và không làm ảnh hưởng realtime/audio flow đã ổn định sau Plan 05.

Yêu cầu chính:
- mobile-first, ưu tiên iPhone Safari / Android Chrome;
- visual gần ảnh: trắng + navy + blue accent, green cho score/success, card bo tròn, spacing thoáng, typography rõ hierarchy;
- header, conversation, Coach, settings và bottom mic có bố cục nhất quán;
- giữ rule Talk hiện tại:
  - Talk OFF: push-to-talk, user có replay voice;
  - Talk ON: hands-free, không hiện manual replay/TTS trong conversation;
- score gắn trực tiếp với user turn;
- Coach mở theo nhu cầu, không spam nhiều card trên conversation;
- không đổi Gemini protocol, session/token/backend trừ khi UI thực sự cần thêm dữ liệu;
- code clean, modular vừa đủ, không framework migration.

## 2. Nguyên tắc tránh overengineering

Không làm trong Plan 06:
- không React/Vue/Svelte;
- không SPA router framework;
- không design-system package;
- không animation library;
- không icon library nặng;
- không state-management framework;
- không screenshot-diff CI phức tạp;
- không rewrite `live.js` chỉ để phục vụ giao diện;
- không build 8 màn hình thành 8 page độc lập nếu cùng một state/overlay có thể tái sử dụng.

Giữ plain HTML + CSS + ES modules.

Chỉ tách module khi responsibility đã rõ và có giá trị bảo trì thực tế.

## 3. Mapping ảnh reference → phạm vi thực tế

### Phase 06A — core UI, nên làm trước

#### A. Conversation screen
Tương ứng màn hình thứ 2 trong ảnh.

Bao gồm:
- sticky header `E-KAIWA`;
- settings icon bên phải;
- AI bubble bên trái;
- learner bubble bên phải;
- avatar/icon dạng vector thay cho text `AI` / `YOU` thô hiện tại;
- timestamp chỉ thêm nếu dữ liệu/UI cần, không bắt buộc cho V1;
- user replay icon inline sau câu nói trong push-to-talk;
- Coach score inline ngay sau replay icon;
- bottom mic dock giống ảnh: mic chính giữa, trạng thái rõ, safe-area chuẩn;
- footer nhỏ cho App Language và playback speed nếu không làm giao diện rối.

#### B. Coach overview
Tương ứng màn hình thứ 3.

Mở từ score của user turn.

Bao gồm:
- tổng score;
- pronunciation sub-scores nếu backend đã có dữ liệu;
- problem word;
- correction / natural expression;
- concise explanation;
- close button;
- tap/click ngoài panel hoặc Escape → đóng.

Rule quan trọng:
- chỉ render field có dữ liệu thật;
- không tạo tab `Grammar` / `Expression` giả nếu Coach response hiện tại chưa có dữ liệu riêng cho các tab đó.

#### C. Natural expression detail
Tương ứng màn hình thứ 4.

Có thể là state bên trong Coach overlay, không cần page mới.

Hiển thị:
- câu user nói;
- câu tự nhiên hơn;
- short explanation;
- speaker action chỉ ở mode cho phép manual audio;
- back/close đơn giản.

#### D. Problem word pronunciation detail
Tương ứng màn hình thứ 5.

Mở khi click problem word trong Coach.

Hiển thị:
- word;
- phonetic/sound;
- tip;
- play normal / slow nếu audio layer hỗ trợ sạch;
- nếu chưa có slow playback chuẩn thì giữ một nút play, không fake feature.

#### E. User voice replay
Tương ứng màn hình thứ 6.

Không cần page riêng.

Dùng chung overlay shell:
- transcript;
- simple waveform/progress visual nếu có thể lấy từ PCM local mà không tăng dependency;
- play/pause;
- duration;
- không gửi audio thêm lên server chỉ để render waveform.

#### F. Settings
Tương ứng màn hình thứ 7.

Giữ setting hiện có:
- App Language;
- Theme;
- Talk switch;
- AI playback rate;
- Pronunciation Coach;

Dev-only config/model controls vẫn không xuất hiện trong public mode.

### Phase 06B — làm sau core nếu thực sự cần

#### Welcome / landing screen
Tương ứng màn hình thứ 1.

Chỉ làm khi muốn có product entry flow trước conversation.

Không cần cho beta kỹ thuật hiện tại.

#### Session result screen
Tương ứng màn hình thứ 8.

Chỉ làm khi product đã quyết định rõ:
- session bắt đầu/kết thúc khi nào;
- conversation duration tính ra sao;
- số turns nào được tính;
- overall session score lấy theo rule nào.

Không tự invent metric chỉ để giống mockup.

## 4. UI architecture đề xuất

Current frontend vẫn giữ một app core. Không fork public/dev thành hai application.

Đề xuất refactor vừa đủ:

```text
src/web/
  live.js               # realtime/session orchestration; hạn chế đụng trong Plan 06
  audio.js              # giữ audio ownership hiện tại
  preferences.js        # giữ preferences/mode ownership
  language_policy.js

  ui.js                 # UiController facade + event wiring cấp cao
  ui_render.js          # pure render functions: conversation/turn/score
  ui_overlay.js         # Coach/correction/word/replay/settings overlay state + close rules
  ui_icons.js           # small inline SVG helpers hoặc SVG symbol map

  live.html             # app shell + one shared overlay root
  live.css              # semantic tokens + public/dev sections
```

Không tách nhỏ hơn ngay từ đầu.

Nếu sau implementation `ui_render.js` hoặc `ui_overlay.js` vượt quá mức dễ đọc thì mới split tiếp thành:

```text
ui/
  turn_view.js
  coach_view.js
  replay_view.js
```

Không tạo folder tree lớn trước khi có nhu cầu.

## 5. State model UI

UI overlay chỉ cần một state đơn giản:

```text
activeOverlay:
  null
  coach
  correction
  word
  replay
  settings

selectedTurnNo
selectedProblemIndex
```

Rules:
- một thời điểm chỉ có một overlay;
- mở overlay mới → đóng overlay cũ;
- tap outside → đóng;
- Escape → đóng;
- close button → đóng;
- overlay state không được bật/tắt microphone;
- audio playback vẫn đi qua Audio/PlaybackCoordinator hiện tại.

Không tạo global event bus.

## 6. Conversation layout

Target layout gần reference:

```text
┌──────────────────────────────┐
│ E-KAIWA                    ⚙ │
├──────────────────────────────┤
│ ◯ AI                         │
│   How was your weekend?   🔊 │
│                              │
│                   You ◯      │
│      I went to Kyoto... 🔊 82│
│                              │
│ ◯ AI                         │
│   That sounds great!         │
│                              │
│          waveform-ish        │
│             🎙               │
│          Hold to talk        │
└──────────────────────────────┘
```

Important:
- user text + replay + score là cùng một visual unit;
- replay icon + score luôn theo sau phần cuối câu, không thành dòng action riêng;
- Talk ON ẩn replay icon nhưng giữ score;
- problem-word underline/highlight giữ semantic yellow/red hiện tại;
- AI playback icon chỉ hiện nếu audio replay cho AI thực sự có behavior rõ; không thêm icon chết.

## 7. Visual tokens

Không hardcode màu rải rác.

Dùng semantic CSS variables:

```css
--bg
--surface
--surface-soft
--text
--text-muted
--border
--primary
--primary-soft
--success
--warning
--danger
--shadow-sm
--shadow-md
--radius-sm
--radius-md
--radius-lg
```

Light/Dark chỉ đổi token values.

Reference direction:
- navy text;
- blue primary;
- pale blue AI surfaces;
- pale green learner / success surfaces;
- green score;
- yellow attention;
- red chỉ dành cho error/severe pronunciation problem.

Không dùng quá nhiều gradient/glass/blur.

## 8. Icon strategy

Bỏ phụ thuộc vào emoji cho icon quan trọng vì emoji render khác nhau giữa Windows/iOS/Android.

Dùng một bộ inline SVG nhỏ tự quản lý:
- gear;
- mic;
- speaker;
- play;
- close;
- globe;
- check/star;
- user/AI avatar icon.

Không import Font Awesome/Lucide package chỉ vì vài icon.

Ưu tiên SVG `currentColor` để theme tự hoạt động.

## 9. Coach design

Coach không render toàn bộ nội dung dưới mỗi turn.

Collapsed state trong conversation chỉ là score.

Expanded overlay:

```text
Pronunciation / Expression Feedback      ×

Overall                           82 / 100
────────────────────────────────────────

Pronunciation
Accuracy                           80
Fluency                            85
Intonation                         82

Problem word
really
/'rɪəli/
short tip...

Natural expression
corrected sentence...
```

Nếu backend chỉ có overall + problems + correction/explanation thì UI chỉ hiển thị đúng các field đó.

Không map fabricated score từ dữ liệu không tồn tại.

## 10. Responsive / mobile rules

Primary design width:
- 375–430 px.

Phải usable từ:
- 320 px mobile;
- tablet;
- desktop với content max-width hiện tại.

Bắt buộc:
- `env(safe-area-inset-top/bottom)`;
- sticky header;
- fixed bottom controls;
- conversation có bottom padding đủ để last turn không bị mic che;
- overlay scroll độc lập nếu nội dung dài;
- minimum tap target ~44px cho icon chính;
- không hover-only interaction.

## 11. Performance

Mục tiêu là nhanh trên VPS 1 GB và mobile browser.

Rule:
- zero new runtime dependency nếu có thể;
- không external web font;
- không image background lớn;
- không animation loop liên tục;
- chỉ animate `opacity/transform` 120–200 ms;
- waveform nếu làm thì CSS/canvas nhẹ, không chart library;
- dùng SVG nhỏ thay PNG icon;
- không rerender conversation vì animation/status nhỏ nếu tránh được;
- realtime/audio path không đi qua thêm abstraction chỉ để phục vụ UI.

Current full turn render có thể giữ cho MVP nếu session size nhỏ.
Chỉ tối ưu incremental DOM patching nếu profiling cho thấy vấn đề thực tế.

## 12. Maintainability rules

- `live.js` không chứa HTML template mới của Plan 06.
- UI render functions không gọi Gemini/network trực tiếp.
- overlay code không sở hữu mic state.
- audio action vẫn dispatch intent về existing audio layer.
- CSS component selectors ngắn, semantic; tránh selector phụ thuộc DOM nesting sâu.
- không duplicate public light/dark component rules.
- strings learner-facing tiếp tục qua current i18n/COPY mechanism; không hardcode Japanese vào template mới.
- dev mode phải giữ usable sau refactor.

## 13. Testing strategy

Giữ test lightweight.

### JS unit/regression
- AI/user alignment semantics;
- push-to-talk user turn có inline replay + score;
- hands-free user turn không có replay nhưng vẫn có score;
- score click mở Coach state;
- click problem word mở word detail;
- click replay mở user-audio detail;
- tap outside đóng Coach/overlay;
- chỉ một overlay open;
- no manual speaker action trong hands-free.

### Python/static regression
- public/dev controls vẫn phân tách;
- required static assets tồn tại;
- semantic CSS tokens tồn tại;
- public mode không expose dev model controls.

### Manual mobile checklist
- iPhone Safari;
- Android Chrome;
- portrait 320/375/390/430 widths;
- light/dark;
- Talk OFF / Talk ON;
- long 3–5 line learner sentence;
- long Coach explanation;
- keyboard/scroll/safe-area;
- repeated open/close overlay;
- replay while conversation inactive/active according to mode rules.

Không thêm visual snapshot infrastructure ở phase này.

## 14. Implementation sequence

### Step 1 — UI shell + tokens
- chỉnh visual tokens;
- header;
- conversation spacing;
- bottom dock;
- SVG icon helpers.

Không đổi Coach structure ở bước này.

### Step 2 — turn renderer
- avatar mới;
- bubble style theo reference;
- inline replay + score;
- AI/user visual hierarchy;
- long text wrapping.

### Step 3 — shared overlay shell
- one overlay root;
- outside-click/Escape/close;
- focus/scroll behavior;
- mobile full-height / desktop centered card.

### Step 4 — Coach states
- overview;
- correction detail;
- problem word detail.

### Step 5 — replay + settings
- user voice replay screen/panel;
- settings visual rebuild;
- giữ existing preference behavior.

### Step 6 — cleanup
- remove CSS/UI paths cũ không dùng;
- ensure no duplicate event listeners;
- update tests;
- run full CI;
- manual mobile test.

### Step 7 — optional Phase 06B
- welcome screen;
- session result screen;
- chỉ làm sau khi product flow/metrics được chốt.

## 15. Acceptance criteria

Plan 06 core được coi là đạt khi:

1. Conversation screen nhìn cùng design language với `01_ui.png`, không còn cảm giác dev UI.
2. AI trái / user phải rõ ràng trên mobile.
3. User sentence + replay + score là một visual unit.
4. Talk OFF/ON giữ đúng behavior Plan 05.
5. Coach score mở một overlay sạch, có correction/problem details.
6. Tap ngoài Coach → tự đóng.
7. Settings có visual/layout nhất quán với reference.
8. Bottom mic không che last message trên mọi mobile size test.
9. Light/Dark vẫn chạy qua semantic tokens.
10. Không regression realtime, token, Coach API, audio playback hoặc mic gating.
11. CI xanh.
12. Không thêm frontend framework hoặc dependency nặng.

## 16. Kết luận kiến trúc

Không rewrite app.

Plan 06 chỉ làm một **presentation-layer refactor có kiểm soát**:

```text
Realtime / Audio / Session
        │
        │ intents + turn state
        ▼
   UiController
     ├─ turn renderer
     ├─ overlay controller
     └─ SVG/icon helpers
        │
        ▼
   mobile-first public UI
```

Giữ backend và realtime core ổn định, tập trung thay đúng phần cần thay: render, overlay state, icons và CSS visual system.

Đây là mức module hóa đủ cho E-KAIWA hiện tại: dễ bảo trì/nâng cấp nhưng không biến một frontend nhỏ thành architecture enterprise.