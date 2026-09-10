# 08 — Multilingual Language Profile Plan

## Mục tiêu

Mở rộng E-KAIWA từ English-only sang hỗ trợ học thêm:

- English (`en`)
- Japanese (`ja`)
- Mandarin Chinese Simplified (`zh-Hans`)

Theo kiến trúc **một engine chung + Language Profile**, ưu tiên:

- clean code
- module hóa vừa đủ
- dễ bảo trì, nâng cấp
- không duplicate realtime/audio/coach flow
- không tăng service/process không cần thiết
- tối ưu cho VPS nhỏ (~1 GB RAM)
- giữ English hiện tại ổn định trong quá trình refactor

Đây là plan sơ bộ. Chưa sửa production code trong task này.

---

## Quyết định kiến trúc

Chọn phương án:

```text
Generic E-KAIWA Engine
        +
Language Profile / Registry
```

Không tạo ba app riêng:

```text
English app
Japanese app
Chinese app
```

Không tạo ba realtime service, ba CoachService hoặc ba audio pipeline.

Các phần sau tiếp tục dùng chung:

```text
Browser microphone
PCM/downsample
Gemini Live WebSocket
VAD / push-to-talk / hands-free
Playback
Session / metrics
UI shell
Maintenance / updater
Model policy
Coach request/fallback infrastructure
```

Chỉ những behavior thực sự phụ thuộc ngôn ngữ mới đi qua Language Profile.

---

## Khái niệm phải tách rõ

### 1. App/support language

Ngôn ngữ dùng để:

- hiển thị UI
- giải thích correction
- rescue learner khi không hiểu

Hiện tại chủ yếu:

```text
ja
vi
```

### 2. Target language

Ngôn ngữ learner đang học:

```text
en
ja
zh-Hans
```

Hai khái niệm này độc lập.

Ví dụ hợp lệ:

```text
support_language = vi
target_language  = ja
```

hoặc:

```text
support_language = ja
target_language  = zh-Hans
```

Không được dùng `support_language` thay cho `target_language`.

---

## Kiến trúc dự kiến

### Backend

Thêm một module registry/profile nhẹ, ví dụ:

```text
src/e_kaiwa/languages.py
```

Responsibility:

- canonical target language codes
- display name
- speech locale
- transcription/detection aliases
- conversation instruction metadata
- correction instruction metadata
- pronunciation rubric metadata
- normalization helper

Concept dự kiến:

```text
LanguageProfile
  code
  name
  speech_locale
  detection_codes / aliases
  conversation_instruction
  correction_instruction
  pronunciation_instruction
```

Không để `if target == ...` rải rác qua nhiều module nếu có thể resolve một lần qua registry.

### Frontend

`PreferencesStore` quản lý target language của từng browser/user bằng localStorage.

Dự kiến thêm:

```text
e-kaiwa.target-language
```

Public user đổi target language không làm thay đổi global server settings của user khác.

Frontend chỉ giữ code cần cho UX/runtime; canonical semantic/profile rules ưu tiên nằm ở module rõ responsibility, tránh duplicate constants không cần thiết.

---

## Các điểm hiện tại cần refactor

### 1. `src/web/preferences.js`

Hiện target language bị cố định là English.

Refactor thành preference thực sự với allowed targets:

```text
en
ja
zh-Hans
```

Target speech locale cũng phải resolve theo target language thay vì luôn `en-US`.

### 2. `src/web/language_policy.js`

Hiện policy là `english-first-rescue`.

Refactor concept từ:

```text
English input -> coach eligible
non-English -> rescue / skip coach
```

sang:

```text
input matches target language -> coach eligible
input does not match target -> rescue / skip coach
```

Conversation instruction nhận cả:

```text
target_language
support_language
```

### 3. `src/web/live.js`

Không đổi transport architecture.

Chỉ truyền target language vào:

- session/live instruction
- turn metadata
- target-language eligibility logic
- correction/replay speech locale
- metrics

Khi target language đổi:

```text
save local preference
-> finish/close current Live session safely
-> create new Live session
-> send new target-language system instruction
```

Không restart backend.

### 4. `src/e_kaiwa/coach.py`

Hiện prompt hard-code English coach / English pronunciation.

Refactor `correction()` và `pronunciation()` để nhận `LanguageProfile` hoặc target-language-derived instruction.

Giữ nguyên generic execution infrastructure:

```text
_structured_request
model fallback
API key rotation
ThreadPoolExecutor(max_workers=2)
JSON response structure
```

Không tạo `JapaneseCoachService` / `ChineseCoachService` ở giai đoạn này.

### 5. settings / API payload

Public target language là per-user preference, không nên biến thành một global production setting duy nhất.

Backend request cần nhận/validate target language ở nơi cần thiết, ví dụ Coach payload/session metadata.

Dev mode có thể có default target language nếu cần cho testing, nhưng phải tránh làm nó trở thành source of truth cho mọi public user.

---

## Language-specific profile sơ bộ

### English

Giữ behavior hiện tại gần như 100% sau refactor.

Pronunciation focus hiện tại tiếp tục gồm:

- vowels / consonants
- word stress
- linking
- rhythm / fluency
- intonation

English là regression baseline trước khi thêm language mới.

### Japanese

Conversation target:

```text
Japanese
```

Pronunciation rubric sơ bộ:

- mora timing
- short / long vowels
- gemination (`っ`)
- moraic nasal (`ん`)
- clearly audible consonant/vowel issues
- rhythm / fluency
- pitch accent chỉ khi model có đủ tín hiệu và lỗi nghe rõ; không invent lỗi

Correction tập trung vào natural Japanese, grammar, particles, word choice và learner-appropriate phrasing.

### Mandarin Chinese Simplified

Canonical target dự kiến:

```text
zh-Hans
```

Registry phải normalize các alias/transcription code liên quan thay vì hard-code ở nhiều nơi.

Pronunciation rubric sơ bộ:

- initials
- finals
- aspiration
- tones 1–4
- neutral tone
- tone sandhi khi phù hợp
- syllable clarity
- rhythm / fluency

Correction tập trung vào natural Mandarin, grammar, word order, particles, measure words và word choice.

Traditional Chinese (`zh-Hant`) chưa nằm trong scope đầu tiên.

---

## API / data contract

Nên cố giữ UI/Coach response schema chung giữa các target language.

Ví dụ pronunciation response vẫn giữ shape generic:

```json
{
  "overall_score": 0,
  "pronunciation_score": 0,
  "fluency_score": 0,
  "intonation_score": 0,
  "problems": [],
  "summary": ""
}
```

Nếu Japanese/Chinese cần dimension mới trong tương lai, không vội phá schema chung ở phase đầu.

Ưu tiên đưa chi tiết khác nhau vào `problems[].sound/tip` và rubric model trước.

Turn/metric nên lưu target language để debug:

```text
target_language
support_language
language_policy_version
input_language_codes
output_language_codes
coach_eligible
coach_skip_reason
```

---

## Phase triển khai

### Phase 1 — Generalize English without behavior change

Mục tiêu:

- tạo Language Profile/registry
- đưa English hiện tại vào profile
- bỏ các hard-code English quan trọng khỏi generic engine
- thêm `target_language` concept vào preference/turn/payload
- English flow vẫn hoạt động như trước

Exit criteria:

```text
English realtime works
English rescue works
English correction works
English pronunciation works
existing push-to-talk / hands-free unchanged
```

Không thêm Japanese/Chinese production behavior trước khi phase này ổn.

### Phase 2 — Japanese

- thêm `ja` profile
- thêm UI target choice
- conversation instruction Japanese
- target-language detection/eligibility
- Japanese correction
- Japanese pronunciation rubric
- replay/correction speech locale `ja-JP`
- metrics/tests

### Phase 3 — Mandarin Chinese Simplified

- thêm `zh-Hans` profile
- alias normalization cho Chinese/Mandarin language codes
- conversation instruction Mandarin
- Chinese correction
- tone-aware pronunciation rubric
- replay/correction speech locale phù hợp
- metrics/tests

### Phase 4 — hardening

- verify rapid language switching
- reconnect/session cleanup
- malformed/unknown language code handling
- mixed-language rescue turns
- model fallback behavior
- performance regression
- VPS public test

Traditional Chinese, JLPT/HSK curriculum, vocab/SRS, writing recognition chỉ xem xét sau phase này.

---

## Test strategy

### Unit tests

Language registry:

```text
normalize target
resolve profile
resolve aliases
reject unsupported target
speech locale
```

Language policy:

```text
English target + English input -> eligible
Japanese target + Japanese input -> eligible
Chinese target + Chinese/Mandarin code -> eligible
non-target input -> rescue / coach skipped
unknown transcription + target-looking text -> deterministic fallback
```

Preferences:

```text
load/save target language
invalid stored target -> default
language switch survives reload
```

Coach:

```text
English uses English profile
Japanese uses Japanese profile
Chinese uses Chinese profile
response schema remains common
support-language explanation remains independent from target language
```

### Regression

Must not break:

- current English conversation
- push-to-talk
- hands-free
- replay
- pronunciation toggle
- playback speed
- realtime fallback
- coach fallback
- maintenance/self-update

### Manual VPS test

For each target:

```text
connect
speak target language
AI answers target language
coach correction appears
pronunciation result appears
replay/correction TTS uses correct language
switch target
new Live session uses new target
```

---

## Performance constraints

Không thêm runtime process/service chỉ vì thêm language.

Giữ:

```text
1 app backend
1 realtime Live connection / active client session
same audio path
same CoachService
same max_workers=2 pattern
```

Language profile là config/metadata nhỏ, gần như không đáng kể về RAM/CPU.

Không thêm database ở phase này.

Không preload model/resource riêng theo từng language.

Không chạy ba coach pipeline song song cho ba language; mỗi turn chỉ resolve đúng một target profile.

---

## Clean-code rules cho implementation

1. Generic modules không chứa chuỗi điều kiện dài theo language nếu registry/profile xử lý được.
2. Không duplicate audio/realtime/session logic.
3. Không duplicate CoachService class theo từng language ở phase đầu.
4. Target language và support/app language là hai concept khác nhau từ naming đến payload.
5. Canonical language normalization chỉ có một responsibility rõ ràng.
6. Public preference không được vô tình trở thành global setting cho mọi user.
7. Giữ response schema chung nếu chưa có lý do mạnh để tách.
8. Mỗi phase phải có regression test trước khi sang language tiếp theo.
9. Ưu tiên small refactor commits; tránh rewrite `live.js`/`coach.py` toàn bộ cùng lúc.
10. Không overengineer plugin architecture/dynamic loading khi hiện chỉ có 3 target languages.

---

## Non-goals hiện tại

Chưa làm trong plan đầu:

- JLPT curriculum
- HSK curriculum
- kanji/hanzi handwriting
- vocabulary database
- spaced repetition
- grammar lesson engine riêng
- account/profile database
- automatic learner level progression
- Traditional Chinese
- language-specific backend services

Các phần này chỉ nên được thiết kế khi product requirement thực sự xuất hiện.

---

## Definition of done tổng thể

```text
English + Japanese + Mandarin dùng cùng một realtime/audio/coach architecture.
```

User có thể chọn target language độc lập với app/support language.

Mỗi target có đúng:

- conversation policy
- target detection aliases
- correction behavior
- pronunciation rubric
- speech locale

English hiện tại không regression.

Japanese/Chinese không tạo duplicate service/process.

Code vẫn đủ đơn giản để thêm target thứ tư bằng cách chủ yếu thêm profile + tests, không phải sửa xuyên toàn bộ app.

---

## Bước tiếp theo khi bắt đầu implementation

Trước khi code, audit chính xác call graph của:

```text
preferences.js
language_policy.js
live.js
coach.py
settings.py / server API payloads
UI target selector
existing JS/Python tests
```

Sau đó viết plan implementation chi tiết cho **Phase 1 only** và làm English-generalization trước, chưa trộn Japanese/Chinese vào cùng một refactor lớn.
