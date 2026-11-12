/**
 * AutoCap Google Slides - Background Service Worker
 * Handles high-speed tab screenshot capture (captureVisibleTab with quota backoff + Stream via offscreen)
 * and ZIP file downloads via Chrome APIs.
 */

let activeStreamTabId = null;

const pendingDownloadsByUrl = new Map();
const pendingDownloadsById = new Map();

function cleanupPendingDownloads() {
  const now = Date.now();
  for (const [k, v] of pendingDownloadsByUrl.entries()) {
    if (v.expiresAt < now) pendingDownloadsByUrl.delete(k);
  }
  for (const [k, v] of pendingDownloadsById.entries()) {
    if (v.expiresAt < now) pendingDownloadsById.delete(k);
  }
}

function sanitizeZipFilename(name) {
  const clean = String(name || 'Google_Slides.zip')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!clean) return 'Google_Slides.zip';
  return clean.toLowerCase().endsWith('.zip') ? clean : `${clean}.zip`;
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  cleanupPendingDownloads();
  const matchedUrl = pendingDownloadsByUrl.has(downloadItem.url)
    ? downloadItem.url
    : (downloadItem.finalUrl && pendingDownloadsByUrl.has(downloadItem.finalUrl) ? downloadItem.finalUrl : null);
  const entry = matchedUrl ? pendingDownloadsByUrl.get(matchedUrl) : null;
  if (entry) {
    entry.created = true;
    pendingDownloadsById.set(downloadItem.id, {
      filename: entry.filename,
      url: matchedUrl,
      expiresAt: Date.now() + 300000
    });
  }
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  cleanupPendingDownloads();
  const byId = pendingDownloadsById.get(downloadItem.id);
  const byUrl = pendingDownloadsByUrl.get(downloadItem.url) ||
    (downloadItem.finalUrl ? pendingDownloadsByUrl.get(downloadItem.finalUrl) : null);
  const target = byId || byUrl;

  if (target && target.filename) {
    suggest({
      filename: target.filename,
      conflictAction: 'uniquify'
    });
  } else {
    suggest();
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureTabWithRetry(windowId, captureOptions, maxRetries = 15) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(windowId, captureOptions, (dataUrl) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'Unknown captureVisibleTab error' });
        } else if (!dataUrl) {
          resolve({ ok: false, error: 'Empty dataUrl returned from captureVisibleTab' });
        } else {
          resolve({ ok: true, dataUrl });
        }
      });
    });

    if (result.ok) {
      return { success: true, dataUrl: result.dataUrl };
    }

    const errMsg = result.error || '';
    const isQuotaError =
      errMsg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') ||
      errMsg.toLowerCase().includes('quota');

    if (isQuotaError && attempt < maxRetries) {
      await sleep(110);
      continue;
    }

    return { success: false, error: errMsg };
  }

  return { success: false, error: 'Quá giới hạn tốc độ chụp màn hình của Chrome.' };
}

async function ensureOffscreenDocument() {
  if (typeof chrome.runtime.getContexts === 'function') {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });
      if (contexts && contexts.length > 0) {
        return;
      }
    } catch (e) {}
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Chụp khung hình trực tiếp từ luồng video tab để đạt tốc độ cao'
    });
  } catch (err) {
    const msg = (err && err.message) || '';
    if (!msg.includes('Only a single offscreen document')) {
      throw err;
    }
  }
}

async function closeOffscreenDocumentSafe() {
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', action: 'stopStream' });
  } catch (e) {}
  try {
    if (chrome.offscreen && typeof chrome.offscreen.closeDocument === 'function') {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {}
  activeStreamTabId = null;
}

async function startStreamCaptureForTab(tab) {
  if (!tab || !tab.id) {
    return { success: false, error: 'Không xác định được tab Google Slides hiện tại.' };
  }

  await ensureOffscreenDocument();

  let streamId = null;
  let sourceType = 'tab';

  if (chrome.tabCapture && typeof chrome.tabCapture.getMediaStreamId === 'function') {
    try {
      streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No streamId'));
          } else {
            resolve(id);
          }
        });
      });
      sourceType = 'tab';
    } catch (e) {
      streamId = null;
    }
  }

  if (!streamId) {
    if (!chrome.desktopCapture || typeof chrome.desktopCapture.chooseDesktopMedia !== 'function') {
      return { success: false, error: 'Trình duyệt không hỗ trợ desktopCapture.' };
    }

    const pickResult = await new Promise((resolve) => {
      chrome.desktopCapture.chooseDesktopMedia(['tab'], (id) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else if (!id) {
          resolve({ ok: false, cancelled: true, error: 'Người dùng đã hủy chọn tab chia sẻ.' });
        } else {
          resolve({ ok: true, id });
        }
      });
    });

    if (!pickResult.ok) {
      await closeOffscreenDocumentSafe();
      return {
        success: false,
        cancelled: !!pickResult.cancelled,
        error: pickResult.error
      };
    }

    streamId = pickResult.id;
    sourceType = 'desktop';
  }

  const initRes = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'initStream',
    streamId,
    sourceType
  });

  if (!initRes || !initRes.success) {
    await closeOffscreenDocumentSafe();
    return {
      success: false,
      error: (initRes && initRes.error) || 'Không thể khởi tạo luồng video chụp tab.'
    };
  }

  activeStreamTabId = tab.id;
  return {
    success: true,
    width: initRes.width,
    height: initRes.height,
    sourceType
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return false;

  // 1. Chụp ảnh màn hình tab hiện tại (captureVisibleTab với auto-retry quota)
  if (message.action === 'captureVisibleTab') {
    const captureOptions = {
      format: message.format === 'jpeg' ? 'jpeg' : 'png',
      quality: message.quality || 95
    };

    const runCapture = async () => {
      let windowId = sender && sender.tab ? sender.tab.windowId : null;
      if (windowId === null || windowId === undefined) {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0]) {
          windowId = tabs[0].windowId;
        }
      }
      return captureTabWithRetry(windowId, captureOptions);
    };

    runCapture()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));

    return true;
  }

  // 2. Bắt đầu luồng Video Stream siêu tốc qua Offscreen Document
  if (message.action === 'startTabStreamCapture') {
    const runStart = async () => {
      let targetTab = sender && sender.tab ? sender.tab : null;
      if (!targetTab) {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        targetTab = tabs && tabs[0] ? tabs[0] : null;
      }
      return startStreamCaptureForTab(targetTab);
    };

    runStart()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));

    return true;
  }

  // 3. Lấy 1 khung hình từ Video Stream đang chạy
  if (message.action === 'grabStreamFrame') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'grabFrame',
      cropRatio: message.cropRatio,
      format: message.format,
      quality: message.quality || 0.94
    })
      .then((res) => sendResponse(res || { success: false, error: 'Không nhận được phản hồi từ offscreen' }))
      .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));

    return true;
  }

  // 4. Dừng luồng Video Stream
  if (message.action === 'stopTabStreamCapture') {
    closeOffscreenDocumentSafe()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: true }));
    return true;
  }

  // 5. Thông báo nếu người dùng tự tắt chia sẻ tab từ thanh Chrome
  if (message.action === 'streamEndedFromOffscreen') {
    if (activeStreamTabId !== null) {
      chrome.tabs.sendMessage(activeStreamTabId, { action: 'streamEnded' }).catch(() => {});
    }
    closeOffscreenDocumentSafe();
    return false;
  }

  // 6. Đăng ký tên file dự kiến cho blob URL trước khi tải
  if (message.action === 'registerDownloadFilename') {
    cleanupPendingDownloads();
    if (message.url && message.filename) {
      pendingDownloadsByUrl.set(message.url, {
        filename: sanitizeZipFilename(message.filename),
        created: false,
        expiresAt: Date.now() + 300000
      });
    }
    sendResponse({ success: true });
    return false;
  }

  // 7. Kiểm tra xem <a download> đã kích hoạt tải xuống chưa
  if (message.action === 'wasDownloadCreated') {
    const entry = message.url ? pendingDownloadsByUrl.get(message.url) : null;
    sendResponse({ created: !!(entry && entry.created) });
    return false;
  }

  // 8. Tải file ZIP về máy tính (fallback nếu <a download> bị chặn)
  if (message.action === 'downloadZip') {
    const filename = sanitizeZipFilename(message.filename || 'Google_Slides.zip');
    const url = message.url;

    if (url) {
      pendingDownloadsByUrl.set(url, {
        filename,
        created: true,
        expiresAt: Date.now() + 300000
      });
    }

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: message.saveAs !== undefined ? message.saveAs : false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download error:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        if (downloadId) {
          pendingDownloadsById.set(downloadId, {
            filename,
            url,
            expiresAt: Date.now() + 300000
          });
        }
        sendResponse({ success: true, downloadId: downloadId });
      }
    });

    return true;
  }

  // 7. Lấy thông tin tab hiện tại
  if (message.action === 'getActiveTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        sendResponse({ success: true, tab: tabs[0] });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
    });
    return true;
  }

  return false;
});