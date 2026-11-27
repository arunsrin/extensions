# TimeLedger — Specification

A privacy-first, Manifest V3 Chrome extension that monitors active browsing time per website and individual page/article, storing and aggregating all data strictly locally.

## 1. Functional Requirements

- **Active Tab & Window Time Tracking**:
  - Track elapsed time only while Chrome has OS focus and the user is active.
  - Attribute time simultaneously to both the **website (domain)** and the **normalized page URL** (including title, visit count, first-visited, and last-visited timestamps).
  - Detect SPA URL and title updates (`tabs.onUpdated`) without double-counting visits on title-only changes.
- **MV3 Service Worker Resilience**:
  - Persist `activeSession` checkpoints in `chrome.storage.local` so Chrome worker suspension never drops accumulated time.
  - Serialize all state transitions via an internal async queue to prevent concurrent read-modify-write races.
  - Run a 1-minute `chrome.alarms` heartbeat and flush on-demand when opening the popup or dashboard.
  - Split sessions crossing midnight accurately across local calendar days (`YYYY-MM-DD`).
  - Cap single un-checkpointed gaps exceeding 3 minutes (e.g., OS sleep/lid-close) to 60 seconds.
- **Smart Pausing & Exclusions**:
  - Pause automatically on window blur, system lock, or user idle (configurable threshold, with optional override when the active tab is playing audio).
  - Skip non-web schemes (`chrome://`, `chrome-extension://`, `about:`, `devtools://`, etc.) and Incognito tabs (unless explicitly enabled).
  - Support a user-managed ignored domains list (matching exact domains and subdomains).
- **URL Normalization**:
  - Optionally strip `#hash` fragments and known tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, etc.) while keeping meaningful query parameters (`?v=`, `?id=`, etc.).
- **Aggregation, Filtering & Export**:
  - Filter across Today, Yesterday, Last 7 Days, Last 30 Days, All Time, or Custom date ranges.
  - Filter pages by domain drill-down, search query, and minimum read duration (`≥ 30s`, `≥ 2m`, `≥ 5m`, `≥ 15m`).
  - Export full JSON backups and RFC-4180 CSV reports (websites or pages).

## 2. UI / UX Requirements

- **Popup (`src/popup/popup.html`)**: Fast glance at live tracking status, pause/resume toggle, quick ignore-site action, Today / 7 Days summary, Top Websites, Top Pages, and link to Full Dashboard.
- **Full Dashboard (`src/dashboard/dashboard.html`)**: Tabbed interface (`Overview & Websites`, `Pages & Articles`, `Daily Log`, `Settings & Data`), daily activity bar chart, local storage meter, and Auto/Light/Dark theme support.
- **Extensible Row Actions (`src/dashboard/actions.js`)**: Declarative `PAGE_ACTIONS` registry so future integrations (e.g., *"Add to Todoist"*, *"Blog about this"*) can be added cleanly without altering table rendering.

## 3. Privacy & Technical Constraints

- **100% Local Storage**: Stored strictly in `chrome.storage.local` (`day:YYYY-MM-DD` buckets). Zero external servers, zero telemetry, zero remote fonts or favicon API calls.
- **Minimal MV3 Permissions**: Only `tabs`, `storage`, `idle`, and `alarms` — zero `host_permissions` (`<all_urls>`).
- **Strict CSP & XSS Safety**: Zero inline `<script>` tags, zero inline `on*` event handlers, and all dynamic text rendered via `textContent` (never unescaped `innerHTML`).
- **Chrome Web Store Ready**: Includes `PRIVACY.md`, `STORE_LISTING.md`, generated PNG icons, and `scripts/package.py` producing clean runtime zips in `dist/`.
