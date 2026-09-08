# E-KAIWA – Realtime multi-turn / VAD debug summary

Date: 2026-09-08

## 1. Vấn đề ban đầu

Web Gemini Live chỉ nói được 1 lượt.

Hiện tượng:

```text
Turn 1:
user nói
→ Gemini trả lời bình thường
→ coach chạy bình thường

Turn 2:
không nói tiếp được / tap không có phản ứng
```

`setupReady` vẫn `true`, nên Live session chưa chết.

## 2. Diagnostic state được thêm

Sau mỗi turn, frontend gửi snapshot state vào `/api/metric` và ghi vào `conversation.jsonl`:

```json
"frontend_state": {
  "recording": true,
  "activeTurn": null,
  "buttonEnabled": true,
  "setupReady": true
}
```

Web cũng hiện trạng thái `setupReady` bằng chấm:

```text
🟢 setupReady=true
🔴 setupReady=false
```

Mục đích: xác định chính xác state nào làm turn 2 bị kẹt.

Commits liên quan:

```text
d1e2b91  log frontend turn state
f11e8ca  show setupReady indicator + state diagnostics
```

## 3. Nguyên nhân thực sự

Log xác nhận sau turn 1:

```text
recording   = true
activeTurn  = null
setupReady  = true
```

Frontend mic callback khi đó có guard kiểu:

```text
if (!recording || ws not open || !activeTurn) return
```

Sau `turnComplete`, code đặt:

```text
activeTurn = null
```

Kết quả:

```text
mic vẫn mở
setupReady vẫn true
nhưng !activeTurn
→ callback mic return
→ audio không còn gửi tới Gemini
→ không có turn 2
```

Đây là bug chính.

## 4. Quyết định UX mới

Không dùng push-to-talk cho từng lượt nữa.

UX mong muốn:

```text
Tap 1 lần để bắt đầu
→ mic mở liên tục
→ user nói
→ im lặng một khoảng
→ Gemini VAD tự hiểu hết lượt
→ AI trả lời
→ AI nói xong
→ mic tiếp tục nghe
→ user nói lượt kế tiếp
→ không cần tap nữa
```

Chỉ cần giữ Live session hoạt động khi:

```text
setupReady = true
```

## 5. Automatic VAD / silenceDurationMs

Gemini Live dùng Automatic VAD để tự chia turn.

Setting mới:

```text
Silence timeout
0.7 s
1.0 s  ← default
1.2 s
1.5 s
```

Giá trị được lưu trong browser `localStorage` và gửi vào setup:

```text
realtimeInputConfig
  → automaticActivityDetection
      → disabled = false
      → silenceDurationMs = selected value
```

Commit:

```text
6693acc  add configurable silenceDurationMs
```

Lưu ý: setting VAD áp dụng khi tạo/reconnect Live session.

## 6. Fix multi-turn cuối cùng

Frontend được đổi từ state machine push-to-talk cũ sang continuous listening.

Flow cuối:

```text
Tap Start một lần
→ mic stream liên tục
→ Gemini Automatic VAD chia turn
→ turnComplete
→ finalize/log/coach turn hiện tại
→ tự arm/create turn mới
→ mic không dừng
→ tiếp tục gửi PCM
→ turn 2, 3, 4... tự chạy
```

Không còn phụ thuộc `activeTurn` cũ để quyết định có stream microphone hay không.

Commit fix cuối:

```text
ba9889f62182c224372d0ac0c50f328bdf80fc9f
```

User test lại và xác nhận:

```text
done
```

=> Continuous multi-turn realtime đã hoạt động.

## 7. Trạng thái hiện tại

Realtime path:

```text
Phone mic
→ direct WebSocket PCM
→ gemini-3.1-flash-live-preview
→ streaming audio reply
→ phone speaker
```

Coach sidecar vẫn chạy riêng và không chặn spoken reply.

Current UX:

```text
Tap once
→ hands-free conversation
→ Automatic VAD tự kết thúc lượt theo silenceDurationMs
→ AI trả lời
→ tự nghe lượt tiếp theo
```

Web settings hiện có:

```text
Teacher: Easy / Normal / Strict
Correction language: Tiếng Việt (default) / 日本語
Silence timeout: 0.7 / 1.0 / 1.2 / 1.5 s
Pronunciation coaching: ON/OFF
```

Web status:

```text
🟢 setupReady=true
🔴 setupReady=false
```

Runtime log mỗi turn có thêm `frontend_state` để debug lifecycle.

## 8. Lệnh chạy hiện tại

```bat
git pull
scripts\run_web_test.bat
```

## 9. Kết luận

Bug “chỉ được 1 lượt” không phải do Gemini không hỗ trợ multi-turn, cũng không phải do `setupReady=false`.

Nguyên nhân là frontend đặt `activeTurn=null` sau turn 1 trong khi mic callback lại yêu cầu `activeTurn` tồn tại mới gửi audio.

Fix đúng là tách lifecycle microphone khỏi lifecycle từng turn:

```text
mic/session = sống liên tục
turn object  = tạo/finalize lại cho từng lượt
```

Automatic VAD + `silenceDurationMs` chịu trách nhiệm xác định ranh giới các lượt nói.
