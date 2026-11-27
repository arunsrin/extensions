# TimeLedger — Local Web Time Tracker

A privacy-first, Manifest V3 Chrome extension that tracks how long you spend on each website and individual page/article, aggregating everything strictly in local browser storage.

## Features

- **Website & Page-Level Aggregation:** Tracks both total time per domain and exact time per normalized page/article URL (with visit counts and last-visited timestamps).
- **100% Local Storage:** All data lives exclusively in `chrome.storage.local`. Zero servers, zero telemetry, zero external network requests (no external font or favicon API calls).
- **MV3-Resilient Timing:** Persists active-session checkpoints to storage so service worker suspension never drops elapsed time, splits midnight-crossing sessions accurately across local calendar days, and caps sleep/lid-close gaps so overnight inactivity never inflates totals.
- **Smart Pausing:** Automatically pauses when Chrome loses focus, when the system is idle or locked (with optional audio/video playback awareness), or on ignored domains and internal browser pages (`chrome://`, `about:`).
- **Full Dashboard:** Filter by Today, Yesterday, 7 Days, 30 Days, All Time, or Custom dates; search by title/URL/domain; filter pages by minimum read duration (`≥ 30s`, `≥ 2m`, `≥ 5m`, `≥ 15m`); and export JSON backups or CSV reports.
- **Extensible Page Actions:** Row actions on the Pages & Articles table are driven by [`src/dashboard/actions.js`](src/dashboard/actions.js), making it straightforward to add custom buttons like *"Add to Todoist"* or *"Blog about this"* once you've reviewed your data.

## Load Locally in Chrome (Developer Mode)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder (`time-ledger`).
4. Pin **TimeLedger** to your toolbar and browse normally. Click the toolbar icon anytime to see live status and today's breakdown, or click **Full Dashboard →**.

## Run Tests

Requires Node.js (v20+):

```bash
node --test tests/timeledger.test.mjs
```

## Package for Chrome Web Store

```bash
python scripts/package.py
```

This creates `dist/time-ledger-v0.1.0.zip` containing only the runtime extension files (`manifest.json`, `icons/`, `src/`). See [STORE_LISTING.md](STORE_LISTING.md) and [PRIVACY.md](PRIVACY.md) for Chrome Web Store submission details.
