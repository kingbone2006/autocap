document.addEventListener('DOMContentLoaded', async () => {
  const slidesView = document.getElementById('slides-view');
  const notSlidesView = document.getElementById('not-slides-view');
  const slideTitle = document.getElementById('slide-title');
  const slideCount = document.getElementById('slide-count');
  const startBtn = document.getElementById('start-btn');
  const statusMsg = document.getElementById('popup-status');
  const popMode = document.getElementById('pop-mode');
  const popArea = document.getElementById('pop-area');
  const popDelaySec = document.getElementById('pop-delay-sec');
  const popNaming = document.getElementById('pop-naming');
  const popFormat = document.getElementById('pop-format');
  const openSampleBtn = document.getElementById('open-sample-btn');

  // Query active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isGoogleSlides = tab && tab.url && tab.url.includes('docs.google.com/presentation');

  if (!isGoogleSlides) {
    slidesView.style.display = 'none';
    notSlidesView.style.display = 'block';

    openSampleBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://docs.google.com/presentation' });
    });
    return;
  }

  slidesView.style.display = 'block';
  notSlidesView.style.display = 'none';

  // Request info from content script
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'getInfo' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        slideTitle.textContent = (tab.title || 'Google Slides').replace(/\s*-\s*Google\s*Slides.*/i, '');
        slideCount.textContent = 'Sẵn sàng chụp';
        return;
      }

      slideTitle.textContent = response.title || 'Không có tiêu đề';
      slideTitle.title = response.title;
      slideCount.textContent = response.slideCount > 0 ? `${response.slideCount} trang` : 'Tự động nhận diện';

      if (response.isCapturing) {
        startBtn.disabled = true;
        startBtn.textContent = '⏳ Đang tiến hành chụp...';
        statusMsg.textContent = 'Tiến trình chụp đang chạy trên trang!';
      }
    });
  } catch (e) {
    console.error(e);
  }

  // Handle Start Capture click
  startBtn.addEventListener('click', () => {
    const delaySec = Math.max(0.05, parseFloat(popDelaySec.value) || 0.35);
    const options = {
      mode: popMode ? popMode.value : 'screenshot',
      captureArea: popArea ? popArea.value : 'slide_notes',
      delay: Math.round(delaySec * 1000),
      autoHideWidget: true,
      rangeType: 'all',
      namingPattern: popNaming.value,
      format: popFormat.value
    };

    startBtn.disabled = true;
    startBtn.textContent = '⏳ Đang khởi động...';
    statusMsg.textContent = 'Đang tiến hành chụp slide trên trang web...';

    chrome.tabs.sendMessage(tab.id, { action: 'startCapture', options }, (res) => {
      if (chrome.runtime.lastError) {
        statusMsg.textContent = 'Lỗi kết nối trang: Vui lòng tải lại trang slide và thử lại.';
        startBtn.disabled = false;
        startBtn.textContent = '📸 Thử lại';
      } else {
        statusMsg.textContent = 'Đang chụp! Bạn có thể xem thanh tiến trình ở góc dưới slide.';
        // Auto close popup after 1.5s so user can see the main tab
        setTimeout(() => {
          window.close();
        }, 1500);
      }
    });
  });
});
