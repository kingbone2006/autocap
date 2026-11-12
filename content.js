/**
 * AutoCap Google Slides - Content Script (v2.0.0)
 * Chụp màn hình Google Slides trực tiếp (bao gồm Slide + Ghi chú phía dưới),
 * hỗ trợ tốc độ tùy chỉnh theo giây, luồng Video Stream siêu tốc và tải ZIP từng phần khi tạm dừng.
 */

(function () {
  if (window.__autocap_initialized) return;
  window.__autocap_initialized = true;

  // Global State
  let isCapturing = false;
  let isPaused = false;
  let shouldCancel = false;
  let lastZipBlob = null;
  let lastZipFilename = '';
  let cachedTotalSlides = 0;
  let cachedCurrentSlide = 1;

  // Live partial ZIP state (used for Pause -> Download ZIP so far)
  let activeZip = null;
  let activeZipCount = 0;
  let activeZipStartPage = 1;
  let activeZipLastPage = 0;
  let activeZipTitle = 'Google_Slides';
  let activePreviewObjectUrl = null;
  let streamInterrupted = false;

  // Helpers
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function nextPaintFrames(count = 2) {
    return new Promise((resolve) => {
      let left = count;
      function step() {
        if (--left <= 0) resolve();
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  async function waitWhilePaused() {
    while (isPaused) {
      if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
      await sleep(80);
    }
  }

  async function sleepPausable(ms) {
    if (ms <= 0) {
      if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
      if (isPaused) await waitWhilePaused();
      return;
    }
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
      if (isPaused) {
        await waitWhilePaused();
        return;
      }
      await sleep(Math.min(40, Math.max(0, end - Date.now())));
    }
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sanitizeFilename(name) {
    if (!name) return 'Google_Slides';
    return String(name)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 140) || 'Google_Slides';
  }

  function getPresentationInfo() {
    const match = window.location.pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    const presentationId = match ? match[1] : null;

    let title = '';
    // 1. Try input element in Google Slides
    const inputEl = document.querySelector('input.docs-title-input');
    if (inputEl && inputEl.value && inputEl.value.trim()) {
      title = inputEl.value.trim();
    }
    // 2. Try title inner content
    if (!title) {
      const innerEl = document.querySelector('.docs-title-inner, #docs-title-widget');
      if (innerEl && innerEl.textContent && innerEl.textContent.trim()) {
        title = innerEl.textContent.trim();
      }
    }
    // 3. Fallback to document.title
    if (!title) {
      title = document.title || 'Google_Slides';
      title = title.replace(/\s*-\s*Google\s*(Slides|Trình\s*bày).*$/i, '').trim();
    }

    title = sanitizeFilename(title) || 'Google_Slides_' + (presentationId || 'Export');
    return { presentationId, title };
  }

  function formatFilename(index, total, pattern, format) {
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const padLength = total >= 1000 ? 4 : (total >= 100 ? 3 : (total >= 10 ? 2 : 1));
    const padded = String(index).padStart(padLength, '0');
    const raw = String(index);

    switch (pattern) {
      case 'padded':
        return `${padded}.${ext}`;
      case 'raw':
        return `${raw}.${ext}`;
      case 'slide_padded':
        return `Slide_${padded}.${ext}`;
      case 'trang_padded':
        return `Trang_${padded}.${ext}`;
      default:
        return `${padded}.${ext}`;
    }
  }

  // Safe Click that works on HTML & SVG Elements
  function safeClick(element) {
    if (!element) return;
    try {
      if (typeof element.click === 'function') {
        element.click();
      }
    } catch (e) {
      // SVGElement might not support .click() directly
    }

    const rect = element.getBoundingClientRect();
    const evtOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    element.dispatchEvent(new MouseEvent('mousedown', evtOptions));
    element.dispatchEvent(new MouseEvent('mouseup', evtOptions));
    element.dispatchEvent(new MouseEvent('click', evtOptions));
  }
  // Slide DOM and Viewport Detection
  function findSlideOnlyBoundingBox() {
    const workspace = document.querySelector('#workspace-container, #workspace');
    if (workspace) {
      const svgs = workspace.querySelectorAll('svg');
      let bestSvg = null;
      let maxArea = 0;
      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (rect.width > 300 && rect.height > 180 && area > maxArea) {
          const aspect = rect.width / rect.height;
          if (aspect >= 1.05 && aspect <= 2.4) {
            maxArea = area;
            bestSvg = rect;
          }
        }
      }
      if (bestSvg) return bestSvg;

      const canvases = workspace.querySelectorAll('canvas');
      for (const cvs of canvases) {
        const rect = cvs.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 180) {
          return rect;
        }
      }

      const pages = workspace.querySelectorAll('.punch-viewer-svgpage, .punch-workspace-svg');
      for (const p of pages) {
        const rect = p.getBoundingClientRect();
        if (rect.width > 280 && rect.height > 160) {
          return rect;
        }
      }
    }

    const viewer = document.querySelector('.punch-viewer-page-viewport, .punch-viewer-content, .punch-viewer-svgpage');
    if (viewer) {
      const rect = viewer.getBoundingClientRect();
      if (rect.width > 280 && rect.height > 160) {
        return rect;
      }
    }

    if (workspace) {
      const rect = workspace.getBoundingClientRect();
      if (rect.width > 280 && rect.height > 160) return rect;
    }

    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function findSlideWithNotesBoundingBox() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const workspace = document.querySelector('#workspace-container, #workspace, .punch-viewer-container, .punch-viewer-page-viewport');

    if (!workspace) {
      return { left: 0, top: 0, width: vw, height: vh };
    }

    const wsRect = workspace.getBoundingClientRect();
    if (wsRect.width < 250 || wsRect.height < 150) {
      return { left: 0, top: 0, width: vw, height: vh };
    }

    let left = wsRect.left;
    let top = wsRect.top;
    let right = wsRect.right;
    let bottom = wsRect.bottom;

    // 1. Check explicit speaker notes containers
    const notesSelectors = [
      '#speakernotes-workspace',
      '#speakernotes-container',
      '#speakernotes',
      '.punch-speakernotes-container',
      '[id*="speakernotes" i]',
      '[aria-label*="ghi chú" i]',
      '[aria-label*="speaker notes" i]'
    ];
    const notesNodes = document.querySelectorAll(notesSelectors.join(', '));
    for (const el of notesNodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height >= 12 && r.top >= wsRect.bottom - 40 && r.left >= wsRect.left - 40) {
        bottom = Math.max(bottom, r.bottom);
        right = Math.max(right, Math.min(vw, r.right));
      }
    }

    // 2. Check sibling elements inside the same right-hand editor column
    const parent = workspace.parentElement;
    if (parent && parent !== document.body) {
      const pRect = parent.getBoundingClientRect();
      if (pRect.width >= wsRect.width - 25 && Math.abs(pRect.left - wsRect.left) <= 35 && pRect.bottom <= vh + 4) {
        for (const child of parent.children) {
          if (child === workspace) continue;
          const r = child.getBoundingClientRect();
          if (r.width >= wsRect.width * 0.5 && r.height >= 10 && r.top >= wsRect.bottom - 20 && r.bottom <= vh + 4) {
            bottom = Math.max(bottom, r.bottom);
            right = Math.max(right, Math.min(vw, r.right));
          }
        }
      }
    }

    // 3. Fallback: if speaker notes area below workspace exists visually down to bottom of viewport
    if (bottom <= wsRect.bottom + 20 && vh - wsRect.bottom > 32 && wsRect.top > 40) {
      bottom = vh;
    } else {
      bottom = Math.min(vh, bottom + 4);
    }

    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(vw, right);
    bottom = Math.min(vh, bottom);

    const width = right - left;
    const height = bottom - top;
    if (width < 250 || height < 150) {
      return { left: 0, top: 0, width: vw, height: vh };
    }

    return { left, top, width, height };
  }

  function findCaptureBoundingBox(captureArea) {
    if (captureArea === 'full_tab') {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    if (captureArea === 'slide_only') {
      return findSlideOnlyBoundingBox();
    }
    return findSlideWithNotesBoundingBox();
  }

// Precision Slide Number Badges Scanner
  // Finds the leaf elements showing slide numbers (e.g. 495, 496... 501)
  function getSlideNumberElements() {
    const result = [];
    const maxLeft = 140;

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length === 0 && el.textContent) {
        const text = el.textContent.trim();
        if (/^\d{1,4}$/.test(text)) {
          const rect = el.getBoundingClientRect();
          if (rect.left >= 0 && rect.left < maxLeft && rect.width > 4 && rect.width < 60 && rect.height > 5 && rect.height < 50) {
            const num = parseInt(text, 10);
            if (num >= 1 && num <= 3000) {
              result.push({ el, num, top: rect.top, height: rect.height });
            }
          }
        }
      }
    }

    result.sort((a, b) => a.top - b.top);

    const valid = [];
    for (let i = 0; i < result.length; i++) {
      const prev = result[i - 1];
      const next = result[i + 1];
      if ((prev && Math.abs(result[i].num - prev.num) === 1) ||
          (next && Math.abs(next.num - result[i].num) === 1) ||
          result.length === 1) {
        valid.push(result[i]);
      }
    }

    return valid.length > 0 ? valid : result;
  }

  // Find the true filmstrip scroll container
  function findFilmstripScrollContainer() {
    const items = getSlideNumberElements();
    if (items.length > 0) {
      let p = items[0].el.parentElement;
      while (p && p !== document.body) {
        if (p.scrollHeight > p.clientHeight + 40 && p.clientHeight > 200) {
          return p;
        }
        p = p.parentElement;
      }
    }

    const known = document.querySelector('.punch-filmstrip-scroll-container, .filmstrip-scroller, .docs-filmstrip, [role="tablist"], [aria-label*="filmstrip" i]');
    if (known && known.scrollHeight > known.clientHeight + 30) return known;

    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const r = div.getBoundingClientRect();
      if (r.left < 80 && r.width >= 80 && r.width <= 340 && r.height > 300) {
        if (div.scrollHeight > div.clientHeight + 40) {
          return div;
        }
      }
    }

    return null;
  }

  function getThumbnailItemHeight() {
    const items = getSlideNumberElements();
    if (items.length >= 2) {
      const diff = Math.abs(items[1].top - items[0].top);
      if (diff >= 40 && diff <= 160) {
        return diff;
      }
    }
    return 80;
  }

  function getFilmstripMetrics() {
    const filmstrip = findFilmstripScrollContainer();
    const itemHeight = getThumbnailItemHeight();
    return {
      itemHeight: itemHeight,
      totalHeight: filmstrip ? filmstrip.scrollHeight : 0
    };
  }

  // Accurate Total Slides Detection based strictly on slide number badges
  async function detectTotalSlides() {
    const filmstrip = findFilmstripScrollContainer();
    const itemHeight = getThumbnailItemHeight();

    // 1. Numbers currently visible on screen
    const initialItems = getSlideNumberElements();
    let maxFound = initialItems.length > 0 ? Math.max(...initialItems.map(x => x.num)) : 1;

    // 2. Scroll filmstrip to bottom to discover true total
    if (filmstrip) {
      const originalScrollTop = filmstrip.scrollTop;
      filmstrip.scrollTop = filmstrip.scrollHeight;
      await sleep(300);

      const bottomItems = getSlideNumberElements();
      if (bottomItems.length > 0) {
        const bottomMax = Math.max(...bottomItems.map(x => x.num));
        maxFound = Math.max(maxFound, bottomMax);
      }

      const totalByScroll = Math.round(filmstrip.scrollHeight / itemHeight);
      if (totalByScroll > 0 && totalByScroll < 2500) {
        maxFound = Math.max(maxFound, totalByScroll);
      }

      filmstrip.scrollTop = originalScrollTop;
      await sleep(100);
    }

    // 3. Fallback to bottom navbar if in preview mode
    const pageNav = document.querySelector('.punch-viewer-navbar-page');
    if (pageNav && pageNav.textContent) {
      const m = pageNav.textContent.match(/\/\s*(\d+)/);
      if (m) maxFound = Math.max(maxFound, parseInt(m[1], 10));
    }

    cachedTotalSlides = maxFound;
    return maxFound;
  }

  function detectCurrentSlideNumber() {
    const filmstrip = findFilmstripScrollContainer() || document;

    const selected = filmstrip.querySelector('[aria-selected="true"], .punch-filmstrip-thumbnail-selected, .filmstrip-thumbnail-selected');
    if (selected) {
      const aria = selected.getAttribute('aria-label');
      if (aria) {
        const m = aria.match(/(?:Slide|Trang|Page)\s*(\d+)/i);
        if (m) return parseInt(m[1], 10);
      }
      const txt = selected.textContent.trim();
      const m2 = txt.match(/\b(\d{1,4})\b/);
      if (m2) return parseInt(m2[1], 10);
    }

    const items = getSlideNumberElements();
    if (items.length > 0) {
      const midY = window.innerHeight / 2;
      let closest = items[0];
      let minDiff = Math.abs(items[0].top - midY);
      for (const it of items) {
        const diff = Math.abs(it.top - midY);
        if (diff < minDiff) {
          minDiff = diff;
          closest = it;
        }
      }
      return closest.num;
    }

    return 1;
  }

  function findSlideItemInFilmstrip(targetPageNum) {
    const filmstrip = findFilmstripScrollContainer() || document;

    const exactAria = filmstrip.querySelector(
      `[aria-label="Slide ${targetPageNum}" i], [aria-label="Trang ${targetPageNum}" i], [aria-label="Page ${targetPageNum}" i]`
    );
    if (exactAria) return exactAria;

    const ariaMatcher = new RegExp(`^\\s*(?:Slide|Trang|Page)?\\s*${targetPageNum}(?!\\d)\\b`, 'i');
    const ariaCandidates = filmstrip.querySelectorAll('[aria-label]');
    for (const el of ariaCandidates) {
      const label = el.getAttribute('aria-label') || '';
      if (ariaMatcher.test(label)) return el;
    }

    const targetStr = String(targetPageNum);
    const allNodes = filmstrip.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.children.length === 0 && node.textContent && node.textContent.trim() === targetStr) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 70 && rect.left >= 0 && rect.left < 180) {
          const card = node.closest('[role="tab"], [role="option"], .punch-filmstrip-thumbnail, .filmstrip-thumbnail') || node.parentElement;
          return card || node;
        }
      }
    }
    return null;
  }

  function advanceNextSlideViaKeyboard() {
    const target =
      findFilmstripScrollContainer() ||
      document.querySelector('#workspace-container, #workspace') ||
      document.activeElement ||
      document.body;

    if (!target) return;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true, cancelable: true, view: window }));
  }

  // Crop screenshot image to capture region (fast, DPI & zoom accurate)
  async function cropScreenshot(dataUrl, rect, format, captureArea) {
    const isJpeg = format === 'jpeg';
    if (captureArea === 'full_tab') {
      const resp = await fetch(dataUrl);
      const rawBlob = await resp.blob();
      const targetMime = isJpeg ? 'image/jpeg' : 'image/png';
      if (rawBlob.type === targetMime) {
        return { blob: rawBlob };
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
        const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);

        const cropX = Math.max(0, Math.round(rect.left * scaleX));
        const cropY = Math.max(0, Math.round(rect.top * scaleY));
        const cropW = Math.min(img.naturalWidth - cropX, Math.round(rect.width * scaleX));
        const cropH = Math.min(img.naturalHeight - cropY, Math.round(rect.height * scaleY));

        if (cropW <= 0 || cropH <= 0) {
          return reject(new Error('Kích thước vùng chụp không hợp lệ.'));
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const mime = isJpeg ? 'image/jpeg' : 'image/png';
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Lỗi chuyển đổi canvas sang Blob'));
          resolve({ blob });
        }, mime, isJpeg ? 0.94 : undefined);
      };
      img.onerror = () => reject(new Error('Lỗi tải hình ảnh chụp màn hình'));
      img.src = dataUrl;
    });
  }

  // Engine 1: Vector PDF Export + Render via PDF.js
  async function runVectorPdfEngine(presentationId, title, options, onProgress) {
    onProgress({
      stage: 'STARTING',
      percent: 5,
      message: 'Đang kiểm tra quyền xuất vector PDF từ máy chủ Google...'
    });

    const exportUrl = `/presentation/d/${presentationId}/export/pdf`;
    let pdfData;
    try {
      const resp = await fetch(exportUrl, { credentials: 'include' });
      if (!resp.ok) {
        console.warn('PDF export endpoint not available (HTTP ' + resp.status + ')');
        return null;
      }
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/pdf')) {
        console.warn('PDF export returned non-PDF response:', ct);
        return null;
      }
      pdfData = await resp.arrayBuffer();
    } catch (e) {
      console.warn('Fetch PDF error:', e);
      return null;
    }

    if (!pdfData || pdfData.byteLength < 1000) {
      return null;
    }

    onProgress({
      stage: 'PARSING',
      percent: 15,
      message: 'Đã nhận file PDF vector gốc. Bắt đầu phân tích các trang...'
    });

    if (typeof pdfjsLib !== 'undefined') {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
      } catch (err) {
        console.warn('pdfjs workerSrc config warning:', err);
      }
    }

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    const startPage = Math.max(1, Math.min(totalPages, options.startPage || 1));
    const endPage = Math.max(startPage, Math.min(totalPages, options.endPage || totalPages));
    const rangeCount = endPage - startPage + 1;

    const zip = new JSZip();
    const scale = options.scale || 2.0;

    activeZip = zip;
    activeZipCount = 0;
    activeZipStartPage = startPage;
    activeZipLastPage = startPage - 1;
    activeZipTitle = title;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
      if (isPaused) await waitWhilePaused();

      const currentProgressIndex = pageNum - startPage + 1;
      const percent = Math.round(15 + ((currentProgressIndex - 1) / rangeCount) * 75);

      onProgress({
        stage: 'RENDERING',
        current: pageNum,
        total: totalPages,
        percent: percent,
        message: `Đang kết xuất vector siêu nét: Trang ${pageNum}/${totalPages}...`
      });

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const mime = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.94));

      const filename = formatFilename(pageNum, totalPages, options.namingPattern, options.format);
      zip.file(filename, blob);
      activeZipCount++;
      activeZipLastPage = pageNum;
      updatePauseDownloadButton();

      onProgress({
        stage: 'RENDERING',
        current: pageNum,
        total: totalPages,
        percent: Math.round(15 + (currentProgressIndex / rangeCount) * 75),
        previewBlob: blob,
        message: `Đã kết xuất xong trang ${pageNum}/${totalPages}`
      });
    }

    onProgress({
      stage: 'ZIPPING',
      percent: 92,
      message: 'Đang nén các ảnh vào file .ZIP...'
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      onProgress({
        stage: 'ZIPPING',
        percent: Math.round(92 + (metadata.percent * 0.08)),
        message: `Đang nén ZIP: ${Math.round(metadata.percent)}%`
      });
    });

    return { zipBlob, totalPages: rangeCount, mode: 'vector' };
  }

  async function navigateToSlide(p, filmstrip, itemHeight) {
    let slideItem = findSlideItemInFilmstrip(p);

    if (!slideItem && filmstrip) {
      const visibleNums = getSlideNumberElements();
      if (visibleNums.length >= 2) {
        const avgVisible = (visibleNums[0].num + visibleNums[visibleNums.length - 1].num) / 2;
        if (Math.abs(p - avgVisible) <= 25) {
          filmstrip.scrollTop = Math.max(0, filmstrip.scrollTop + (p - avgVisible) * itemHeight);
        } else {
          filmstrip.scrollTop = Math.max(0, (p - 1) * itemHeight - 140);
        }
      } else {
        filmstrip.scrollTop = Math.max(0, (p - 1) * itemHeight - 140);
      }

      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(25);
        slideItem = findSlideItemInFilmstrip(p);
        if (slideItem) break;
      }

      if (!slideItem) {
        filmstrip.scrollTop = Math.max(0, (p - 1) * itemHeight - 140);
        await sleep(60);
        slideItem = findSlideItemInFilmstrip(p);
      }
    }

    if (slideItem) {
      if (filmstrip) {
        const itemRect = slideItem.getBoundingClientRect();
        const fsRect = filmstrip.getBoundingClientRect();
        if (itemRect.top < fsRect.top || itemRect.bottom > fsRect.bottom) {
          slideItem.scrollIntoView({ block: 'nearest' });
        }
      }
      safeClick(slideItem);
      return true;
    }

    return false;
  }

  async function captureSingleFrame(options, stateObj) {
    const captureArea = options.captureArea || 'slide_notes';
    const autoHideWidget = options.autoHideWidget !== false;

    try {
      if (autoHideWidget && widgetElements && widgetElements.root) {
        widgetElements.root.style.transition = 'none';
        widgetElements.root.style.opacity = '0';
        await nextPaintFrames(2);
      }

      const rect = findCaptureBoundingBox(captureArea);

      if (stateObj.useStream && !streamInterrupted) {
        const vw = Math.max(1, window.innerWidth);
        const vh = Math.max(1, window.innerHeight);
        const cropRatio = {
          x: Math.max(0, Math.min(1, rect.left / vw)),
          y: Math.max(0, Math.min(1, rect.top / vh)),
          w: Math.max(0.01, Math.min(1, rect.width / vw)),
          h: Math.max(0.01, Math.min(1, rect.height / vh))
        };
        const frameRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'grabStreamFrame',
            cropRatio,
            format: options.format,
            quality: 0.94
          }, resolve);
        });
        if (frameRes && frameRes.success && frameRes.dataUrl) {
          const resp = await fetch(frameRes.dataUrl);
          return await resp.blob();
        }
        stateObj.useStream = false;
      }

      const captureFmt = options.format === 'jpeg' ? 'jpeg' : 'png';
      const captureResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'captureVisibleTab',
          format: captureFmt,
          quality: 95
        }, resolve);
      });

      if (!captureResponse || !captureResponse.success) {
        const errDetail = (captureResponse && captureResponse.error) ? ` (${captureResponse.error})` : '';
        throw new Error(`Không thể chụp màn hình tab${errDetail}. Hãy đảm bảo tab đang hiển thị và thử lại.`);
      }

      const cropped = await cropScreenshot(captureResponse.dataUrl, rect, options.format, captureArea);
      return cropped.blob;
    } finally {
      if (autoHideWidget && widgetElements && widgetElements.root) {
        widgetElements.root.style.opacity = '1';
      }
    }
  }

  // Engine 2: Real Browser Screen Auto-Capture Engine (captureVisibleTab or Turbo Video Stream)
  async function runScreenCaptureEngine(presentationId, title, options, onProgress) {
    onProgress({ stage: 'PREPARING', percent: 4, message: 'Đang chuẩn bị chụp màn hình...' });

    const filmstrip = findFilmstripScrollContainer();
    const { itemHeight } = getFilmstripMetrics();
    const totalSlides = options.totalSlides || cachedTotalSlides || 500;
    const startPage = Math.max(1, Math.min(totalSlides, options.startPage || 1));
    const endPage = Math.max(startPage, Math.min(totalSlides, options.endPage || totalSlides));
    const rangeCount = endPage - startPage + 1;
    const delay = Math.max(50, options.delay || 350);
    const zip = new JSZip();

    activeZip = zip;
    activeZipCount = 0;
    activeZipStartPage = startPage;
    activeZipLastPage = startPage - 1;
    activeZipTitle = title;

    const streamState = { useStream: options.mode === 'stream' };
    streamInterrupted = false;

    if (streamState.useStream) {
      onProgress({
        stage: 'PREPARING',
        percent: 5,
        message: 'Đang mở luồng Video Stream siêu tốc (chọn Tab này nếu trình duyệt hỏi)...'
      });
      const streamRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'startTabStreamCapture' }, resolve);
      });
      if (!streamRes || !streamRes.success) {
        streamState.useStream = false;
        onProgress({
          stage: 'PREPARING',
          percent: 6,
          message: 'Đã chuyển sang Chụp Tab Trực Tiếp (tự động, siêu nét)...'
        });
        await sleep(250);
      }
    }

    let capturedCount = 0;

    try {
      for (let p = startPage; p <= endPage; p++) {
        if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
        if (isPaused) await waitWhilePaused();

        const currentProgressIndex = p - startPage + 1;
        const percent = Math.min(95, Math.round(((currentProgressIndex - 1) / rangeCount) * 90) + 5);

        onProgress({
          stage: 'NAVIGATING',
          current: p,
          total: totalSlides,
          percent: percent,
          message: `Đang chuyển sang slide ${p}/${totalSlides}...`
        });

        const clicked = await navigateToSlide(p, filmstrip, itemHeight);
        if (!clicked && p > startPage) {
          advanceNextSlideViaKeyboard();
        }

        await sleepPausable(delay);

        if (shouldCancel) throw new Error('Người dùng đã hủy quá trình chụp.');
        if (isPaused) await waitWhilePaused();

        onProgress({
          stage: 'CAPTURING',
          current: p,
          total: totalSlides,
          message: `Đang chụp slide ${p}/${totalSlides}...`
        });

        const slideBlob = await captureSingleFrame(options, streamState);
        const filename = formatFilename(p, totalSlides, options.namingPattern, options.format);
        zip.file(filename, slideBlob);
        capturedCount++;
        activeZipCount = capturedCount;
        activeZipLastPage = p;
        updatePauseDownloadButton();

        onProgress({
          stage: 'CAPTURED',
          current: p,
          total: totalSlides,
          percent: Math.min(95, Math.round((currentProgressIndex / rangeCount) * 90) + 5),
          previewBlob: slideBlob,
          message: isPaused
            ? `⏸ Đang tạm dừng — đã chụp ${capturedCount} ảnh (Trang ${startPage}–${p})`
            : `Đã chụp xong slide ${p}/${totalSlides} (${capturedCount}/${rangeCount})`
        });
      }
    } finally {
      if (options.mode === 'stream') {
        chrome.runtime.sendMessage({ action: 'stopTabStreamCapture' }).catch(() => {});
      }
    }

    if (capturedCount === 0) {
      throw new Error('Không chụp được slide nào. Vui lòng kiểm tra lại trang trình bày.');
    }

    onProgress({ stage: 'ZIPPING', percent: 96, message: `Đang đóng gói ${capturedCount} ảnh vào file .ZIP...` });

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      onProgress({
        stage: 'ZIPPING',
        percent: Math.round(96 + (metadata.percent * 0.04)),
        message: `Đang nén ZIP: ${Math.round(metadata.percent)}%`
      });
    });

    return { zipBlob, totalPages: capturedCount, mode: streamState.useStream ? 'stream' : 'screenshot' };
  }

  // Trigger Download of ZIP file (same-origin <a download> + onDeterminingFilename enforcement)
  async function triggerDownload(zipBlob, filename) {
    const safeName = filename && filename.toLowerCase().endsWith('.zip') ? filename : `${filename || 'Google_Slides'}.zip`;
    lastZipBlob = zipBlob;
    lastZipFilename = safeName;

    const blobUrl = URL.createObjectURL(zipBlob);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);

    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'registerDownloadFilename',
          url: blobUrl,
          filename: safeName
        }, resolve);
      });
    } catch (e) {}

    // 1. Primary: same-origin <a download> preserves exact filename in Chromium
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 2. Verify Chrome created the download; if blocked without gesture, fallback to chrome.downloads
    await sleep(450);
    try {
      const check = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'wasDownloadCreated', url: blobUrl }, resolve);
      });
      if (check && check.created) return;
    } catch (e) {}

    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'downloadZip',
          url: blobUrl,
          filename: safeName,
          saveAs: false
        }, resolve);
      });
    } catch (e) {
      console.warn('Fallback background download error:', e);
    }
  }

  // Unified Workflow Runner
  async function startCaptureWorkflow(userOptions) {
    if (isCapturing) return;
    isCapturing = true;
    isPaused = false;
    shouldCancel = false;
    activeZip = null;
    activeZipCount = 0;
    activeZipLastPage = 0;

    const { presentationId, title } = getPresentationInfo();
    const zipFilename = `${title}.zip`;

    updateUIState('CAPTURING');

    const totalSlides = parseInt(userOptions.totalOverride || '0', 10) || cachedTotalSlides || (await detectTotalSlides());
    let startPage = 1;
    let endPage = totalSlides;

    if (userOptions.rangeType === 'current') {
      startPage = cachedCurrentSlide || detectCurrentSlideNumber();
      endPage = totalSlides;
    } else if (userOptions.rangeType === 'custom') {
      startPage = parseInt(userOptions.customStart || '1', 10);
      endPage = parseInt(userOptions.customEnd || String(totalSlides), 10);
    }

    startPage = Math.max(1, Math.min(totalSlides, startPage));
    endPage = Math.max(startPage, Math.min(totalSlides, endPage));

    const reqMode = userOptions.mode || 'screenshot';
    const options = {
      mode: reqMode === 'auto' ? 'screenshot' : reqMode,
      captureArea: userOptions.captureArea || 'slide_notes',
      autoHideWidget: userOptions.autoHideWidget !== false,
      format: userOptions.format || 'png',
      namingPattern: userOptions.namingPattern || 'padded',
      delay: Math.max(50, parseInt(userOptions.delay || '350', 10)),
      scale: 2.0,
      totalSlides: totalSlides,
      startPage: startPage,
      endPage: endPage
    };

    try {
      let result = null;

      if (options.mode === 'vector') {
        result = await runVectorPdfEngine(presentationId, title, options, updateProgress);
      } else {
        result = await runScreenCaptureEngine(presentationId, title, options, updateProgress);
      }

      if (!result || !result.zipBlob) {
        throw new Error('Không thể tạo file ZIP chứa slide.');
      }

      updateProgress({
        stage: 'DOWNLOADING',
        percent: 100,
        message: `Đang lưu file "${zipFilename}" về máy...`
      });

      await triggerDownload(result.zipBlob, zipFilename);

      updateUIState('SUCCESS', {
        filename: zipFilename,
        count: result.totalPages,
        mode: result.mode
      });
    } catch (err) {
      console.error('AutoCap error:', err);
      updateUIState('ERROR', { error: err.message || 'Đã có lỗi xảy ra trong quá trình chụp.' });
    } finally {
      isCapturing = false;
      isPaused = false;
      shouldCancel = false;
      updatePauseDownloadButton();
    }
  }

  // UI State & Management
  let widgetElements = null;

  function updatePauseDownloadButton() {
    if (!widgetElements || !widgetElements.pauseDownloadBtn) return;
    const btn = widgetElements.pauseDownloadBtn;
    if (isPaused && activeZip && activeZipCount > 0) {
      btn.style.display = 'block';
      btn.disabled = false;
      btn.textContent = `⬇ Tải ZIP đã chụp (${activeZipCount} ảnh: Trang ${activeZipStartPage}–${activeZipLastPage})`;
    } else if (!isCapturing && activeZip && activeZipCount > 0 && btn.dataset.keepOnError === '1') {
      btn.style.display = 'block';
      btn.disabled = false;
      btn.textContent = `⬇ Tải ${activeZipCount} ảnh đã chụp (.ZIP)`;
    } else {
      btn.style.display = 'none';
    }
  }

  async function downloadActivePartialZip() {
    if (!activeZip || activeZipCount === 0 || !widgetElements) return;
    const btn = widgetElements.pauseDownloadBtn;
    btn.disabled = true;
    btn.textContent = `⏳ Đang nén ${activeZipCount} ảnh vào .ZIP...`;
    try {
      const partialBlob = await activeZip.generateAsync({ type: 'blob' });
      const partialName = `${activeZipTitle}_trang_${activeZipStartPage}-${activeZipLastPage}_(${activeZipCount}_anh).zip`;
      await triggerDownload(partialBlob, partialName);
      btn.textContent = `✓ Đã tải ${activeZipCount} ảnh (.ZIP) — Bấm tải lại`;
    } catch (err) {
      btn.textContent = `❌ Lỗi nén ZIP: ${err.message || err}`;
    } finally {
      setTimeout(() => {
        if (btn) btn.disabled = false;
      }, 400);
    }
  }

  function updateProgress(data) {
    if (!widgetElements) return;
    const { progressContainer, progressBarFill, progressPercent, progressStatus, previewThumb, previewWrap } = widgetElements;

    progressContainer.classList.add('autocap-active');
    if (data.percent !== undefined) {
      progressBarFill.style.width = `${data.percent}%`;
      progressPercent.textContent = `${data.percent}%`;
    }
    if (data.message) {
      progressStatus.textContent = data.message;
    }
    if (data.previewBlob) {
      if (activePreviewObjectUrl) {
        URL.revokeObjectURL(activePreviewObjectUrl);
      }
      activePreviewObjectUrl = URL.createObjectURL(data.previewBlob);
      previewWrap.style.display = 'flex';
      previewThumb.src = activePreviewObjectUrl;
    } else if (data.previewUrl) {
      previewWrap.style.display = 'flex';
      previewThumb.src = data.previewUrl;
    }
  }

  function updateUIState(state, meta = {}) {
    if (!widgetElements) return;
    const { startBtn, progressContainer, successCard, successTitle, successDesc, pauseBtn, pauseDownloadBtn } = widgetElements;

    if (state === 'IDLE') {
      startBtn.disabled = false;
      startBtn.textContent = '📸 Bắt đầu Chụp Slide & Tải ZIP';
      progressContainer.classList.remove('autocap-active');
      successCard.classList.remove('autocap-active');
      if (pauseDownloadBtn) {
        pauseDownloadBtn.dataset.keepOnError = '0';
        pauseDownloadBtn.style.display = 'none';
      }
    } else if (state === 'CAPTURING') {
      startBtn.disabled = true;
      startBtn.textContent = '⏳ Đang tiến hành chụp slide...';
      successCard.classList.remove('autocap-active');
      progressContainer.classList.add('autocap-active');
      pauseBtn.textContent = '⏸ Tạm dừng';
      if (pauseDownloadBtn) {
        pauseDownloadBtn.dataset.keepOnError = '0';
        pauseDownloadBtn.style.display = 'none';
      }
    } else if (state === 'SUCCESS') {
      startBtn.disabled = false;
      startBtn.textContent = '📸 Chụp lại slide';
      progressContainer.classList.remove('autocap-active');
      successCard.classList.add('autocap-active');
      successTitle.textContent = '🎉 Đã hoàn tất tải về!';
      successDesc.textContent = `Đã lưu "${meta.filename}" (${meta.count} ảnh) vào thư mục tải về của bạn.`;
      if (pauseDownloadBtn) {
        pauseDownloadBtn.dataset.keepOnError = '0';
        pauseDownloadBtn.style.display = 'none';
      }
    } else if (state === 'ERROR') {
      startBtn.disabled = false;
      startBtn.textContent = '📸 Thử lại';
      progressContainer.classList.add('autocap-active');
      widgetElements.progressStatus.textContent = '❌ ' + meta.error;
      if (pauseDownloadBtn) {
        pauseDownloadBtn.dataset.keepOnError = activeZipCount > 0 ? '1' : '0';
      }
      updatePauseDownloadButton();
    }
  }

  function injectFloatingWidget() {
    if (document.getElementById('autocap-root')) return;

    const info = getPresentationInfo();

    const root = document.createElement('div');
    root.id = 'autocap-root';
    root.innerHTML = `
      <button class="autocap-launcher" id="autocap-launcher-btn" title="Mở tiện ích chụp slide">
        <svg viewBox="0 0 24 24"><path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>
        <span>Chụp Slide</span>
        <span class="autocap-badge" id="autocap-badge-count">AutoCap</span>
      </button>

      <div class="autocap-panel" id="autocap-panel">
        <div class="autocap-header">
          <div class="autocap-title-group">
            <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            <h3>AutoCap Slides (v2.0)</h3>
          </div>
          <button class="autocap-close-btn" id="autocap-close-btn" title="Đóng">✕</button>
        </div>

        <div class="autocap-body">
          <div class="autocap-info-box">
            <div class="autocap-info-row">
              <span class="autocap-info-label">Tên Slide:</span>
              <span class="autocap-info-value" id="autocap-info-title" title="${info.title}">${info.title}</span>
            </div>
            <div class="autocap-info-row" style="align-items: center; justify-content: space-between;">
              <div style="display:flex; align-items:center; gap: 4px;">
                <span class="autocap-info-label">Tổng slide:</span>
                <input type="number" id="autocap-input-total" class="autocap-input" value="1" min="1" style="width: 70px; padding: 2px 6px; height: 24px; font-weight:700; font-size:13px; text-align:center;">
                <span style="font-size:12px; color:#64748b;">trang</span>
              </div>
              <button id="autocap-rescan-btn" style="background:#fef3c7; border:1px solid #f59e0b; color:#92400e; padding:3px 8px; border-radius:6px; font-size:11px; cursor:pointer; font-weight:600;">🔄 Quét lại</button>
            </div>
          </div>

          <div class="autocap-form-group">
            <label>Phạm vi chụp:</label>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
              <span style="font-size:12px; color:#475569; font-weight:600;">Từ trang:</span>
              <input type="number" id="autocap-custom-start" class="autocap-input" value="1" min="1" style="width: 70px; padding:4px 6px; text-align:center;">
              <span style="font-size:12px; color:#475569; font-weight:600;">Đến trang:</span>
              <input type="number" id="autocap-custom-end" class="autocap-input" value="1" min="1" style="width: 70px; padding:4px 6px; text-align:center;">
            </div>
            <div style="display:flex; gap: 4px;">
              <button type="button" id="autocap-btn-range-all" class="autocap-btn-small" style="font-size:10.5px; padding:3px 6px;">Toàn bộ</button>
              <button type="button" id="autocap-btn-range-cur" class="autocap-btn-small" style="font-size:10.5px; padding:3px 6px;">Từ trang này</button>
              <button type="button" id="autocap-btn-range-10" class="autocap-btn-small" style="font-size:10.5px; padding:3px 6px;">10 trang mẫu</button>
            </div>
          </div>

          <div class="autocap-form-group">
            <label>Cơ chế chụp:</label>
            <select class="autocap-select" id="autocap-opt-mode">
              <option value="screenshot" selected>📸 Chụp Trực Tiếp Tab (Tự động 1-click, siêu nét)</option>
              <option value="stream">⚡ Siêu Tốc Stream (0.1s–0.4s/trang, chọn Tab 1 lần)</option>
              <option value="vector">📄 Xuất Vector PDF (Chỉ Slide, không ghi chú)</option>
            </select>
          </div>

          <div class="autocap-form-group">
            <label>Vùng chụp màn hình:</label>
            <select class="autocap-select" id="autocap-opt-area">
              <option value="slide_notes" selected>📝 Slide + Phần ghi chú phía dưới</option>
              <option value="full_tab">🖥 Toàn màn hình trình duyệt đang xem</option>
              <option value="slide_only">🖼 Chỉ khung Slide (Bỏ ghi chú)</option>
            </select>
          </div>

          <div class="autocap-form-group">
            <label>Tốc độ chụp mỗi slide (tự nhập số giây):</label>
            <div class="autocap-speed-input-row">
              <input type="number" id="autocap-opt-delay-sec" class="autocap-input" value="0.35" min="0.05" max="30" step="0.05">
              <span class="autocap-speed-unit">giây / trang</span>
            </div>
            <div class="autocap-speed-chips" id="autocap-speed-chips">
              <button type="button" class="autocap-chip-btn" data-sec="0.15">0.15s</button>
              <button type="button" class="autocap-chip-btn" data-sec="0.3">0.3s</button>
              <button type="button" class="autocap-chip-btn" data-sec="0.5">0.5s</button>
              <button type="button" class="autocap-chip-btn" data-sec="0.8">0.8s</button>
              <button type="button" class="autocap-chip-btn" data-sec="1.5">1.5s</button>
            </div>
            <div class="autocap-speed-hint" id="autocap-speed-hint">Chờ 0.35s (350ms) mỗi slide. Chọn Siêu Tốc Stream để không bị giới hạn 2 trang/giây.</div>
          </div>

          <div class="autocap-form-group">
            <label>Tên ảnh & Định dạng:</label>
            <div style="display: flex; gap: 6px;">
              <select class="autocap-select" id="autocap-opt-naming" style="flex:1;">
                <option value="padded" selected>001.png, 002.png...</option>
                <option value="raw">1.png, 2.png...</option>
                <option value="slide_padded">Slide_001.png...</option>
                <option value="trang_padded">Trang_001.png...</option>
              </select>
              <select class="autocap-select" id="autocap-opt-format" style="width: 112px;">
                <option value="png" selected>PNG (Nét)</option>
                <option value="jpeg">JPEG (Nhanh)</option>
              </select>
            </div>
          </div>

          <label class="autocap-checkbox-row">
            <input type="checkbox" id="autocap-opt-autohide" checked>
            <span>Tự ẩn bảng AutoCap lúc chụp (tránh che slide & ghi chú)</span>
          </label>

          <button class="autocap-start-btn" id="autocap-start-btn">
            📸 Bắt đầu Chụp Slide & Tải ZIP
          </button>

          <div class="autocap-progress-container" id="autocap-progress-wrap">
            <div class="autocap-progress-header">
              <span id="autocap-progress-status">Đang chuẩn bị...</span>
              <span id="autocap-progress-percent">0%</span>
            </div>
            <div class="autocap-progress-bar-bg">
              <div class="autocap-progress-bar-fill" id="autocap-progress-fill"></div>
            </div>
            <div class="autocap-preview-thumb-wrap" id="autocap-preview-wrap" style="display:none;">
              <img class="autocap-preview-thumb" id="autocap-preview-thumb" alt="Preview"/>
            </div>
            <div class="autocap-progress-actions">
              <button class="autocap-btn-small" id="autocap-pause-btn">⏸ Tạm dừng</button>
              <button class="autocap-btn-small autocap-btn-cancel" id="autocap-cancel-btn">✕ Hủy chụp</button>
            </div>
            <button type="button" class="autocap-btn-download-partial" id="autocap-pause-download-btn" style="display:none;">⬇ Tải ZIP đã chụp</button>
          </div>

          <div class="autocap-success-card" id="autocap-success-wrap">
            <div class="autocap-success-icon">✓</div>
            <div class="autocap-success-title" id="autocap-success-title">Đã tải về thành công!</div>
            <div class="autocap-success-desc" id="autocap-success-desc">File zip đã được tải về máy.</div>
            <button class="autocap-download-again-btn" id="autocap-download-again-btn">⬇ Tải lại file .ZIP</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    // Cache DOM references
    widgetElements = {
      root,
      launcherBtn: document.getElementById('autocap-launcher-btn'),
      panel: document.getElementById('autocap-panel'),
      closeBtn: document.getElementById('autocap-close-btn'),
      startBtn: document.getElementById('autocap-start-btn'),
      pauseBtn: document.getElementById('autocap-pause-btn'),
      pauseDownloadBtn: document.getElementById('autocap-pause-download-btn'),
      cancelBtn: document.getElementById('autocap-cancel-btn'),
      progressContainer: document.getElementById('autocap-progress-wrap'),
      progressBarFill: document.getElementById('autocap-progress-fill'),
      progressPercent: document.getElementById('autocap-progress-percent'),
      progressStatus: document.getElementById('autocap-progress-status'),
      previewWrap: document.getElementById('autocap-preview-wrap'),
      previewThumb: document.getElementById('autocap-preview-thumb'),
      successCard: document.getElementById('autocap-success-wrap'),
      successTitle: document.getElementById('autocap-success-title'),
      successDesc: document.getElementById('autocap-success-desc'),
      downloadAgainBtn: document.getElementById('autocap-download-again-btn'),
      inputTotal: document.getElementById('autocap-input-total'),
      customStart: document.getElementById('autocap-custom-start'),
      customEnd: document.getElementById('autocap-custom-end'),
      btnRangeAll: document.getElementById('autocap-btn-range-all'),
      btnRangeCur: document.getElementById('autocap-btn-range-cur'),
      btnRange10: document.getElementById('autocap-btn-range-10'),
      rescanBtn: document.getElementById('autocap-rescan-btn'),
      optMode: document.getElementById('autocap-opt-mode'),
      optArea: document.getElementById('autocap-opt-area'),
      optDelaySec: document.getElementById('autocap-opt-delay-sec'),
      speedChips: document.getElementById('autocap-speed-chips'),
      speedHint: document.getElementById('autocap-speed-hint'),
      optNaming: document.getElementById('autocap-opt-naming'),
      optFormat: document.getElementById('autocap-opt-format'),
      optAutoHide: document.getElementById('autocap-opt-autohide'),
      infoTitle: document.getElementById('autocap-info-title'),
      badgeCount: document.getElementById('autocap-badge-count')
    };

    function updateSpeedHint() {
      const sec = Math.max(0.05, parseFloat(widgetElements.optDelaySec.value) || 0.35);
      const ms = Math.round(sec * 1000);
      const mode = widgetElements.optMode.value;
      if (mode === 'stream') {
        widgetElements.speedHint.textContent = `⚡ Stream Video: chờ ${sec}s (${ms}ms)/slide — vượt giới hạn Chrome.`;
      } else if (mode === 'vector') {
        widgetElements.speedHint.textContent = `📄 Vector PDF: tự động kết xuất hàng loạt siêu nhanh (không gồm ghi chú).`;
      } else if (sec < 0.5) {
        widgetElements.speedHint.textContent = `⏱ Chờ ${sec}s (${ms}ms)/slide. Chrome giới hạn Tab Chuẩn ~2 ảnh/giây; chọn "Siêu Tốc Stream" nếu muốn nhanh hơn.`;
      } else {
        widgetElements.speedHint.textContent = `⏱ Chờ ${sec}s (${ms}ms) để slide & ghi chú tải xong rồi chụp.`;
      }

      const chips = widgetElements.speedChips.querySelectorAll('.autocap-chip-btn');
      chips.forEach((chip) => {
        const chipSec = parseFloat(chip.dataset.sec);
        chip.classList.toggle('autocap-chip-active', Math.abs(chipSec - sec) < 0.001);
      });
    }

    widgetElements.speedChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.autocap-chip-btn');
      if (!btn) return;
      widgetElements.optDelaySec.value = btn.dataset.sec;
      updateSpeedHint();
    });

    widgetElements.optDelaySec.addEventListener('input', updateSpeedHint);
    widgetElements.optMode.addEventListener('change', () => {
      widgetElements.optArea.disabled = widgetElements.optMode.value === 'vector';
      updateSpeedHint();
    });
    updateSpeedHint();

    // Quick range presets
    widgetElements.btnRangeAll.addEventListener('click', () => {
      const tot = parseInt(widgetElements.inputTotal.value, 10) || 1;
      widgetElements.customStart.value = 1;
      widgetElements.customEnd.value = tot;
    });

    widgetElements.btnRangeCur.addEventListener('click', () => {
      const tot = parseInt(widgetElements.inputTotal.value, 10) || 1;
      const cur = cachedCurrentSlide || detectCurrentSlideNumber();
      widgetElements.customStart.value = cur;
      widgetElements.customEnd.value = tot;
    });

    widgetElements.btnRange10.addEventListener('click', () => {
      const tot = parseInt(widgetElements.inputTotal.value, 10) || 1;
      const cur = cachedCurrentSlide || detectCurrentSlideNumber();
      widgetElements.customStart.value = cur;
      widgetElements.customEnd.value = Math.min(tot, cur + 9);
    });

    // Rescan logic
    async function updateSlideCounters() {
      const freshInfo = getPresentationInfo();
      widgetElements.infoTitle.textContent = freshInfo.title;
      widgetElements.infoTitle.title = freshInfo.title;

      const total = await detectTotalSlides();
      const current = detectCurrentSlideNumber();
      cachedCurrentSlide = current;

      widgetElements.inputTotal.value = total;
      widgetElements.badgeCount.textContent = `${total} trang`;
      widgetElements.customStart.value = 1;
      widgetElements.customEnd.value = total;
    }

    widgetElements.rescanBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateSlideCounters();
    });

    widgetElements.inputTotal.addEventListener('change', () => {
      const val = parseInt(widgetElements.inputTotal.value, 10) || 1;
      cachedTotalSlides = val;
      widgetElements.customEnd.value = val;
      widgetElements.badgeCount.textContent = `${val} trang`;
    });

    widgetElements.launcherBtn.addEventListener('click', () => {
      widgetElements.panel.classList.toggle('autocap-open');
      if (widgetElements.panel.classList.contains('autocap-open')) {
        updateSlideCounters();
      }
    });

    widgetElements.closeBtn.addEventListener('click', () => {
      widgetElements.panel.classList.remove('autocap-open');
    });

    widgetElements.startBtn.addEventListener('click', () => {
      const totalVal = parseInt(widgetElements.inputTotal.value, 10) || cachedTotalSlides || 1;
      const delaySec = Math.max(0.05, parseFloat(widgetElements.optDelaySec.value) || 0.35);
      const userOptions = {
        mode: widgetElements.optMode.value,
        captureArea: widgetElements.optArea.value,
        autoHideWidget: widgetElements.optAutoHide.checked,
        rangeType: 'custom',
        customStart: widgetElements.customStart.value,
        customEnd: widgetElements.customEnd.value,
        totalOverride: totalVal,
        namingPattern: widgetElements.optNaming.value,
        format: widgetElements.optFormat.value,
        delay: Math.round(delaySec * 1000)
      };
      startCaptureWorkflow(userOptions);
    });

    widgetElements.pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      widgetElements.pauseBtn.textContent = isPaused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
      if (isPaused) {
        widgetElements.progressStatus.textContent = activeZipCount > 0
          ? `⏸ Đang tạm dừng — đã chụp ${activeZipCount} ảnh (Trang ${activeZipStartPage}–${activeZipLastPage})`
          : '⏸ Đang tạm dừng chụp...';
      } else {
        widgetElements.progressStatus.textContent = '▶ Đang tiếp tục chụp...';
      }
      updatePauseDownloadButton();
    });

    widgetElements.pauseDownloadBtn.addEventListener('click', () => {
      downloadActivePartialZip();
    });

    widgetElements.cancelBtn.addEventListener('click', () => {
      shouldCancel = true;
      isPaused = false;
      widgetElements.progressStatus.textContent = 'Đang hủy...';
    });

    widgetElements.downloadAgainBtn.addEventListener('click', () => {
      if (lastZipBlob && lastZipFilename) {
        triggerDownload(lastZipBlob, lastZipFilename);
      }
    });

    // Auto initial scan after page loads
    setTimeout(updateSlideCounters, 1200);
  }

  // Communication with Extension Popup & Background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getInfo') {
      const info = getPresentationInfo();
      sendResponse({
        success: true,
        title: info.title,
        presentationId: info.presentationId,
        slideCount: cachedTotalSlides || 0,
        currentSlide: cachedCurrentSlide || 1,
        isCapturing: isCapturing
      });
      return true;
    }

    if (message.action === 'streamEnded') {
      streamInterrupted = true;
      return false;
    }

    if (message.action === 'startCapture') {
      if (!isCapturing) {
        const opts = message.options || {};
        if (widgetElements) {
          if (widgetElements.panel) widgetElements.panel.classList.add('autocap-open');
          if (opts.mode && widgetElements.optMode) widgetElements.optMode.value = opts.mode;
          if (opts.captureArea && widgetElements.optArea) widgetElements.optArea.value = opts.captureArea;
          if (opts.delay && widgetElements.optDelaySec) {
            widgetElements.optDelaySec.value = (opts.delay / 1000).toFixed(2).replace(/\.?0+$/, '');
          }
          if (opts.namingPattern && widgetElements.optNaming) widgetElements.optNaming.value = opts.namingPattern;
          if (opts.format && widgetElements.optFormat) widgetElements.optFormat.value = opts.format;
          if (widgetElements.optDelaySec) widgetElements.optDelaySec.dispatchEvent(new Event('input'));
        }
        startCaptureWorkflow(opts);
        sendResponse({ success: true, message: 'Started' });
      } else {
        sendResponse({ success: false, message: 'Already capturing' });
      }
      return true;
    }
  });

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingWidget);
  } else {
    injectFloatingWidget();
  }
})();

