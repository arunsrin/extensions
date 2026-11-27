# Chrome Web Store Submission Guide

Use this reference if you decide to publish **TimeLedger** to the Chrome Web Store.

## 1. Single Purpose Description
> Tracks active browsing time per website and webpage locally in the user's browser and displays aggregated local analytics.

## 2. Permission Justifications

TimeLedger intentionally requests **zero `host_permissions`** (`<all_urls>` is NOT requested) and **zero remote code**, keeping Chrome Web Store review streamlined.

| Permission | Justification for Reviewer |
|---|---|
| `tabs` | Reads the active tab's URL, title, and audible state in the focused browser window to attribute active reading/viewing time accurately. |
| `storage` | Stores daily time-spent aggregates, active session checkpoints, and user preferences strictly locally via `chrome.storage.local`. |
| `idle` | Detects when the user is idle or the screen is locked so AFK time is not counted toward active browsing time. |
| `alarms` | Runs a lightweight 1-minute heartbeat in the Manifest V3 service worker to checkpoint active session duration cleanly across worker restarts. |

## 3. Data Usage Disclosure (Chrome Web Store Privacy Tab)
- **Does the extension collect user data?** You must declare **Web history** (page URLs & titles) as handled *strictly locally on-device* (not transmitted off-device), or follow the current CWS Developer Dashboard checkboxes:
  - Check **Web history** only if required for local-only processing disclosure, and explicitly confirm:
    - Not sold to third parties
    - Not used for purposes unrelated to the item's core functionality
    - Not used to determine creditworthiness or lending
  - Link to your hosted `PRIVACY.md` URL in the Privacy Policy field.

## 4. Pre-Upload Checklist
1. Run `node --test tests/timeledger.test.mjs` and confirm all tests pass.
2. Run `python scripts/package.py` to generate `dist/time-ledger-v<version>.zip`.
3. Capture 1280×800 screenshots of the Popup and Full Dashboard (avoiding any sensitive personal URLs in the screenshot!).
4. Upload the zip from `dist/` in the Chrome Web Store Developer Dashboard.
