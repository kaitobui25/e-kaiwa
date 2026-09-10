# 08 — Multilingual Phase 1–3 review + CJK hardening summary

## Mục tiêu của cuộc chat

Review implementation **Phase 1–3** của plan multilingual đã được code xong trước đó, tìm bug/risk thực tế, sau đó fix các điểm cần thiết mà không overengineer.

Target architecture vẫn giữ:

```text
Generic E-KAIWA Engine
        +
Language Profile / Registry
```

Target languages hiện tại:

```text
en       English
ja       Japanese
zh-Hans  Mandarin Chinese (Simplified)
```

Nguyên tắc tiếp tục giữ:

- support/app language và target learning language là 2 khái niệm riêng
- 1 realtime/audio/session pipeline chung
- 1 CoachService chung
- target language được freeze theo Live session/turn
- không duplicate app/service theo từng ngôn ngữ
- clean code, modular, dễ bảo trì

---

## Kết quả review Phase 1–3

Review xác nhận phần kiến trúc chính đi đúng plan:

- đã có generic language profile/registry cho `en`, `ja`, `zh-Hans`
- frontend lưu target language riêng
- target/support language được tách
- mỗi turn giữ target của session
- Coach nhận target riêng
- pronunciation/TTS dùng speech locale theo target
- Japanese và Mandarin có rubric riêng
- không tạo duplicate realtime/audio/CoachService

CI tại thời điểm review đang xanh.

Tuy nhiên phát hiện một số điểm English-era chưa generalize hoàn toàn.

### Các vấn đề tìm thấy

1. `highlightProblems()` dùng word-boundary kiểu English nên CJK pronunciation problem có thể không highlight đúng.
2. transcript concatenation ban đầu chèn spacing theo assumption English/CJK chưa đủ chính xác.
3. một số UI copy vẫn nói cụ thể về English dù target có thể là Japanese/Chinese.
4. target selector vẫn có nguy cơ nhiều source-of-truth nếu frontend hard-code options thay vì dùng backend registry.
5. invalid target trong metric có thể bị normalize sai về English thay vì giữ validation rõ ràng.

---

## Hardening fix đầu tiên

Đã sửa và test các điểm chính:

- CJK-safe pronunciation highlighting
- transcript concatenation aware theo multilingual target
- bỏ English-only copy khỏi UI chính
- target selector lấy danh sách target từ backend thay vì hard-code HTML riêng
- metric không silently biến invalid target thành English
- thêm regression tests cho English/Japanese/Mandarin

Production fix commit:

```text
220bd455a2b13ba5e838f3a9847864df316b619a
fix: harden multilingual CJK behavior
```

Sau đó tạo commit no-op trên cùng tree để ép CI chính chạy rõ ràng:

```text
1410ff7ae7613c13e418f02de921faf655ccc9ca
chore: verify multilingual hardening
```

CI:

```text
Core checks #193: SUCCESS
```

Pass:

- Python core regression tests
- Browser module tests
- Python syntax check
- Browser JavaScript syntax check

App version vẫn:

```text
0.7
```

Không bump version trong cuộc chat này.

Lưu ý implementation process có dùng workflow/bootstrap tạm để chạy patch + regression trên GitHub Actions; các file tạm đã được xóa khỏi tree cuối.

---

## Review tiếp theo: bug English rescue trong Japanese/Chinese session

Một review sau đó chỉ ra bug quan trọng trong `concatTargetTranscript()`.

### Root cause

Logic lúc đó quyết định spacing dựa vào **target language của session**, ví dụ:

```text
target = ja
fragment 1 = "Hello"
fragment 2 = "world"
```

Nếu target khác English thì code nối thẳng:

```text
Hello + world -> Helloworld
```

Điều này sai vì target language của session không nhất thiết là language của fragment đang stream.

Trong Japanese/Mandarin session, learner vẫn có thể nói English ở rescue turn.

Ví dụ đúng phải là:

```text
Hello + world       -> Hello world
今日は + 天気です     -> 今日は天気です
你好 + 世界           -> 你好世界
```

Kết luận kỹ thuật:

> transcript spacing phải quyết định theo **boundary/content của fragment**, không theo target language của session.

---

## Fix transcript spacing theo content boundary

Đã đổi `concatTargetTranscript()` để dùng helper quyết định separator từ ký tự cuối của fragment trước và ký tự đầu của fragment mới.

Behavior hiện tại:

```text
Latin/alphanumeric + Latin/alphanumeric -> thêm space
CJK boundary                            -> không space
punctuation phù hợp                     -> không thêm space sai
English contraction                     -> giữ tự nhiên
```

Regression cases đã thêm:

```text
concatTargetTranscript("Hello", "world", "en")
=> "Hello world"

concatTargetTranscript("Hello", "world", "ja")
=> "Hello world"

concatTargetTranscript("Hello", "world", "zh-Hans")
=> "Hello world"

concatTargetTranscript("今日は", "天気です", "ja")
=> "今日は天気です"

concatTargetTranscript("你好", "世界", "zh-Hans")
=> "你好世界"

concatTargetTranscript("Hello", "!", "ja")
=> "Hello!"

concatTargetTranscript("Hello,", "world", "ja")
=> "Hello, world"

concatTargetTranscript("don", "'t", "ja")
=> "don't"
```

Commit:

```text
d262dbe5bb46f7d3bb319d5a89b04e934f2dd7aa
fix: preserve Latin spacing in multilingual transcripts
```

Diff chỉ đụng 2 file:

```text
src/web/language_policy.js
src/tests/js/language_policy.test.mjs
```

CI:

```text
Core checks #195: SUCCESS
```

Toàn bộ Python/Browser/syntax checks pass.

---

## Edge case còn biết nhưng chưa fix trong cuộc chat này

Review cũng chỉ ra một edge case nhỏ ở pronunciation highlighting:

```text
problem word = 'n'
text         = rock 'n' roll
```

`usesAsciiWordBoundary()` hiện coi token có apostrophe là có thể dùng `\b`, nhưng pattern kiểu `\b'n'\b` không match tốt vì apostrophe là non-word character.

Ảnh hưởng:

- không ảnh hưởng Japanese/Chinese thông thường
- chỉ là edge case của helper highlight với apostrophe đầu/cuối token

Trạng thái:

```text
KNOWN EDGE CASE — chưa fix trong cuộc chat này
```

Nếu xử lý sau, nên sửa nhỏ tại boundary matcher + regression test riêng, không cần refactor lớn.

---

## Trạng thái cuối cuộc chat

Multilingual Phase 1–3 hiện đã được harden thêm đáng kể:

```text
English baseline          OK
Japanese target flow      code-level OK
Mandarin target flow      code-level OK
CJK highlighting          fixed
English rescue spacing    fixed
CJK transcript adjacency  fixed
Target selector source    backend-driven
Metric invalid target     hardened
CI                        green
App version               0.7
```

Điểm vẫn cần làm trước khi gọi production multilingual hoàn toàn validated:

1. manual VPS/live test thật với Gemini Live cho English/Japanese/Mandarin
2. xác nhận rescue flow thực tế trên browser/mobile
3. Phase 4 hardening/regression theo plan 08
4. optional: fix apostrophe pronunciation-highlight edge case

Không có yêu cầu bump release version trong cuộc chat này.
