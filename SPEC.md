# Extensions — Master Specification

A collection of personal, privacy-first Manifest V3 Chrome extensions built with zero-bloat vanilla JavaScript and strict local-only storage.

## 1. Functional & Architectural Standards

- **Extension Isolation**: Each extension operates independently inside its own top-level directory (`<extension-name>/`) and can be loaded unpacked directly in `chrome://extensions` with no external runtime dependencies.
- **Privacy & Local-Only Guarantee**: Extensions store user data strictly locally (`chrome.storage.local` or `IndexedDB`) with zero telemetry, zero remote script execution, and zero external network requests unless explicitly scoped and documented.
- **Minimal Permissions**: Extensions request only the minimum Manifest V3 permissions required for their stated purpose.
- **Zero Inline Scripts / Strict CSP**: All HTML pages load external ES modules (`type="module"`) and attach listeners via `addEventListener()`.
- **Mandatory Registration & Documentation**: Every extension directory must maintain `manifest.json`, `SPEC.md`, `README.md`, `PRIVACY.md`, and automated tests under `tests/`, and must be listed under **Current Extensions** below and in root `README.md`.

## 2. Current Extensions

1. **[TimeLedger](./time-ledger/SPEC.md)** (`time-ledger/`): Privacy-first local web time tracker that aggregates active browsing time per website and individual page/article.
