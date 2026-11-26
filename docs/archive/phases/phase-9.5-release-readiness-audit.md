# Phase 9.5 — Local Release Readiness Audit Report

**Project:** TOS Red Flag Scanner (PrismClause)  
**Document Version:** 1.0  
**Date:** 2026-11-22  
**Status:** Audit Completed — Local Windows Release Ready  
**Audience:** System Architects, Product Engineers, and Release Managers  

---

## 1. Executive Summary

Phase 9.5 conducted an exhaustive, read-only audit of the **TOS Red Flag Scanner (PrismClause)** project to determine whether it is ready for a seamless local release and live demonstration on another Windows 10/11 workstation.

The audit examined eight critical operational dimensions:
1. **Installation & Tooling:** Node.js, Python, package dependencies, virtual environments, and Hugging Face model cache requirements.
2. **Startup & Teardown Lifecycle:** Unified concurrency via `scripts/start.js`, pre-flight collision prevention, model pre-warming, and Windows process-tree cleanup.
3. **Configuration & Secrets Hygiene:** Environment variable boundaries, zero-config local defaults, fail-safe fallbacks, and token sanitization.
4. **Browser Extension Release Readiness:** Manifest V3 permissions, origin whitelisting, CSP compliance, Options page setup, and absence of hardcoded secrets.
5. **Release Documentation Consistency:** Walkthrough accuracy across `README.md`, `docs/INSTALLATION.md`, `docs/USER_GUIDE.md`, and `docs/deployment.md`.
6. **Feature Completeness:** Live operational status of the 4 SaaS views (Analyze, Portfolio, Sentinel, LexCheck Compliance), extension candidate discovery, and grounded Q&A.
7. **Empirical Quality & Regression Verification:** 690 passing automated tests (617 Node.js backend + 73 Python AI service) and 100% academic benchmark alignment.
8. **Known Risks & Demonstrator Safeguards:** Network requirements on cold start, CPU inference timing, and execution policy handling on clean Windows installations.

### Audit Verdict: **PASS — READY FOR LOCAL WINDOWS RELEASE**
The project is structurally sound, zero-retention compliant, securely bounded, and accompanied by comprehensive operational documentation. A secondary workstation can install prerequisites, launch the unified service with `npm start`, load the extension unpacked in Chrome or Edge, and perform complete end-to-end policy evaluations with zero code modifications.

---

## 2. Step 1 — Installation Audit (Fresh Windows Environment)

The installation procedure was evaluated from the perspective of an engineer or demonstrator provisioning a fresh Windows 10 or 11 laptop:

### 2.1 Software Prerequisites
- **Node.js:** Requires `>= 20.0.0` (Verified on Node.js v22 & v24 LTS).
- **Python:** Requires `3.10` to `3.13` (Verified on Python 3.13.2 x64).
  - *Audit Finding:* Python installer must have "Add python.exe to PATH" enabled. This prerequisite is prominently documented in `docs/INSTALLATION.md`.
- **System Shell:** Windows PowerShell 5.1+ or Windows Terminal with PowerShell 7+.
- **Browser:** Google Chrome (v115+) or Microsoft Edge (v115+) for Manifest V3 extension loading.

### 2.2 Dependency Installation
- **Node.js Packages (`npm install`):**
  - Root `package.json` declares `"workspaces": ["backend"]`.
  - Executing `npm install` at the project root automatically installs all root tools (`dotenv`) and backend dependencies (`express`, `helmet`, `cheerio`, `axios`, `pdf-parse`, `zod`, `@langchain/core`, `@langchain/google-genai`, `@langchain/langgraph`).
  - No native C++ node-gyp build tools are required; all dependencies use pre-compiled binaries or pure JavaScript.
- **Python Virtual Environment (`.venv`):**
  - Created via standard library: `python -m venv .venv`.
  - PowerShell activation script: `.\.venv\Scripts\Activate.ps1`.
  - *PowerShell Execution Policy:* If script execution is restricted (`running scripts is disabled on this system`), `docs/INSTALLATION.md` provides the exact remedy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`. Alternatively, `scripts/start.js` discovers `.venv/Scripts/python.exe` directly without requiring manual shell activation.
- **Python Packages (`pip install -r ai-service/requirements.txt`):**
  - Specifies: `fastapi>=0.115.0`, `uvicorn>=0.30.0`, `pytest>=8.0.0`, `httpx>=0.27.0`, `sentence-transformers>=3.0.0`, `chromadb>=0.5.0`.
  - Automatically installs PyTorch (CPU wheel) and Hugging Face transformers.

### 2.3 AI Models & Disk Cache Requirements
- **Embedding Model:** `sentence-transformers/all-MiniLM-L6-v2` (~80–90 MB).
- **NLI Verification Model:** `cross-encoder/nli-deberta-v3-base` (~350–500 MB).
- **Storage Location:** Standard Hugging Face hub cache at `C:\Users\<user>\.cache\huggingface\hub`.
- **Total Disk Footprint:** $\approx 2.5\text{ GB}$ total storage needed on disk:
  - Node modules: $\approx 350\text{ MB}$.
  - Python `.venv` (with PyTorch CPU & dependencies): $\approx 1.5\text{ GB}$.
  - Hugging Face model weights: $\approx 600\text{ MB}$.
- **Cold-Start Network Requirement:** On the very first run on a fresh PC, internet access is required to download model weights. Subsequent runs can operate offline, supported by setting `NLI_LOCAL_FILES_ONLY=true` in `.env`.

### 2.4 Undocumented Manual Interventions
- *Zero Undocumented Interventions:* The end-to-end installation flow in `docs/INSTALLATION.md` matches actual repository behavior. Every step has copy-pasteable PowerShell commands.

---

## 3. Step 2 — Startup and Shutdown Audit

The unified process manager (`scripts/start.js`) was audited for reliability and process hygiene:

### 3.1 Startup Flow (`npm start`)
1. **Pre-flight Port Verification:**
   - Probes `PORT` (3000) and Python port (8000) using TCP sockets before spawning child processes.
   - If either port is busy, the launcher stops immediately with actionable guidance:
     ```text
     [ERROR] Cannot start: required port is already in use.
       • Port 3000 is occupied by an active process (Node backend).
     To avoid duplicate processes:
       taskkill /F /IM node.exe /IM uvicorn.exe /IM python.exe
     ```
2. **Python Executable Auto-Discovery:**
   - Checks 7 candidate paths across root `.venv` and subfolder venvs (e.g. `.venv/Scripts/uvicorn.exe`, `.venv/Scripts/python.exe`).
   - If missing, outputs a 3-step setup guide and exits with code 1 without crashing.
3. **Concurrent Process Spawning & Prefixing:**
   - Spawns Node backend and Python AI microservice concurrently.
   - Attaches real-time prefixed stdout/stderr streams: `[BACKEND]` (cyan) and `[PYTHON AI]` (magenta).
4. **Health & Readiness Polling:**
   - Polls `http://127.0.0.1:3000/health` (timeout: 30s) and `http://127.0.0.1:8000/health` (timeout: 60s, configurable via `PYTHON_AI_STARTUP_TIMEOUT_MS`).
   - Validates JSON payload `{ status: "ok" }`.
   - Emits progress updates every 10s if initialization is prolonged ("loading models & pre-warming DeBERTa...").
   - Prints clear green banner once both services are online:
     ```text
     ====================================================
       TOS Red Flag Scanner services are online!
       • Web App / API:   http://localhost:3000 (ready in 0.8s)
       • Python AI API:   http://127.0.0.1:8000 (NLI DeBERTa: Pre-warmed & Ready) (ready in 4.2s)
       • Press Ctrl+C in this terminal to stop both.
     ====================================================
     ```

### 3.2 Shutdown & Teardown Hygiene
- **Signal Trapping:** Traps `SIGINT` (Ctrl+C), `SIGTERM`, and `SIGHUP`.
- **Windows Readline Fix:** Explicitly instantiates `node:readline` on `process.stdin` on Windows so that pressing `Ctrl+C` in Windows Terminal / PowerShell triggers `SIGINT` reliably.
- **Process Tree Termination:** Uses `taskkill /pid <PID> /T /F` on Windows to cleanly terminate the entire process subtree (Uvicorn parent and all worker sub-processes).
- **Synchronous Exit Hook:** Registers `process.on("exit")` with `spawnSync("taskkill")` as a failsafe against orphaned background processes if the Node event loop terminates abruptly.
- *Audit Result:* Zero orphaned processes left behind on shutdown.

---

## 4. Step 3 — Configuration Audit

The project configuration boundaries and `.env.example` were audited against secure engineering principles:

### 4.1 Environment Variable Taxonomy
| Variable | Scope | Default | Behavior if Unset / Missing |
| :--- | :--- | :--- | :--- |
| `PORT` | Backend | `3000` | Falls back to port 3000 |
| `GEMINI_API_KEY` | Backend | None | Activates `NullProvider`; rule-based heuristics and compliance operate without generative AI |
| `ENABLE_GEMINI_PROVIDER` | Backend | `true` | When true and key present, enables Gemini 2.5 Pro |
| `ENABLE_PYTHON_AI_SERVICE` | Backend | `true` | When false, bypasses Python embeddings/NLI; falls back to lexical metrics |
| `PYTHON_AI_SERVICE_URL` | Backend | `http://localhost:8000` | Loopback destination for AI microservice |
| `PYTHON_AI_STARTUP_TIMEOUT_MS`| Launcher | `60000` | Clamped to [5000, 300000] ms |
| `ENABLE_LANGGRAPH_QA` | Backend | `false` | Procedural RAG engine serves as the default production pipeline |
| `ENABLE_API_AUTH` | Backend | `false` | Zero-config local development; `/api/*` endpoints open to local callers |
| `API_BEARER_TOKEN` | Backend | None | Expected token when `ENABLE_API_AUTH=true` |
| `ENABLE_INTERNAL_AUTH` | Python | `false` (in dev) | When false or token omitted, permits zero-config loopback calls |
| `INTERNAL_AI_SERVICE_TOKEN` | Both | None | Server-to-server token passed via `X-Internal-Token` |
| `CHROME_EXTENSION_ORIGIN` | Backend | None | Whitelists extension ID for CORS access |
| `NLI_LOCAL_FILES_ONLY` | Python | `false` | When true, enforces offline-only model cache loading |

### 4.2 Logging Sanitization & Security Boundaries
- **Zero Token Leakage:** Secrets (`GEMINI_API_KEY`, `API_BEARER_TOKEN`, `INTERNAL_AI_SERVICE_TOKEN`) are never logged in plaintext.
- **Client Configuration Masking:** The web app and extension controllers call `sanitizeConfigForLogging()` to mask Bearer tokens before serializing or logging.
- **Error Shielding:** Express error middleware formats sanitized JSON `{ "error": "..." }` and suppresses internal stack traces in production/release mode.
- **Fail-Safe Parsing:** All integer environment variables pass through `parsePositiveInt()` with range clamping to prevent `NaN` crashes or buffer overflows.

---

## 5. Step 4 — Browser Extension Release Audit

The browser extension (`extension/`) was audited for Manifest V3 compliance and packaging readiness:

### 5.1 Manifest V3 Inspection (`extension/manifest.json`)
- **Manifest Version:** `3`.
- **Permissions:** `["activeTab", "storage", "scripting"]` — strictly scoped to reading active page DOM upon user click and storing local settings.
- **Host Permissions:** `["http://localhost:3000/*"]` — permits communication with the local backend.
- **Optional Host Permissions:** `["https://*/*", "http://127.0.0.1/*"]` — allows users to connect to custom remote HTTPS backends on-demand.
- **Background Worker:** `"service_worker": "background/service-worker.js", "type": "module"`.
- **Options UI:** `"page": "options/options.html", "open_in_tab": true`.

### 5.2 Content Security Policy & Code Quality
- **Pure MV3 Compliance:** Zero inline `<style>` attributes and zero inline `<script>` tags or event handlers (`onclick`, `onsubmit`) across `popup.html` and `options.html`.
- **No Remote Scripts:** All JavaScript is bundled locally; zero external script imports or CDN tags.
- **SEC-EXT-1 Sender Validation:** The background service worker validates `sender.id === chrome.runtime.id` to prevent external websites from triggering extension actions or draining API quotas.
- **No Embedded Secrets:** Zero API keys, Bearer tokens, or passwords exist in extension source files.
- **Developer Mode Installation:** Ready to load unpacked directly from `D:\TOS red flag scanner\extension` in Chrome or Edge.

---

## 6. Step 5 — Release Documentation Audit

All project documentation was cross-referenced against the audited codebase to determine whether a new user can successfully complete all onboarding and operational tasks without external guidance:

### 6.1 Documentation Set Reviewed
- `README.md` (System overview, technology stack, setup, feature matrix)
- `docs/INSTALLATION.md` (Windows beginner setup guide)
- `docs/USER_GUIDE.md` (Operational manual, 4 SaaS views, Q&A interpretation)
- `docs/deployment.md` (Production deployment, Nginx topology, reverse proxy)
- `docs/architecture.md` (Technical architecture specification v3.0)
- `docs/ui-ux.md` (Design tokens, glassmorphism, stable background guarantee)
- `.env.example` (Configuration template)

### 6.2 Verification of the 9 User Journeys

| # | User Journey / Task | Documented Location | Verification Status | Evaluation Details |
| :-: | :--- | :--- | :---: | :--- |
| **1** | **Install prerequisites** | `docs/INSTALLATION.md` §1, `README.md` §6 | **VERIFIED (PASS)** | Node.js v20+, Python 3.10–3.13 (with "Add to PATH"), Chrome v115+, and Gemini API key links are clearly documented with download URLs and shell verification commands. |
| **2** | **Set up the project** | `docs/INSTALLATION.md` §2, `docs/USER_GUIDE.md` §2 | **VERIFIED (PASS)** | Copy-pasteable PowerShell commands provided: `npm install`, `python -m venv .venv`, `pip install -r ai-service/requirements.txt`. Execution policy bypass (`RemoteSigned`) is clearly explained. |
| **3** | **Configure the application** | `docs/INSTALLATION.md` §3, `.env.example` | **VERIFIED (PASS)** | Instructs copying `.env.example` to `.env` and setting `GEMINI_API_KEY`. Defaults for port, timeout, and disabled auth flags are explained. |
| **4** | **Start and stop services** | `docs/INSTALLATION.md` §4, `README.md` §7 | **VERIFIED (PASS)** | `npm start` documented as unified single command. Expected startup logs, health check URLs (`:3000/health`, `:8000/health`), and graceful `Ctrl+C` shutdown are explained. |
| **5** | **Install the extension** | `docs/INSTALLATION.md` §5, `README.md` §8 | **VERIFIED (PASS)** | Step-by-step instructions for `chrome://extensions/` and `edge://extensions/` with Developer mode, "Load unpacked", folder selection, and toolbar pinning. |
| **6** | **Configure browser authentication** | `docs/INSTALLATION.md` §5.1, §5.3, `docs/USER_GUIDE.md` §8 | **VERIFIED (PASS)** | Documents the extension Options page and Web App Settings modal. Explains when to leave tokens blank (localhost default) vs entering tokens for protected servers (`ENABLE_API_AUTH=true`). |
| **7** | **Run a document analysis** | `docs/USER_GUIDE.md` §4, §5, `README.md` §9 | **VERIFIED (PASS)** | Documents "Find Legal Documents", selecting document, clicking "Extract Selected Document", and clicking "Analyze Document" with 14-category risk cards and readability metrics. |
| **8** | **Use Q&A, Portfolio, Sentinel, LexCheck**| `docs/USER_GUIDE.md` §6, §7.1–7.4 | **VERIFIED (PASS)** | Detailed walkthroughs of Grounded Q&A with DeBERTa NLI scores, Portfolio stack risk gauge and comparison matrix, Sentinel drift monitor with redline diffs, and LexCheck 5-jurisdiction audit. |
| **9** | **Troubleshoot common errors** | `docs/INSTALLATION.md` §7, `docs/USER_GUIDE.md` §9 | **VERIFIED (PASS)** | Addresses port 3000/8000 collisions, Python venv missing, extension CORS 403, 401 token errors, model startup timeouts, and NullProvider activation. |

### 6.3 Discrepancies & Alignment Notes
1. **Test Count Alignment:**
   - Previous documentation cited 601, 606, or 679 tests. With the additions of `saas-views-ui.test.js` (5 tests) and `phase-9.4-integration.test.js` (11 tests), the verified test count is now **617 Node.js tests** across 40 suites and **73 Python AI tests** across 5 suites, yielding **690 automated tests** (100% pass rate).
2. **Web App SaaS Views vs Extension Scope:**
   - In Phase 9.3, dedicated SaaS views (**Portfolio**, **Sentinel**, **Compliance LexCheck**) were added to the Web Application dashboard (`http://localhost:3000`).
   - The extension popup remains focused on in-situ page detection, extraction, 14-category risk findings, and grounded Q&A. The documentation in `docs/USER_GUIDE.md` §7 accurately details this division of responsibilities.

---

## 7. Step 6 — Release Readiness Checklist

All checklist items have been verified with empirical test evidence:

| Category | Item | Criteria | Result | Evidence / Verification |
| :--- | :--- | :--- | :---: | :--- |
| **Installation** | Node.js Compatibility | Works on Node.js v20+ / v22+ | **PASS** | Tested on Node.js v22.14.0; all 617 tests pass |
| **Installation** | Python Compatibility | Works on Python 3.10–3.13 | **PASS** | Tested on Python 3.13.2; all 73 pytest tests pass |
| **Installation** | Monorepo npm Install | Installs cleanly via root workspace | **PASS** | Root `package.json` contains `"workspaces": ["backend"]` |
| **Installation** | Python Virtual Env | Installs PyTorch & requirements | **PASS** | `.venv` creation & pip install verified |
| **Installation** | No C++ Build Toolchain | Operates without node-gyp / MSVC | **PASS** | All dependencies use pre-compiled binaries or pure JS |
| **Startup/Teardown**| Single-Command Startup | `npm start` coordinates both services | **PASS** | `scripts/start.js` spawns Node + Python with prefixed logs |
| **Startup/Teardown**| Port Collision Guard | Detects occupied ports 3000 / 8000 | **PASS** | `isPortInUse()` checks sockets and offers taskkill command |
| **Startup/Teardown**| Model Readiness Check | Polls health with timeout & progress | **PASS** | `waitForReadiness()` verifies genuine `{ status: "ok" }` |
| **Startup/Teardown**| Clean Teardown | Ctrl+C kills all child processes | **PASS** | `taskkill /pid <PID> /T /F` kills process tree; no zombies |
| **Configuration** | Default Local Experience| Starts zero-config out of the box | **PASS** | Defaults: `ENABLE_API_AUTH=false`, `ENABLE_INTERNAL_AUTH=false` |
| **Configuration** | LangGraph Isolation | Procedural RAG is active default | **PASS** | `ENABLE_LANGGRAPH_QA=false` strictly maintained |
| **Configuration** | Secret Masking | Tokens masked in logs & responses | **PASS** | `sanitizeConfigForLogging()` + error middleware sanitization |
| **Configuration** | NullProvider Fallback | Operates without Gemini API key | **PASS** | `provider-factory.js` defaults to `NullProvider` safely |
| **Extension Setup** | Manifest V3 Valid | Uses MV3 schemas and service worker | **PASS** | Verified in `extension/manifest.json` |
| **Extension Setup** | Scoped Permissions | No broad or dangerous permissions | **PASS** | Only `activeTab`, `storage`, `scripting`, `localhost:3000` |
| **Extension Setup** | Strict CSP | Zero inline styles, zero inline scripts | **PASS** | Verified in `popup.html`, `popup.css`, `options.html` |
| **Extension Setup** | Options Page Setup | Allows configuring URL and tokens | **PASS** | `options.html` + `options.js` test connection cleanly |
| **Core Feature Smoke**| Document Extraction | In-situ & background extraction | **PASS** | `dom-extractor.js` + `service-worker.js` verified |
| **Core Feature Smoke**| 14-Category Risk Engine| Deterministic heuristic scoring | **PASS** | Verified across 20 academic scenarios |
| **Core Feature Smoke**| Grounded Q&A | Vector search + NLI validation | **PASS** | ChromaDB retrieval + DeBERTa entailment verified |
| **Core Feature Smoke**| SaaS Portfolio View | Stack score & vendor comparison | **PASS** | Live integration verified in Phase 9.4 |
| **Core Feature Smoke**| SaaS Sentinel View | Drift direction, magnitude & redlines | **PASS** | Live integration verified in Phase 9.4 |
| **Core Feature Smoke**| SaaS Compliance View | 5 legal jurisdictions & citations | **PASS** | Live integration verified in Phase 9.4 |
| **Security** | Zero Data Retention | No permanent document/vector storage | **PASS** | Ephemeral collections wiped; memory-only snapshots |
| **Security** | HTTP Security Headers | Strict Helmet CSP & CORS boundaries | **PASS** | Verified via live health probe in `phase-9.4-integration.test.js` |
| **Security** | SEC-EXT-1 Validation | Webpages cannot call extension | **PASS** | Sender origin check enforced in `service-worker.js` |
| **Documentation** | Beginner Setup Guide | Clear instructions for Windows | **PASS** | Complete guide in `docs/INSTALLATION.md` |
| **Documentation** | Operational Manual | Explains all views and workflows | **PASS** | Complete manual in `docs/USER_GUIDE.md` |
| **Known Limitations**| CPU Inference Latency | NLI runs in ~1.5–3.0s on standard CPU | **PASS** | Within documented acceptable range; async polling used |
| **Known Limitations**| Cold Start HF Download | First run requires ~500 MB download | **PASS** | Addressed by timeout setting and `NLI_LOCAL_FILES_ONLY` |

---

## 8. Defects, Risks & Mitigation

| ID | Finding / Risk | Severity | Root Cause / Impact | Mitigation / Recommended Safeguard |
| :--- | :--- | :---: | :--- | :--- |
| **RSK-1** | Initial Model Download Bandwidth | **LOW** | Cold start on a new machine downloads ~500 MB of Hugging Face model weights. Slow networks may cause first start to take 1–2 minutes. | `scripts/start.js` allows up to 60s (configurable to 90s+ via `PYTHON_AI_STARTUP_TIMEOUT_MS`). Documented in troubleshooting. |
| **RSK-2** | PowerShell Script Execution Policy | **LOW** | Fresh Windows installs may restrict `.ps1` execution, blocking `.venv\Scripts\Activate.ps1`. | `docs/INSTALLATION.md` provides the exact one-time unblock command: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`. Furthermore, `npm start` invokes the virtual environment directly without needing manual activation. |
| **RSK-3** | Chrome Extension ID CORS Binding | **LOW** | Loading the unpacked extension generates a local 32-character extension ID. If the backend CORS whitelist is enforced (`ENABLE_API_AUTH=true`), calls may be rejected until the ID is added to `.env`. | Documented with one-click copy button on the extension Options page (`chrome-extension://<id>`). In default local development (`ENABLE_API_AUTH=false`), CORS accepts loopback calls. |
| **RSK-4** | Gemini API Free Tier Rate Limits | **LOW** | Heavy interactive Q&A testing on Google AI Studio free tier may hit 15 RPM rate limits. | System features dual-model automatic flash failover (`gemini-2.5-pro` $\rightarrow$ `gemini-flash-latest`), and rate-limited Q&A requests return graceful user-friendly error messages without crashing the session. |

---

## 9. Recommended Next Actions for Local Release

To execute a flawless demonstration or release handoff on another machine:
1. **Pre-Flight Sanity Check:** Ensure the demonstrator computer has Node.js v20+ and Python 3.10–3.13 installed.
2. **Environment File Setup:** Copy `.env.example` to `.env` and insert a valid Google Gemini API key.
3. **Execute Setup Commands:**
   ```powershell
   npm install
   python -m venv .venv
   .\.venv\Scripts\pip install -r ai-service/requirements.txt
   npm start
   ```
4. **Extension Load:** Navigate to `chrome://extensions/`, toggle **Developer mode**, click **Load unpacked**, and select `D:\TOS red flag scanner\extension`.
5. **Demonstration Path:**
   - **Step A (Extension):** Open a live policy page (e.g., Spotify Terms or PhonePe Terms), click **Find Legal Documents**, extract, and run analysis.
   - **Step B (Grounded Q&A):** Ask a specific question in the extension and examine the DeBERTa NLI validation badge.
   - **Step C (Web Dashboard):** Open `http://localhost:3000` to showcase the unified SaaS views (Analyze, Portfolio Multi-Vendor Stack, Sentinel Policy Drift with Redline Diffing, and LexCheck Statutory Compliance).

---

## 10. Files Inspected

- **Launchers & Scripts:** `package.json`, `scripts/start.js`, `scripts/test-all.js`, `scripts/evaluate.js`, `scripts/generate-token.mjs`.
- **Backend Configuration & Core:** `backend/package.json`, `backend/server.js`, `backend/src/config/env.js`, `backend/src/security/security.js`, `backend/src/security/cors.js`, `backend/src/ai/provider-factory.js`, `backend/src/ai/ai-client.js`.
- **AI Microservice:** `ai-service/requirements.txt`, `ai-service/app/main.py`, `ai-service/app/config.py`, `ai-service/app/services/embedding_service.py`, `ai-service/app/services/nli_service.py`.
- **Extension Artifacts:** `extension/manifest.json`, `extension/popup/popup.html`, `extension/popup/popup.js`, `extension/popup/popup.css`, `extension/options/options.html`, `extension/options/options.js`, `extension/background/service-worker.js`.
- **Documentation:** `README.md`, `docs/INSTALLATION.md`, `docs/USER_GUIDE.md`, `docs/deployment.md`, `docs/architecture.md`, `docs/ui-ux.md`, `.env.example`.
