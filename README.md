# Extensions

Personal browser extensions built for privacy, speed, and local-first workflows.

## Extensions

- **[TimeLedger](./time-ledger/README.md)** ([Spec](./time-ledger/SPEC.md)) — Privacy-first Manifest V3 Chrome extension that tracks active browsing time per website and individual page/article locally in `chrome.storage.local`.

## Quick Start (TimeLedger)

```bash
cd time-ledger
node --test tests/timeledger.test.mjs
python scripts/package.py
```

Load `time-ledger/` directly via **Load unpacked** in `chrome://extensions`.
