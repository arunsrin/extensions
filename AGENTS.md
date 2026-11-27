# AI Agent Guidelines & Architecture Guide for Extensions

This repository houses personal, privacy-first **Chrome Extensions (Manifest V3)** built with zero-bloat vanilla JavaScript (ES modules), lightweight CSS, and native browser APIs.

---

## 1. Core Principles & Philosophy

- **Privacy-First & Zero Telemetry:** Browsing data is sensitive. Store user data strictly locally (`chrome.storage.local` / `IndexedDB`). Never transmit history, URLs, or usage metrics off-device, and never make external font, CDN, or favicon server requests.
- **Minimal MV3 Permissions:** Request the smallest permission set required (avoid `host_permissions` / `<all_urls>` whenever `tabs` + `storage` + `idle` + `alarms` suffice) to preserve user trust and keep Chrome Web Store review streamlined.
- **Zero Bloat & No Unnecessary Build Step:** Prefer vanilla ES modules and native Web APIs so each extension can be loaded unpacked directly in `chrome://extensions` and audited without `node_modules` bloat.
- **MV3 Service Worker Resilience:** Ephemeral service workers suspend after inactivity. Persist active session checkpoints in storage, serialize async state transitions via an internal queue to prevent write races, split intervals cleanly across local calendar days, and cap runaway sleep gaps.
- **Strict CSP & XSS Safety:** Zero inline `<script>` tags and zero inline `on*=` event handlers in HTML. Render all dynamic page titles, URLs, and domains via `textContent` (never unescaped `innerHTML`).
- **Modular Extension Isolation:** Each extension lives in its own top-level folder (`<extension-name>/`) with its own `manifest.json`, `SPEC.md`, `README.md`, `PRIVACY.md`, `STORE_LISTING.md`, `tests/`, and packaging script.

---

## 2. Directory Layout

- `AGENTS.md`: Repository guidelines and quality gates.
- `SPEC.md`: Master specification registering all extensions.
- `README.md`: Repository overview and extension directory.
- `.gitattributes`: Cross-platform line ending normalization.
- `.github/workflows/test.yml`: GitHub Actions CI pipeline.
- `scripts/`: Repo-wide verification tooling:
  - `test.ps1` / `test.sh`: Strict local verification suite.
  - `test_extensions_structure.py`: Validates extension structure, manifests, docs, and registration.
  - `test_ci_parity.py`: Ensures every local check runs in GitHub Actions CI.
- `<extension-name>/`: Self-contained extension directory (e.g., `time-ledger/`):
  - `manifest.json`, `README.md`, `SPEC.md`, `PRIVACY.md`, `STORE_LISTING.md`
  - `icons/`, `src/`, `tests/`, `scripts/package.py`

---

## 3. Testing & Verification

Always run the full verification suite before committing or opening a PR:

```bash
./scripts/test.ps1    # Windows PowerShell
./scripts/test.sh     # Linux / macOS / WSL
```

Individual checks:
- `node --test <ext>/tests/*.test.mjs` — Unit, state-machine, and MV3/CSP compliance tests
- `python scripts/test_extensions_structure.py` — Validates structure, manifest fields, docs, and registration
- `python scripts/test_ci_parity.py` — Verifies `.github/workflows/test.yml` executes all local checks

---

## 4. Rules of Thumb for Changes

1. **Worktree Isolation & Protected `main`:** Pull latest `main` before branching, develop inside `.worktrees/<feature-name>`, and merge via Pull Request rather than committing directly to `main`.
2. **Mandatory Companion Tests & Negative Assertions:** Every new behavior or bug fix must include automated tests covering invalid inputs, empty states, boundary conditions (e.g., midnight rollover, sleep gaps, concurrency), and CSP/manifest checks.
3. **Responsive Narrow-Viewport Scaling:** Constrain grids and inputs using fluid sizing (e.g., `minmax(min(340px, 100%), 1fr)` and `width: min(260px, 100%); min-width: 0`) so popups and dashboards never cause horizontal overflow on narrow windows.
4. **Defensive Storage & API Calls:** Wrap `localStorage` access in `try/catch` and guard `chrome.runtime.sendMessage` / `chrome.tabs` calls against `chrome.runtime.lastError` or closed tabs.
5. **Windows Python UTF-8 Stdout:** Every Python script under `scripts/` or `<ext>/scripts/` must configure UTF-8 stdout/stderr at the top:
   ```python
   if hasattr(sys.stdout, "reconfigure"):
       sys.stdout.reconfigure(encoding="utf-8")
   if hasattr(sys.stderr, "reconfigure"):
       sys.stderr.reconfigure(encoding="utf-8")
   ```
6. **Mandatory Registration & Specs:** Every extension directory must include `manifest.json`, `SPEC.md`, `README.md`, `PRIVACY.md`, and `tests/`, and must be registered in both root `README.md` and root `SPEC.md` (enforced by `scripts/test_extensions_structure.py`).
7. **Line Endings:** Enforced by `.gitattributes` (LF for `.js`/`.mjs`/`.html`/`.css`/`.py`/`.sh`/`.md`/`.json`/`.yml`; CRLF for `.ps1`).
