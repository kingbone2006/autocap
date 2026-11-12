/**
 * AutoCap Google Slides - Offscreen Video Stream Frame Grabber
 * Handles live tab MediaStream capture without Chrome captureVisibleTab rate limits.
 */

let activeStream = null;
const videoEl = document.getElementById('autocap-stream-video');
const canvasEl = document.createElement('canvas');
const ctx = canvasEl.getContext('2d', { alpha: false });

function stopCurrentStream() {
  if (activeStream) {
    try {
      activeStream.getTracks().forEach((track) => track.stop());
    } catch (e) {}
    activeStream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

function waitForFreshVideoFrame(timeoutMs = 55) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const timer = setTimeout(finish, timeoutMs);

    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      try {
        videoEl.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          finish();
        });
      } catch (e) {
        clearTimeout(timer);
        finish();
      }
    } else {
      setTimeout(() => {
        clearTimeout(timer);
        finish();
      }, 24);
    }
  });
}

async function initStreamCapture(streamId, sourceType) {
  stopCurrentStream();

  const mediaSource = sourceType === 'tab' ? 'tab' : 'desktop';
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: mediaSource,
        chromeMediaSourceId: streamId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 60
      }
    }
  };

  activeStream = await navigator.mediaDevices.getUserMedia(constraints);

  const tracks = activeStream.getVideoTracks();
  if (!tracks || tracks.length === 0) {
    throw new Error('Không tìm thấy luồng video từ tab.');
  }

  tracks[0].addEventListener('ended', () => {
    stopCurrentStream();
    chrome.runtime.sendMessage({ action: 'streamEndedFromOffscreen' }).catch(() => {});
  });

  videoEl.srcObject = activeStream;
  await videoEl.play();

  // Wait until video metadata & dimensions are ready
  const startWait = Date.now();
  while ((videoEl.readyState < 2 || videoEl.videoWidth === 0) && Date.now() - startWait < 5000) {
    await new Promise((r) => setTimeout(r, 25));
  }

  if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
    stopCurrentStream();
    throw new Error('Luồng video chưa sẵn sàng (kích thước 0x0).');
  }

  // Wait one frame warmup so first capture is never blank
  await waitForFreshVideoFrame(120);

  return {
    width: videoEl.videoWidth,
    height: videoEl.videoHeight
  };
}

async function grabCroppedFrame(cropRatio, format, quality) {
  if (!activeStream || !videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
    throw new Error('Luồng video đã ngắt hoặc chưa sẵn sàng.');
  }

  await waitForFreshVideoFrame(55);

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const ratio = cropRatio || { x: 0, y: 0, w: 1, h: 1 };

  const sx = Math.max(0, Math.min(vw - 1, Math.round(ratio.x * vw)));
  const sy = Math.max(0, Math.min(vh - 1, Math.round(ratio.y * vh)));
  const sw = Math.max(1, Math.min(vw - sx, Math.round(ratio.w * vw)));
  const sh = Math.max(1, Math.min(vh - sy, Math.round(ratio.h * vh)));

  if (canvasEl.width !== sw || canvasEl.height !== sh) {
    canvasEl.width = sw;
    canvasEl.height = sh;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);

  const isJpeg = format === 'jpeg';
  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  const dataUrl = isJpeg ? canvasEl.toDataURL(mime, quality || 0.94) : canvasEl.toDataURL(mime);

  return { dataUrl, width: sw, height: sh };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  if (message.action === 'initStream') {
    initStreamCapture(message.streamId, message.sourceType)
      .then((dims) => sendResponse({ success: true, ...dims }))
      .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

  if (message.action === 'grabFrame') {
    grabCroppedFrame(message.cropRatio, message.format, message.quality)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }

  if (message.action === 'stopStream') {
    stopCurrentStream();
    sendResponse({ success: true });
    return false;
  }

  return false;
});
