# AutoCap Google Slides

Tiện ích mở rộng trình duyệt (Chrome Extension - Manifest V3) giúp tự động chụp màn hình toàn bộ các trang Google Slides (bao gồm cả phần ghi chú phía dưới nếu cần), tùy chỉnh tốc độ theo giây, đóng gói thành file `.zip` trùng tên với bài trình bày và tải trực tiếp về máy tính.

---

## Tính năng chính

1. **Chụp đúng nội dung hiển thị trên trình duyệt (khắc phục lỗi ảnh đen)**
   - Chụp trực tiếp khung hình thực tế từ tab đang mở, giữ nguyên đầy đủ hình ảnh, phông chữ, biểu đồ và định dạng gốc.
   - Hoạt động bình thường ngay cả với các bài trình bày bị giới hạn quyền tải xuống (Chế độ Chỉ xem / View-only).
   - Tự động ẩn bảng điều khiển AutoCap trong khoảnh khắc chụp để không che mất nội dung slide hoặc ghi chú.

2. **Tùy chọn vùng chụp linh hoạt**
   - **Slide + Phần ghi chú phía dưới (Mặc định)**: Tự động lấy vùng trình bày kèm khung ghi chú (Speaker Notes) ở bên dưới, loại bỏ thanh menu trên và danh sách slide thu nhỏ bên trái.
   - **Toàn màn hình trình duyệt đang xem**: Chụp toàn bộ khung hiển thị hiện tại của tab.
   - **Chỉ khung Slide**: Chỉ cắt riêng khung trang chiếu, bỏ phần ghi chú.

3. **Tùy chỉnh tốc độ chụp theo số giây và chế độ Siêu Tốc Stream**
   - Cho phép tự nhập số giây chờ mỗi trang (từ `0.05` giây trở lên) hoặc chọn nhanh các mức `0.15s`, `0.3s`, `0.5s`, `0.8s`, `1.5s`.
   - **Chụp Trực Tiếp Tab**: Chạy tự động chỉ với 1 lần bấm, tự xử lý giới hạn tốc độ của Chrome (~2 trang/giây) mà không bị ngắt lỗi.
   - **Siêu Tốc Stream**: Lấy khung hình trực tiếp từ luồng video của tab thông qua Offscreen Document, vượt qua giới hạn tốc độ của `captureVisibleTab` khi cần chụp ở mức `0.1s` - `0.4s` mỗi trang.
   - **Xuất Vector PDF**: Kết xuất nhanh từ PDF gốc (chỉ áp dụng khi slide cho phép xuất và không lấy phần ghi chú).

4. **Tạm dừng và tải ZIP những ảnh đã chụp được**
   - Trong quá trình chụp, có thể bấm **Tạm dừng** bất kỳ lúc nào.
   - Khi đang tạm dừng (hoặc nếu hủy/gặp sự cố giữa chừng), nút **Tải ZIP đã chụp** sẽ xuất hiện để nén và tải ngay toàn bộ các trang đã chụp được từ đầu đến thời điểm hiện tại. Sau khi tải xong vẫn có thể bấm **Tiếp tục** để chụp phần còn lại.

5. **Đặt tên ảnh và file ZIP chuẩn xác**
   - Tên file `.zip` được lấy trực tiếp từ tiêu đề bài trình bày Google Slides (ví dụ: `SEMESTER_4_SWR302.zip`), khắc phục triệt để lỗi Chrome tự đặt tên theo mã UUID của Blob URL.
   - Hỗ trợ nhiều kiểu đánh số ảnh: `001.png`, `1.png`, `Slide_001.png`, `Trang_001.png` với định dạng `PNG` hoặc `JPEG`.
   - Hỗ trợ điều hướng danh sách slide ảo hóa (virtual filmstrip) cho các bài trình bày lớn trên 500 trang.

---

## Hướng dẫn cài đặt

### Cách 1: Cài đặt từ bản phát hành (Khuyên dùng)

1. Truy cập trang [Releases](https://github.com/kingbone2006/autocap/releases) của repository.
2. Tại phiên bản mới nhất, tải về file cài đặt `AutoCap-Google-Slides-v2.0.0.zip`.
3. Giải nén file `.zip` vừa tải ra một thư mục riêng trên máy tính (ví dụ `C:\Extensions\AutoCap`). Lưu ý giữ nguyên thư mục này, không xóa sau khi cài.
4. Mở trình duyệt Chrome (hoặc Edge, Cốc Cốc, Brave) và truy cập địa chỉ:
   ```text
   chrome://extensions/
   ```
5. Bật công tắc **Chế độ dành cho nhà phát triển** (Developer mode) ở góc trên bên phải.
6. Bấm nút **Tải tiện ích đã giải nén** (Load unpacked) ở góc trên bên trái.
7. Chọn thư mục vừa giải nén ở Bước 3 (thư mục chứa file `manifest.json`) rồi bấm **Select Folder**.
8. Ghim biểu tượng tiện ích lên thanh công cụ Chrome nếu muốn thao tác nhanh từ popup.

### Cách 2: Cài đặt từ mã nguồn (Source Code)

1. Clone hoặc tải Source Code từ repository:
   ```bash
   git clone https://github.com/kingbone2006/autocap.git
   ```
2. Vào `chrome://extensions/`, bật **Chế độ dành cho nhà phát triển** (Developer mode).
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) và chọn thư mục `autocap` vừa tải về.


---

## Hướng dẫn sử dụng

1. Mở bài trình bày Google Slides cần chụp trên trình duyệt Chrome. Nếu bạn cần chụp cả phần ghi chú, hãy đảm bảo khung ghi chú phía dưới đang được mở và hiển thị đúng tỷ lệ mong muốn.
2. Ở góc dưới bên phải trang Google Slides, bấm vào nút **Chụp Slide** (hoặc bấm biểu tượng tiện ích trên thanh công cụ Chrome).
3. Thiết lập các tùy chọn trong bảng điều khiển:
   - **Tổng slide / Phạm vi chụp**: Kiểm tra tổng số trang (hoặc bấm **Quét lại**). Có thể chụp toàn bộ, từ trang hiện tại, 10 trang mẫu, hoặc nhập số trang bắt đầu - kết thúc tùy ý.
   - **Cơ chế chụp**:
     - Chọn **Chụp Trực Tiếp Tab** để chạy hoàn toàn tự động.
     - Chọn **Siêu Tốc Stream** nếu muốn tốc độ dưới `0.5s/trang` (trình duyệt có thể hiện hộp thoại chọn tab cần chia sẻ ở lần đầu, hãy chọn đúng tab Google Slides hiện tại).
   - **Vùng chụp màn hình**: Chọn **Slide + Phần ghi chú phía dưới**, **Toàn màn hình trình duyệt đang xem**, hoặc **Chỉ khung Slide**.
   - **Tốc độ chụp mỗi slide**: Nhập số giây mong muốn (ví dụ `0.25`, `0.35`, `0.5`, `1.0`) hoặc bấm các nút chọn nhanh.
   - **Tên ảnh & Định dạng**: Chọn quy tắc đánh số file ảnh và định dạng `PNG` hoặc `JPEG`.
   - **Tự ẩn bảng AutoCap lúc chụp**: Giữ nguyên trạng thái bật để bảng điều khiển tự ẩn đi trong lúc lấy khung hình.
4. Bấm **Bắt đầu Chụp Slide & Tải ZIP**.
5. Theo dõi tiến trình:
   - Giữ tab Google Slides ở trạng thái hiển thị trong suốt quá trình chụp.
   - Nếu cần dừng giữa chừng, bấm **Tạm dừng** -> bấm **Tải ZIP đã chụp** để lưu ngay các trang đã chụp được dưới dạng file `.zip`.
   - Khi hoàn tất, file `.zip` mang tên bài trình bày sẽ tự động được tải về thư mục Downloads.

---

## Cấu trúc dự án

```text
autocap/
├── manifest.json            # Cấu hình Chrome Extension (Manifest V3)
├── background.js            # Service Worker: chụp tab, quản lý Offscreen stream và tên file tải về
├── content.js               # Content Script: giao diện nổi, điều hướng slide và nén ZIP
├── content.css              # Giao diện cho bảng điều khiển nổi
├── offscreen.html           # Trang Offscreen ẩn phục vụ chế độ Siêu Tốc Stream
├── offscreen.js             # Xử lý đọc frame từ MediaStream ở tốc độ cao
├── popup/
│   ├── popup.html           # Giao diện popup trên thanh công cụ Chrome
│   ├── popup.css            # CSS cho popup
│   └── popup.js             # Logic điều khiển từ popup
├── lib/
│   ├── jszip.min.js         # Thư viện nén ZIP trực tiếp trên trình duyệt
│   ├── pdf.min.js           # Thư viện đọc PDF (cho chế độ Xuất Vector PDF)
│   └── pdf.worker.min.js    # Worker xử lý PDF
├── icons/                   # Bộ biểu tượng tiện ích (16x16, 48x48, 128x128)
├── bookmarklet.js           # Script hỗ trợ chạy nhanh qua DevTools Console
├── HUONG_DAN_SU_DUNG.html   # Trang hướng dẫn ngoại tuyến
└── README.md                # Tài liệu hướng dẫn cài đặt và sử dụng
```

---

## Quyền truy cập và bảo mật

Tiện ích xử lý toàn bộ hình ảnh và quá trình nén `.zip` cục bộ ngay trên trình duyệt của bạn, không gửi dữ liệu hay ảnh chụp ra máy chủ bên ngoài.

- `activeTab`, `tabs`: Đọc thông tin tab Google Slides hiện tại và chụp khung hình hiển thị của tab.
- `desktopCapture`, `tabCapture`, `offscreen`: Hỗ trợ lấy khung hình liên tục ở tốc độ cao trong chế độ Siêu Tốc Stream.
- `downloads`: Lưu file `.zip` về máy với đúng tên bài trình bày.
- `scripting`: Hỗ trợ giao tiếp và thực thi trên trang Google Slides.

---

## Lưu ý khi sử dụng

- Khi dùng chế độ **Chụp Trực Tiếp Tab** hoặc **Siêu Tốc Stream**, không thu nhỏ hoặc chuyển sang cửa sổ/tab khác để trình duyệt luôn render đúng slide và ghi chú.
- Nếu đặt số giây quá nhỏ (ví dụ `0.05s` - `0.15s`) với các slide có nhiều ảnh nặng, hãy tăng lên `0.3s` - `0.6s` nếu thấy ảnh chụp chưa kịp tải hết nội dung trang mới.
- Sau khi cập nhật phiên bản mới, hãy vào `chrome://extensions/` bấm biểu tượng **Tải lại** (Reload) ở thẻ tiện ích và tải lại tab Google Slides đang mở (`F5`).

