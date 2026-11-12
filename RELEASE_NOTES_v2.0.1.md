## AutoCap Google Slides v2.0.1 - Fix duplicate slides (Chụp bị x2 ảnh)

### 🐛 Bug Fixes & Improvements (Khắc phục lỗi & Cải tiến)

#### Tiếng Việt:
* **Khắc phục triệt để lỗi chụp ảnh bị lặp (x2 ảnh) khi cuộn danh sách slide**:
  - **Loại bỏ `scrollIntoView()`**: Tránh tình trạng trình duyệt tự động cuộn thụt toàn bộ trang Google Slides xuống dưới ("nhảy ở dưới dưới") làm lệch tọa độ click và trượt thao tác chọn slide.
  - **Khóa cố định vị trí cửa sổ (`window.scrollTo(0, 0)`)**: Giữ nguyên khung nhìn web, chỉ cuộn nội bộ thanh danh sách filmstrip (`filmstrip.scrollTop`) một cách mượt mà.
  - **Bắt chuẩn đối tượng Thumbnail từ số hiệu slide**: Xử lý chính xác quan hệ đồng cấp (sibling) giữa số trang (`.punch-filmstrip-thumbnail-pagenumber`) và thẻ thumbnail (`.punch-filmstrip-thumbnail`), click chuột đơn chuẩn xác vào giữa ảnh slide.
  - **Cơ chế chống lặp ảnh 3 lớp (Anti-Duplicate Guard)**: Tự động so sánh chuỗi `dataUrl`, dung lượng byte và fingerprint ảnh xám. Nếu phát hiện khung hình giống hệt ảnh trước, extension chặn không cho lưu ảnh trùng vào ZIP mà tự động kích hoạt nạp lại slide và chụp lại.
  - **Tránh kích hoạt trùng lặp thao tác**: Tách biệt rõ ràng giữa click thumbnail và phím điều hướng, ngăn chặn tình trạng nhảy cóc 2 slide cùng lúc.

#### English:
* **Fixed duplicate slide captures (2x images) during virtual filmstrip scrolling**:
  - Removed `scrollIntoView()` calls that caused the entire browser window to jump/scroll down, displacing click targets.
  - Pinned window viewport to `(0, 0)` and used smooth container-only scrolling (`filmstrip.scrollTop`).
  - Fixed DOM sibling lookup between slide page numbers and clickable thumbnail containers.
  - Added triple-layer anti-duplicate guard (`dataUrl`, byte size, grayscale fingerprint) to guarantee zero duplicated slides in the output ZIP.

### Downloads (File tải về)
* **`AutoCap-Google-Slides-v2.0.1.zip`**: File nén tiện ích Chrome Extension đã fix lỗi hoàn chỉnh, sẵn sàng cài đặt (Load unpacked).
* **Source code**: Toàn bộ mã nguồn bản v2.0.1.
