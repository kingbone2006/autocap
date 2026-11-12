Language: **English** | [Tiếng Việt](README_VI.md)

# AutoCap Google Slides

A Chrome Extension (Manifest V3) that automatically captures Google Slides directly from your browser tab (including speaker notes below the slide if desired), supports custom per-slide speed in seconds, packages all captures into a `.zip` archive named after the presentation title, and downloads it directly to your computer.

---

## Key Features

1. **Captures Actual Browser Rendering (Fixes Black Screen & Missing Images)**
   - Captures the real pixels rendered on the active browser tab, preserving embedded images, fonts, diagrams, and layout fidelity.
   - Works reliably even on presentations where downloading/exporting is restricted (View-only mode).
   - Automatically hides the AutoCap floating control panel during each snapshot so it never obscures the slide or speaker notes.

2. **Flexible Capture Area Options**
   - **Slide + Speaker Notes Below (Default)**: Captures the main slide workspace together with the speaker notes pane underneath, cropping out the top toolbar and left-hand slide filmstrip.
   - **Full Browser Viewport**: Captures the entire visible area of the current tab as displayed.
   - **Slide Only**: Crops strictly to the slide frame without speaker notes.

3. **Custom Capture Speed (in Seconds) & High-Speed Stream Mode**
   - Enter any custom delay in seconds per slide (down to `0.05` seconds) or click quick presets (`0.15s`, `0.3s`, `0.5s`, `0.8s`, `1.5s`).
   - **Direct Tab Capture**: Runs automatically with one click and handles Chrome's `captureVisibleTab` rate limit (~2 captures/sec) gracefully with automatic backoff and retry.
   - **Turbo Stream Mode**: Grabs frames directly from a live tab `MediaStream` via an Offscreen Document, bypassing Chrome's `captureVisibleTab` quota limit for rapid `0.1s` - `0.4s` per-slide capture.
   - **Vector PDF Export**: Fast batch rendering from the source PDF when export is permitted (captures slides only, without speaker notes).

4. **Pause & Download Captured Slides as ZIP Anytime**
   - Pause the capture process at any moment.
   - While paused (or if cancelled/interrupted partway through), a **Download Captured ZIP** button appears so you can immediately package and download every slide captured up to that point without losing progress, then resume or cancel afterward.

5. **Accurate Image & Archive Naming**
   - Automatically names the `.zip` archive after the Google Slides presentation title (for example, `SEMESTER_4_SWR302.zip`), preventing Chrome's default UUID naming for Blob URL downloads.
   - Supports multiple filename patterns (`001.png`, `1.png`, `Slide_001.png`, `Trang_001.png`) in either `PNG` or `JPEG` format.
   - Supports virtualized filmstrip scrolling for large presentations with 500+ slides.

---

## Installation

### Option 1: Install from GitHub Releases (Recommended)

1. Open the [Releases](https://github.com/kingbone2006/autocap/releases) page of this repository.
2. Under the latest release, download `AutoCap-Google-Slides-v2.0.0.zip`.
3. Extract the `.zip` file to a dedicated folder on your computer (for example, `C:\Extensions\AutoCap`). Keep this folder in place after installation.
4. Open Chrome (or Edge, Brave, Opera, Coc Coc) and navigate to:
   ```text
   chrome://extensions/
   ```
5. Enable **Developer mode** using the toggle in the top-right corner.
6. Click **Load unpacked** in the top-left corner.
7. Select the extracted folder containing `manifest.json` and click **Select Folder**.
8. Optionally pin the extension icon to your browser toolbar for quick popup access.

### Option 2: Install from Source Code

1. Clone or download the repository:
   ```bash
   git clone https://github.com/kingbone2006/autocap.git
   ```
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the cloned `autocap` folder.

---

## Usage Guide

1. Open the target Google Slides presentation in Chrome. If you want to capture speaker notes as well, make sure the speaker notes pane at the bottom is expanded and sized as desired.
2. In the bottom-right corner of the Google Slides window, click the **Chụp Slide** floating button (or click the extension icon in your Chrome toolbar).
3. Configure your capture settings in the panel:
   - **Total Slides / Capture Range**: Verify the detected slide count (or click **Quét lại** / Rescan). Capture the entire deck, start from the current slide, capture a 10-slide sample, or specify any custom start and end page numbers.
   - **Capture Engine**:
     - Select **Chụp Trực Tiếp Tab** (Direct Tab Capture) for automatic one-click capture.
     - Select **Siêu Tốc Stream** (Turbo Stream) for capture intervals faster than `0.5s` per slide (if Chrome prompts for tab sharing permission on the first run, pick the current Google Slides tab).
   - **Capture Area**: Choose **Slide + Phần ghi chú phía dưới** (Slide + Notes Below), **Toàn màn hình trình duyệt đang xem** (Full Browser Tab), or **Chỉ khung Slide** (Slide Only).
   - **Speed per Slide (seconds)**: Enter any delay in seconds (such as `0.25`, `0.35`, `0.5`, `1.0`) or select one of the quick preset buttons.
   - **Filename & Image Format**: Choose your preferred numbering pattern and image format (`PNG` or `JPEG`).
   - **Auto-hide Panel While Capturing**: Keep this enabled so the AutoCap panel temporarily hides during each frame capture.
4. Click **Bắt đầu Chụp Slide & Tải ZIP**.
5. Monitor progress:
   - Keep the Google Slides tab visible and active while capturing.
   - If you want to stop partway through, click **Tạm dừng** (Pause) and then **Tải ZIP đã chụp** (Download Captured ZIP) to save all slides captured so far into a `.zip` file.
   - Once complete, the `.zip` file named after your presentation automatically saves to your Downloads folder.

---

## Project Structure

```text
autocap/
├── manifest.json            # Chrome Extension configuration (Manifest V3)
├── background.js            # Service Worker: tab capture, Offscreen stream, download filename enforcement
├── content.js               # Content Script: floating UI, virtualized filmstrip navigation, ZIP packaging
├── content.css              # Floating widget styles
├── offscreen.html           # Hidden Offscreen document for Turbo Stream capture
├── offscreen.js             # High-speed frame grabber from tab MediaStream
├── popup/
│   ├── popup.html           # Toolbar popup UI
│   ├── popup.css            # Toolbar popup styles
│   └── popup.js             # Toolbar popup controller
├── lib/
│   ├── jszip.min.js         # Client-side ZIP archive builder
│   ├── pdf.min.js           # PDF parser (for Vector PDF Export mode)
│   └── pdf.worker.min.js    # PDF background worker
├── icons/                   # Extension icons (16x16, 48x48, 128x128)
├── bookmarklet.js           # Standalone DevTools Console helper script
├── HUONG_DAN_SU_DUNG.html   # Offline HTML guide (Vietnamese)
├── README.md                # Documentation (English)
└── README_VI.md             # Documentation (Vietnamese)
```

---

## Permissions & Privacy

All screenshot processing and `.zip` archive generation run 100% locally in your browser. No slides, notes, or images are ever uploaded to external servers.

- `activeTab`, `tabs`: Inspect the active Google Slides tab and capture its rendered viewport.
- `desktopCapture`, `tabCapture`, `offscreen`: Capture continuous frames at high speed in Turbo Stream mode.
- `downloads`: Save the generated `.zip` archive directly with the presentation's actual title.
- `scripting`: Communicate and operate on Google Slides pages.

---

## Notes & Tips

- While using **Direct Tab Capture** or **Turbo Stream**, avoid minimizing the browser window or switching away to another tab so the browser keeps rendering each slide and its notes properly.
- If you set a very low delay (such as `0.05s` - `0.15s`) on slides with heavy images, increase the delay to `0.3s` - `0.6s` if images have not finished loading before capture.
- After updating the extension, open `chrome://extensions/`, click **Reload** on the AutoCap card, and refresh (`F5`) any open Google Slides tabs.


