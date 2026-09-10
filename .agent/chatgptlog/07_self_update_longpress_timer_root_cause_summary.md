# 07 — Self-update long-press timer root cause summary

## Mục tiêu của cuộc chat

Debug lỗi nút **Hold 5s to Update** trên VPS/public app: thanh giữ nút chạy đầy nhưng không gọi update, không có maintenance progress, updater không chạy.

## Trạng thái VPS / updater đã xác nhận

Backend và updater hoạt động bình thường.

Test trực tiếp:

```bash
curl -i -X POST http://127.0.0.1:7860/api/update
sudo journalctl -u ekaiwa-update.service -n 30 --no-pager
```

Journal cho thấy updater được trigger đúng:

```text
Starting ekaiwa-update.service
state=preparing progress=0 message="Fetching Git"
state=already_latest progress=100 message="Already latest"
Finished ekaiwa-update.service
```

Tại thời điểm đó:

```text
from_version = 0.4
to_version   = 0.4
from_revision = afd448d1f961
to_revision   = afd448d1f961
```

Kết luận:

```text
/api/update -> request marker -> systemd path -> updater
```

đều OK. Bug nằm ở frontend trước `triggerUpdate()`.

---

## Log ban đầu

UI log nhiều lần chỉ có:

```text
update_press_start
```

nhưng không có:

```text
update_press_complete
update_request_sent
update_request_response
```

Maintenance status vẫn `idle`.

Ban đầu có giả thuyết timer bị cancel bởi:

```text
pointerup
pointercancel
lostpointercapture
blur
```

nhưng log cũ chưa đủ chi tiết để kết luận.

---

## Tăng diagnostic log

User đồng ý bump app version từ `0.4` lên **`0.5`**.

Đã thêm `update_press_debug` để log lifecycle long-press:

```text
pointerdown_received
pointer_capture_set
pointer_capture_failed
pointerup_received
pointercancel_received
lostpointercapture_received
blur_received
cancel_enter
timer_scheduled
timer_fired
timer_cleared
```

Backend UI log allowlist/fields cũng được mở rộng tương ứng, test JS/Python được cập nhật. CI pass.

Sau đó log thực tế cho thấy:

```text
pointerdown
pointer_capture_set
update_press_start
```

nhưng **không có `timer_scheduled`**.

Khi thả tay sau khoảng 7.3 giây:

```text
pointerup_received
elapsed_ms ~= 7326
cancel_enter state=inactive
```

Điều này chứng minh `startedAt` đã được set nhưng `this.timer` vẫn `null`.

---

## Bổ sung try/catch quanh setTimeout

Đã thêm diagnostic:

```text
timer_schedule_failed
reason
```

quanh đoạn tạo timer và thêm regression test cho trường hợp scheduling ném exception. CI pass.

Commit diagnostic cuối trước khi xác định root cause:

```text
4e3c2e111a9d08b154d8d116f3410358a38fc6f3
```

App version vẫn **0.5**.

---

## Root cause đã bắt được

Log mới trả về chính xác:

```text
timer_schedule_failed
reason: Can only call Window.setTimeout on instances of Window
```

Nguyên nhân nằm ở constructor của `LongPressController` và cùng pattern trong `MaintenanceController`:

```js
setTimeoutFn = setTimeout,
clearTimeoutFn = clearTimeout,
...
this.setTimeoutFn = setTimeoutFn;
this.clearTimeoutFn = clearTimeoutFn;
```

Sau đó gọi:

```js
this.setTimeoutFn(...)
```

Trong browser này, native `Window.setTimeout` yêu cầu `this` phải là `Window`. Khi hàm native được lưu vào property rồi gọi như method của object, `this` trở thành instance controller thay vì `window`, nên ném:

```text
Can only call Window.setTimeout on instances of Window
```

Do đó flow lỗi thực tế là:

```text
pointerdown
-> startedAt được set
-> CSS data-holding=true nên animation fill vẫn chạy
-> update_press_start được log
-> this.setTimeoutFn(...) ném TypeError
-> timer không bao giờ được tạo
-> giữ 5s, 7s, 10s đều không thể complete
-> /api/update không bao giờ được gọi
```

Vì vậy:

- Không phải updater lỗi.
- Không phải backend `/api/update` lỗi.
- Không phải `pointercancel` là root cause.
- Không phải timer tự nhiên bị browser delay.
- Root cause là **mất `Window` binding/context khi gọi native timer qua object property**.

---

## Fix đúng đã thống nhất

User nói **“do it”** và yêu cầu sửa cả nơi liên quan.

Hướng fix:

```js
setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms)
clearTimeoutFn = id => globalThis.clearTimeout(id)
```

hoặc wrapper tương đương đảm bảo native timer được gọi trực tiếp qua `globalThis/window`, không gọi unbound native function như method của controller.

Phải áp dụng cho cả:

```text
LongPressController
MaintenanceController
```

vì cả hai đang dùng cùng pattern timer injection.

Regression test cần cover đúng lỗi này:

1. Default timer trong browser-style environment không mất context.
2. Long press đủ 5s -> `timer_fired` -> `update_press_complete` -> `triggerUpdate()`.
3. Maintenance polling/reload/hide timers cũng dùng wrapper an toàn.
4. Custom injected fake timers trong tests vẫn hoạt động.
5. Không duplicate completion.

---

## Trạng thái tại lúc kết thúc chat

**Quan trọng:** root cause đã xác định chắc chắn, nhưng task fix production code bị user ngắt giữa chừng để yêu cầu ghi chatlog.

Tại thời điểm ghi file này:

- Version hiện tại: **0.5**.
- Diagnostic logging đã commit và CI pass.
- Root cause đã xác nhận bằng log thật.
- **Actual timer-binding fix chưa được commit trong đoạn chat này.**
- Việc tiếp theo: sửa `src/web/maintenance.js`, cập nhật tests, chạy CI, sau đó deploy VPS và test nút 5s lại.

## Deploy/test sau khi fix

Sau khi fix được commit và CI pass:

```bash
cd ~/e-kaiwa
git pull --ff-only origin main
sudo systemctl restart ekaiwa
```

Sau đó mở app public, giữ nút Update đủ 5s.

Kỳ vọng log:

```text
pointerdown_received
pointer_capture_set
update_press_start
timer_scheduled
...
timer_fired
update_press_complete
update_request_sent
update_request_response
maintenance_status_seen
```

Và updater journal phải chạy tương ứng:

```bash
sudo journalctl -u ekaiwa-update.service -n 50 --no-pager
```

Nếu HEAD đã là latest thì updater có thể trả `already_latest`; điều đó vẫn chứng minh end-to-end flow đã hoạt động.
