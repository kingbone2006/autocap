/**
 * AutoCap Google Slides - Standalone Console Script / Bookmarklet
 * Cách dùng: Mở slide Google Slides bất kỳ, nhấn F12 -> chọn tab Console -> dán toàn bộ mã này vào và nhấn Enter!
 */

(async function () {
  console.log('%c[AutoCap Slides] Khởi động tiện ích chụp slide...', 'color: #f59e0b; font-weight: bold; font-size: 14px;');

  // 1. Tải thư viện JSZip nếu trang chưa có
  if (typeof JSZip === 'undefined') {
    console.log('[AutoCap] Đang nạp thư viện JSZip...');
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // 2. Lấy tiêu đề slide và Presentation ID
  const match = window.location.pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  const presentationId = match ? match[1] : null;

  let title = '';
  const inputEl = document.querySelector('input.docs-title-input');
  if (inputEl && inputEl.value && inputEl.value.trim()) {
    title = inputEl.value.trim();
  }
  if (!title) {
    const innerEl = document.querySelector('.docs-title-inner, #docs-title-widget');
    if (innerEl && innerEl.textContent && innerEl.textContent.trim()) {
      title = innerEl.textContent.trim();
    }
  }
  if (!title) {
    title = document.title.replace(/\s*-\s*Google\s*(Slides|Trình\s*bày).*$/i, '').trim();
  }
  const cleanTitle = (title || 'Google_Slides').replace(/[\\/:*?"<>|]/g, '_').trim();
  const zipFilename = `${cleanTitle}.zip`;

  console.log(`%c[AutoCap] Slide: "${cleanTitle}"`, 'color: #10b981; font-weight: bold;');

  // 3. Phương pháp 1: Xuất vector PDF trực tiếp từ máy chủ Google (siêu tốc & siêu nét)
  if (presentationId) {
    try {
      console.log('[AutoCap] Thử phương thức xuất Vector PDF...');
      const resp = await fetch(`/presentation/d/${presentationId}/export/pdf`, { credentials: 'include' });
      if (resp.ok && (resp.headers.get('content-type') || '').includes('application/pdf')) {
        const pdfBlob = await resp.blob();
        console.log('[AutoCap] Đã tải thành công dữ liệu PDF vector gốc! Đang chuyển đổi thành ảnh từng trang...');

        // Nạp PDF.js nếu chưa có
        if (typeof pdfjsLib === 'undefined') {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }

        const pdfData = await pdfBlob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const total = pdf.numPages;
        const zip = new JSZip();

        const pad = total >= 100 ? 3 : (total >= 10 ? 2 : 1);

        for (let i = 1; i <= total; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;

          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          const filename = `${String(i).padStart(pad, '0')}.png`;
          zip.file(filename, blob);
          console.log(`[AutoCap] Đã xuất trang ${i}/${total} (${filename})`);
        }

        console.log('[AutoCap] Đang nén file ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const downloadUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log(`%c[AutoCap] THÀNH CÔNG! Đã tải về file "${zipFilename}"`, 'color: #22c55e; font-size: 16px; font-weight: bold;');
        return;
      }
    } catch (err) {
      console.warn('[AutoCap] Không thể xuất vector PDF, chuyển sang chụp giao diện:', err);
    }
  }

  // Phương pháp 2: Chụp từ giao diện web
  console.log('[AutoCap] Đang chuẩn bị xuất từ giao diện web...');
  alert('Slide này không cho phép xuất PDF trực tiếp. Vui lòng cài đặt Chrome Extension AutoCap Google Slides tại https://github.com/kingbone2006/autocap/releases để chụp màn hình đầy đủ (kèm ghi chú)!');
})();
