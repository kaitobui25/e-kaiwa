# Chat summary — UI 0.22 → 0.23, assets, AGENTS/OpenCode

## 1. Asset pack cho UI plan 02
- Chuẩn bị bộ asset tối giản cho frontend: Be Vietnam Pro, 7 Lucide SVG, license, manifest, README và script tải font.
- Nguyên tắc: không thêm dependency/icon framework; glow, score ring, gradient, animation làm bằng CSS/SVG.
- Font dùng 5 weight: 400/500/600/700/800.
- Script:
  - Windows: `scripts/fetch-fonts.ps1`
  - Linux/macOS: `scripts/fetch-fonts.sh`
- Chạy script từ root của pack hoặc root repo nếu đã copy pack vào repo; font sẽ vào `src/web/assets/fonts/`.

## 2. AGENTS.md và OpenCode
- Vấn đề: Codex trên PC vẫn tự implement thay vì gọi OpenCode.
- Root cause trong AGENTS cũ: có câu cho phép task đơn giản "do the coordination directly", tạo loophole để bỏ delegation.
- Hướng sửa:
  - Mọi task có thay đổi repo phải gọi OpenCode trước.
  - OpenCode phải thực sự implement, không chỉ plan/review.
  - Codex chỉ điều phối, review diff, test và sửa lỗi nhỏ.
  - Nếu OpenCode/model fail hết thì báo blocker, không âm thầm tự code.
  - Model order: Muse Spark Contributor Free → Ling 3.0 Flash Fin Free → MiMo V2.5 Free.
  - Không đoán model ID; dùng `opencode models` khi cần.

## 3. Đánh giá UI 0.22
Commit: `05882e6` — “0.22 update ui theo plan 2”.

Plan 02 được implement khá sát nhưng nhìn trên điện thoại vẫn ít khác vì bản chất chỉ là polish:
- Be Vietnam Pro chỉ phủ một phần UI.
- Score ring chỉ 34px.
- Header gradient chỉ ~5% primary nên rất nhạt.
- Ambient glow yếu và dùng `z-index: -1`, dễ gần như không thấy.
- Cấu trúc chính vẫn giữ nguyên: Header → Conversation → Messages → fixed dock.

Kết luận: 0.22 = polish, chưa phải visual redesign.

## 4. UI 0.23
Commit UI chính: `0c313bf`.
Commit `9347be5` chỉ bump version `0.22 → 0.23`.

Các thay đổi đáng kể:
- Be Vietnam Pro phủ conversation, Settings, overlay; thêm fallback Nhật/Trung.
- Nền app/conversation tách lớp rõ hơn; conversation có border, radius, shadow.
- AI và user đều có bubble rõ ràng.
- Score `34px → 48px`, số lớn và rõ hơn.
- Talk dock thành floating rounded dock, có shadow/blur.
- Glow tăng mạnh, bỏ `z-index: -1`, đổi màu theo speaking/recording.
- Header gradient mạnh hơn, có border/blur/shadow.
- Các icon Settings/mic/close/volume/chevron... chuyển sang Lucide local bằng CSS mask.

Kết luận: 0.23 = visual redesign mobile rõ hơn 0.22, nhưng kiến trúc màn hình chính vẫn giữ nguyên.

## 5. Commit mới nhất sau 0.23
Commit: `a9d35b3` — “plan 03 ux”.

Đây mới là plan, chưa implement. Nội dung chuyển từ visual polish sang UX/product:
- onboarding,
- topic chips,
- session recap,
- streak/statistics,
- vocab notebook,
- milestone,
- PWA,
- sync nhẹ,
- scenario/weekly goals/share.

Tóm tắt hướng phát triển:
**0.22 = polish → 0.23 = visual redesign mobile → plan 03 = UX/product redesign.**
