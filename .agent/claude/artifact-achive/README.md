# E-KAIWA Artifact — offline export

Mở `index.html` bằng Chrome/Edge/Firefox để xem offline.

## Dành cho AI agent
- `index.html`: UI/DOM/CSS/JavaScript của Artifact, đã bỏ runtime Claude.
- `assets/`: font đã lưu cục bộ.
- `artifact-text.md`: nội dung văn bản dễ đọc/search.
- `manifest.json`: danh sách file + checksum và trạng thái sanitize.

## Đã loại bỏ
- Request/response API tài khoản Claude.
- Cookie, session, token, org/account identifiers từ WACZ.
- Claude frame/runtime/chrome dùng để nhúng Artifact.

Bản này không chứa WACZ gốc. Giữ WACZ gốc riêng nếu cần replay chính xác bằng ReplayWeb.page.
