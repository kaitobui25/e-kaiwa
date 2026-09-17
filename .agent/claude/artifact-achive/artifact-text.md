# Kế hoạch làm mới giao diện E-KAIWA

Kế hoạch làm mới giao diện E-KAIWA
E‑KAIWA · UI Plan
Hiện trạng
Định hướng
Màu & chữ
Màn hình
Chuyển động
Lộ trình
🌙
Làm giao diện E‑KAIWA lung linh như chính trải nghiệm luyện nói
Nền tảng UX của repo đã đúng hướng: bong bóng hội thoại, nút giữ để nói, bottom sheet cho Coach và Settings, hai theme sáng/tối. Cái còn thiếu là một bản sắc thị giác riêng — nơi âm thanh thật sự "nhìn thấy được".
Bản kế hoạch này dựa trên mã nguồn thật của
src/web/
(public.css, live.css, ui.js…), giữ đúng triết lý "vanilla, nhẹ, chạy tốt trên VPS rẻ" mà README đã đề ra — không đề xuất viết lại bằng framework nào cả.
Ý tưởng cốt lõi: nút Talk không còn là một hình tròn đổi màu — nó thở, gợn sóng và đổi sắc theo đúng lượt nói của bạn hay của AI. Bấm thử bên dưới.
Sẵn sàng — đang thở nhẹ
Đang chờ
Bạn đang nói
AI đang nói
Bản xem trước dựng bằng CSS thuần — đúng cách sẽ triển khai trong live.css
Hiện trạng: đúng nhưng chưa cuốn
Đọc qua public.css, live.css và live.html, đây là bốn điểm đáng chú ý nhất.
1
Cấu trúc UX đã hợp lý
Header gọn, khung hội thoại cuộn riêng, dock điều khiển cố định đáy màn hình, overlay dạng bottom sheet cho Coach/Settings — đúng mẫu hình một app thoại trên di động cần có.
2
Bản sắc thị giác còn chung chung
Nền trắng/xám nhạt, một màu xanh dương
#2f6fed
lặp lại ở nút, avatar, liên kết — đúng công thức "SaaS xanh dương" mà rất nhiều app quản lý công việc cũng dùng. Không có gì gợi nhắc đây là app luyện nói.
3
Chuyển động gần như vắng mặt
Nút Talk đổi màu tức thì giữa các trạng thái, sóng âm hai bên chỉ là 5 vạch tĩnh. Phần lẽ ra sống động nhất — hành động "nói" — lại là phần tĩnh nhất của toàn bộ giao diện.
4
Khoảnh khắc thưởng bị đánh giá thấp
Sau mỗi lượt nói, Coach chấm điểm — đây là phần thưởng cảm xúc lớn nhất cho người học. Nhưng hiện tại nó chỉ là một con số và một thanh tiến trình mỏng 4px, chưa xứng với công sức người dùng vừa bỏ ra.
Định hướng: giọng nói hoá thành ánh sáng
Ba nguyên tắc dẫn dắt mọi quyết định thiết kế tiếp theo, thay vì làm lại từng màn hình rời rạc.
Giọng nói hoá thành ánh sáng
Nút Talk thở nhẹ khi chờ, gợn sóng khi bạn nói, đổi sắc khi AI trả lời. Người dùng nhìn cuộc trò chuyện thay vì chỉ nghe nó.
Hai giọng, hai sắc
Xanh ngọc cho giọng của bạn, cam san hô cho giọng AI — dùng nhất quán ở nút Talk, viền avatar, điểm nhấn bong bóng chat. Nhìn màu là biết ai đang nói.
Một điểm sáng, phần còn lại yên tĩnh
Sự lung linh dồn hết vào nút Talk và khoảnh khắc chấm điểm. Bong bóng chat, danh sách cài đặt vẫn sạch, phẳng, ít viền — để ánh sáng kia không phải cạnh tranh sự chú ý.
Bảng màu & chữ
Bốn màu có vai trò rõ ràng thay vì một xanh dương dùng cho mọi thứ. Mỗi ngôn ngữ luyện tập được gắn một sắc phụ, dùng tiết chế ở chấm nhỏ và viền — không đổi toàn bộ theme.
Voice Teal
Giọng của bạn · English
Ember Coral
Giọng AI · ăn mừng điểm cao
Sakura
Điểm nhấn · 日本語
Imperial Gold
Điểm nhấn · 中文
English
日本語
中文
Đổi ngôn ngữ ở đây, quan sát viền avatar và chấm điểm nhấn trong hai mockup bên dưới đổi theo.
Display — Bricolage Grotesque · tiêu đề, số điểm, nhãn trạng thái nút Talk
Nói tự nhiên hơn mỗi ngày.
Body — Inter · toàn bộ giao diện, hội thoại, cài đặt
Giữ mic, nói một câu tiếng Anh hoặc tiếng Nhật, thả tay ra và nghe Coach nhận xét về phát âm ngay sau đó.
Số liệu — Inter tabular figures, không dùng font monospace cho nhãn nhỏ
87
/ 100
Thiết kế lại từng màn hình
Bốn mockup dựng bằng đúng CSS sẽ đưa vào repo — không phải ảnh tĩnh.
Hội thoại & nút Talk
Avatar AI chỉ còn viền cam san hô mảnh thay vì khối gradient đặc; bong bóng của bạn nhuốm sắc teal rất nhẹ.
AI
How was your weekend?
I went hiking with my sister.
AI
Nice! What trail did you take?
English
0.8×
Coach & điểm số
Vòng tiến trình thay cho thanh mỏng 4px, số điểm chạy lên khi xuất hiện — bấm nút bên dưới để xem.
0
/ 100
Xem điểm
Phát âm
82
Ngữ pháp
90
Từ vựng
88
!
Âm cuối "-ed" trong "hiked" bị nuốt mất
Cài đặt
Ba ngôn ngữ luyện tập hiện thành chấm màu thay vì chữ trong dropdown — nhận diện nhanh hơn bằng mắt.
Ngôn ngữ luyện tập
EN
JA
ZH
Giao diện
Sáng
Tốc độ AI trả lời
0.8×
Chấm điểm phát âm
Chế độ rảnh tay
Trạng thái Talk chi tiết
Cùng một hình tròn, ba câu chuyện khác nhau — dùng lại demo ở đầu trang cho ba trạng thái chờ / ghi / AI nói.
Đang nghe bạn nói…
Chuyển động & vi tương tác
Chỉ dùng transform/opacity/box-shadow — không filter:blur() chạy liên tục, để không tốn pin khi một phiên nói kéo dài nhiều phút trên điện thoại tầm trung.
Nút Talk — chờ
Thở nhẹ, scale 1 → 1.055, chu kỳ 3.4s, dùng để báo "sẵn sàng" mà không gây phân tâm.
Nút Talk — đang nói
Hai vòng gợn sóng nở ra rồi mờ dần liên tục, lệch nhịp 0.6s, mô phỏng sóng âm thật thay vì chỉ đổi màu tức thì.
AI đang nói
Sắc chuyển sang cam san hô, năm vạch cân bằng nhỏ nhấp nháy phía dưới nút — phân biệt rõ với lượt nói của người dùng.
Điểm số hiện ra
Vòng tiến trình vẽ dần trong 1.1s, số điểm đếm lên cùng lúc — một chuyển động duy nhất, đúng lúc người học vừa nói xong.
Tin nhắn mới
Chỉ tin nhắn mới nhất trượt nhẹ lên khi xuất hiện; lịch sử cũ giữ nguyên, tránh hiệu ứng "mọi thứ đều fade-in" khi cuộn.
prefers-reduced-motion
Toàn bộ animation trên tắt về trạng thái tĩnh cuối cùng; vòng điểm và số vẫn cập nhật, chỉ bỏ phần chuyển động.
Lộ trình triển khai
Sáu giai đoạn, mỗi giai đoạn động vào đúng một nhóm file — để đi qua bộ test Python/JS hiện có mà không phải sửa lại toàn bộ ui.js hay live.js.
1
Token màu & chữ nền tảng
Thêm biến mới vào
public.css
/
live.css
(
--teal
,
--ember
,
--sakura
,
--gold
), giữ nguyên biến cũ song song để dev mode không vỡ trong lúc chuyển đổi.
2
Nút Talk & sóng âm
Chỉnh
.talk-button
,
.voice-waves
trong
live.css
.
data-state
đã tồn tại sẵn trên nút nên phần lớn chỉ là CSS, gần như không đụng
live.js
.
3
Bong bóng hội thoại & avatar
Sửa
.bubble
,
.avatar
,
.ai-avatar
trong
public.css
; nếu cần thêm class ngữ nghĩa "giọng ai" thì chỉnh nhỏ trong
ui_render.js
.
4
Coach & điểm số
Thêm SVG vòng tiến trình vào markup do
ui_overlay.js
sinh ra, style trong
live.css
(
.score-hero
,
.score-track
).
5
Cài đặt & overlay
Thêm chấm màu ngôn ngữ vào
#target-language
trong
live.html
/
ui_overlay.js
, restyle danh sách trong
.settings-panel
.
6
Rà soát & kiểm thử
Kiểm tra
prefers-reduced-motion
, độ tương phản hai theme, chạy lại
unittest
+
node --test
, thử trên Android tầm trung qua Chrome remote debugging trước khi lên VPS.
Ghi chú kỹ thuật cho codebase hiện tại
Giữ triết lý "vanilla, nhẹ, rẻ"
mà README đã nêu — mọi hiệu ứng trong bản này chỉ dùng CSS thuần, không thêm thư viện animation nào.
Dùng thuộc tính data trên
<body>
— có thể thêm
data-target-lang="en|ja|zh-Hans"
theo đúng cách
data-theme
đang hoạt động, rồi định nghĩa
--accent
theo ngôn ngữ một lần, thay vì viết lại từng component.
Ưu tiên không đổi cấu trúc DOM/class hiện có
— chỉ đổi biến số và thêm vài class trạng thái, để giảm rủi ro hồi quy trên bộ test Python + JS đã khá đầy đủ của repo.
Đo hiệu năng trên thiết bị thật
— nút Talk có thể "thở" liên tục trong nhiều phút một phiên nói, nên cần theo dõi ảnh hưởng lên pin và tốc độ khung hình trên Android tầm trung, không chỉ desktop.
Bản kế hoạch này ưu tiên một thay đổi thị giác lớn duy nhất — nút Talk hoá thành ánh sáng sống — rồi giữ mọi thứ khác gọn và yên tĩnh xung quanh nó. Cách này vừa tạo cảm giác "lung linh" mà bạn muốn, vừa không đòi hỏi viết lại kiến trúc vanilla JS/CSS đang chạy ổn của E‑KAIWA.
Toàn bộ màu sắc, chữ và mockup trên trang này đều dựng bằng CSS thật — có thể copy thẳng token và cấu trúc vào
public.css
/
live.css
để bắt đầu giai đoạn 1.
