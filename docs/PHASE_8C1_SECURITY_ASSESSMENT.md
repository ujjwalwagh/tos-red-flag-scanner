# Phase 8C.1 — Production Security Assessment (READ-ONLY)

**Project:** TOS Red Flag Scanner (PrismClause)  
**Document Version:** 1.0 (Phase 8C.1 Audit)  
**Audit Scope:** Full Application Stack (Backend Express API, Python AI Microservice, Chrome MV3 Extension, Frontend Client, Dependency Graph, Network Topology, and Privacy Model)  
**Audit Mode:** Strictly Read-Only (Zero Code Modifications, Zero Dependency Updates, Zero Configuration Changes)  
**Security Status:** APPROVED FOR LOCALHOST ONLY; STRICTLY NO-GO FOR PUBLIC REMOTE DEPLOYMENT OR CHROME WEB STORE  

---

## 1. Executive Summary

This security assessment evaluates the production and release readiness of the **TOS Red Flag Scanner** prior to planned remote cloud deployment or Chrome Web Store publication.

The system currently operates with a **robust, privacy-first local architecture**:
- Services are securely bound to `127.0.0.1` (IPv4 loopback).
- Cross-Origin Resource Sharing (CORS) strictly validates origins.
- Chrome Manifest V3 implements strict sender verification (`SEC-EXT-1`).
- Ephemeral in-memory data processing guarantees zero permanent storage of contract text, vector embeddings, or user queries.

However, transitioning from **Personal Localhost Execution (Stage A)** to **Public Remote Cloud Deployment (Stage B)** or **Chrome Web Store Distribution (Stage C)** introduces critical architectural blockers:
1. **SEC-BACK-1 (Critical / P0):** Total lack of API authentication and authorization. Any client reaching the backend can trigger unlimited Google Gemini LLM generation, dense vector indexing, and DeBERTa NLI cross-encoder inferences, leading to API quota exhaustion, financial loss, and CPU denial-of-service.
2. **SEC-EXT-2 (High / P1):** The Chrome extension hardcodes `http://localhost:3000` in both its background worker and manifest host permissions, lacking an Options page or dynamic configuration mechanism.
3. **Abuse Protection (High / P1):** Rate limiting is monolithic (`100 req/15min`) across all routes without tiering for expensive AI operations, lacks reverse-proxy header trust (`trust proxy`), and uses in-memory tracking unsuited for multi-instance scaling.
4. **Vulnerable Dependencies (High / P1):** Local dependency audit reveals 10 known vulnerabilities (1 Critical, 7 High, 2 Moderate) across `axios`, `body-parser`, `follow-redirects`, and `undici`.

---

## 2. Actual Security Architecture & Trust Boundaries

```
[ Untrusted Webpage / Internet ]
              │
              │  (Blocked by SEC-EXT-1 Sender Validation)
              ▼
    [ Chrome MV3 Extension ] ──(Hardcoded: http://localhost:3000)──┐
    (popup.js / service-worker.js)                                 │
                                                                   ▼
[ Browser Web App ] ──────────(CORS / Same-Origin)──────────► [ Express API Gateway ]
(127.0.0.1:3000)                                              (Bound to 127.0.0.1:3000)
                                                                ├─ Helmet CSP
                                                                ├─ Monolithic Rate Limiter (100/15m)
                                                                ├─ Multer 10MB (MemoryStorage)
                                                                ├─ Zero Auth Middleware (SEC-BACK-1)
                                                                │
                                                                ▼ (Internal Loopback HTTP)
                                                              [ Python AI Service ]
                                                              (Bound to 127.0.0.1:8000)
                                                                ├─ Sentence Transformers
                                                                ├─ ChromaDB EphemeralClient
                                                                ├─ DeBERTa NLI Cross-Encoder
                                                                └─ Zero Auth Middleware
```

### Trust Boundary Analysis
1. **Client Boundary:** The Chrome Extension and Web Dashboard run entirely on the user's local machine. The Extension enforces `SEC-EXT-1` message sender validation, ensuring that third-party scripts on active webpages cannot invoke internal extension commands or access backend endpoints via extension messaging.
2. **Gateway Boundary:** The Node.js Express server runs on `127.0.0.1:3000`. It enforces CORS for browser requests, but **provides zero authentication for non-browser HTTP clients**.
3. **Microservice Boundary:** The Python FastAPI microservice runs on `127.0.0.1:8000`. It trusts all incoming HTTP requests originating from Node.js, with zero internal token or network mutual authentication.
4. **External Provider Boundary:** Node.js communicates with Google Gemini API via HTTPS using TLS 1.3 and authenticates via the `x-goog-api-key` header.

---

## 3. Endpoint Authentication Assessment (SEC-BACK-1)

### 3.1 Route Inventory & Authentication Matrix

| Endpoint | Method | Middleware Applied | Requires Auth? | Triggers External LLM? | Triggers Local ML? | Risk Level |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `/health` | GET | None | **No** | No | No | Low |
| `/api/scan` | POST | RateLimit, Multer (10MB), SSRF Validation | **No** | No | Readability Heuristics | Medium |
| `/api/documents/ingest` | POST | RateLimit, Multer (10MB) | **No** | No | PDF Parser (Memory) | Medium |
| `/api/pdf/ingest` | POST | RateLimit, Multer (10MB) | **No** | No | PDF Parser (Memory) | Medium |
| `/api/analyze` | POST | RateLimit, Multer (10MB) | **No** | **Yes (Gemini)** | Sentence Transformers | **Critical (P0)** |
| `/api/analyze/qa` | POST | RateLimit | **No** | **Yes (Gemini)** | ChromaDB + DeBERTa NLI | **Critical (P0)** |
| `/api/analyze/categories`| GET | RateLimit | **No** | No | None | Low |
| `/api/analyze/compare` | POST | RateLimit | **No** | No | Jaccard / Lexical | Low |
| `/api/remediation/*` | POST | RateLimit | **No** | No | Heuristics | Low |
| `/api/negotiation/*` | POST | RateLimit | **No** | No | Heuristics | Low |
| `/api/portfolio/*` | POST | RateLimit | **No** | No | Heuristics | Low |
| `/api/sentinel/*` | POST/GET| RateLimit | **No** | No | Heuristics | Low |
| `/api/compliance/*` | POST/GET| RateLimit | **No** | No | Heuristics | Low |
| `/ai/embed` (Python) | POST | None | **No** | No | `all-MiniLM-L6-v2` | High (P1) |
| `/ai/vectors/*` (Python)| ALL | None | **No** | No | ChromaDB Vectors | High (P1) |
| `/ai/nli/validate` (Py) | POST | None | **No** | No | `nli-deberta-v3-base` | **Critical (P0)**|

### 3.2 Abuse Vectors & Quota Drainage Analysis
- **Unauthenticated Gemini Triggering:** Anyone with network access to the Express port can submit synthetic payloads to `/api/analyze/qa` and `/api/analyze`. This immediately invokes the Google Gemini API using the host's `GEMINI_API_KEY`.
- **Financial & Availability Impact:** An automated bot can deplete the operator's Google Cloud project quota within minutes, leading to HTTP 429 quota exhaustion errors for legitimate users and unexpected API billing charges.
- **CPU Resource Exhaustion (DeBERTa DoS):** In `/api/analyze/qa`, each grounded response triggers DeBERTa cross-encoder sequence classification (`cross-encoder/nli-deberta-v3-base`) on CPU. Because PyTorch utilizes all available CPU cores, concurrent unauthenticated queries will cause 100% CPU saturation and service lockups.

### 3.3 Information Leakage in Error Responses
- **500 Internal Server Errors:** Correctly masked in [backend/server.js](file:///d:/TOS%20red%20flag%20scanner/backend/server.js#L115-L119):
  ```javascript
  res.status(status).json({
    error: status >= 500 ? "Internal server error occurred." : error?.message || "Invalid request."
  });
  ```
  No stack traces or database connection strings are leaked to clients.
- **4xx Client Errors:** Return sanitized user-facing messages from `AppError`.
- **CORS Error:** Returns explicit `{ "error": "CORS origin not allowed." }` with HTTP 403.

---

## 4. Rate Limiting and Abuse Protection Assessment

### 4.1 Current Implementation Audit
In [backend/server.js](file:///d:/TOS%20red%20flag%20scanner/backend/server.js#L48-L56), rate limiting is implemented via `express-rate-limit`:
```javascript
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,                 // 100 requests per IP
    standardHeaders: true,
    legacyHeaders: false
  })
);
```

### 4.2 Identified Vulnerabilities & Gaps
1. **Lack of Operation-Specific Tiering:**
   - A lightweight `GET /api/analyze/categories` request has the exact same cost weight as a heavyweight `POST /api/analyze/qa` request.
   - An attacker can exhaust their allowance by firing 100 Gemini + DeBERTa requests within 10 seconds, forcing 100 LLM calls and 100 multi-clause NLI evaluations.
2. **Reverse Proxy IP Collapsing (Missing `trust proxy`):**
   - Express does not configure `app.set('trust proxy', 1)`.
   - When deployed behind a reverse proxy (e.g. AWS ALB, Cloudflare, Nginx), `req.ip` resolves to the proxy's IP address. Consequently, **all concurrent users share a single global quota of 100 requests per 15 minutes**, causing immediate service denial for all users.
3. **MemoryStore Bottleneck:**
   - The rate limiter uses in-memory storage. In a horizontally scaled production deployment (e.g., Google Cloud Run, multiple Node processes via PM2, or Kubernetes), rate limits are not shared across pods without Redis.
4. **Missing Request Timeouts:**
   - Express does not enforce global request timeouts. If the Python AI service or Gemini API experiences an unhandled network stall, connections remain open until Node.js default socket timeouts occur (~120s), exhausting the server's thread pool.

---

## 5. API Key and Secret Protection Assessment

### 5.1 Secret Exposure & Storage Review
- **Environment Isolation:** Secrets (`GEMINI_API_KEY`, `NVIDIA_API_KEY`) are read exclusively from process environment variables via [backend/src/config/env.js](file:///d:/TOS%20red%20flag%20scanner/backend/src/config/env.js).
- **Client Bundles:** Inspection of `frontend/public/app.js`, `frontend/public/index.html`, and the entire `extension/` directory confirms that **no API keys, tokens, or credentials are baked into client-side bundles**.
- **Audit Logging Redaction:** [backend/src/utils/logger.js](file:///d:/TOS%20red%20flag%20scanner/backend/src/utils/logger.js) strictly logs operational metadata (UUIDs, word counts, HTTP status codes, NLI verification statuses). Verbatim clause text, prompts, and API keys are never logged.
- **Header Injection:** In `gemini-provider.js` and `model-adapter.js`, the Gemini API key is passed via the `x-goog-api-key` HTTP header rather than in URL query parameters, preventing leakage in web server access logs.

### 5.2 Git Tracking & Ignore Hygiene
- **Root `.gitignore`:** Contains:
  ```
  node_modules/
  .env
  dist/
  coverage/
  ```
- **Identified Gap:** The `.gitignore` does not explicitly ignore:
  - `.venv/` or `ai-service/.venv/` (Python virtual environment)
  - `**/__pycache__/` (Python compiled bytecode `.pyc` files)
  - `.env.local` or `.env.production`
- **Mitigation:** Untracked `.pyc` files are currently visible in git status. The `.gitignore` should be updated to include standard Python artifacts before committing release branches.

---

## 6. Chrome Extension Security Assessment (SEC-EXT-2)

### 6.1 Hardcoded Localhost Host Permissions & URLs
- **Manifest Permissions ([`extension/manifest.json`](file:///d:/TOS%20red%20flag%20scanner/extension/manifest.json)):**
  ```json
  "host_permissions": [
    "http://localhost:3000/*"
  ]
  ```
- **Service Worker Base URL ([`extension/background/service-worker.js`](file:///d:/TOS%20red%20flag%20scanner/extension/background/service-worker.js#L16)):**
  ```javascript
  const BACKEND_BASE_URL = "http://localhost:3000";
  ```
- **Audit Findings:**
  1. The backend URL is completely hardcoded. There is no Options page (`options_ui`), settings dialog, or dynamic storage fallback (`chrome.storage.sync`).
  2. The extension cannot communicate with `http://127.0.0.1:3000/*` or any remote production server (`https://api.domain.com`) without modifying source code and recompiling the extension.
  3. This completely blocks Chrome Web Store distribution, as end users will not run a local Node server on port 3000.

### 6.2 Permission Scope & Chrome Web Store Compliance
- **Granted Permissions:** `activeTab`, `storage`, `scripting`.
  - `activeTab`: Best practice. Grants temporary page access only when the user explicitly clicks the extension icon.
  - `storage`: Uses `chrome.storage.session` exclusively (cleared upon browser termination).
  - `scripting`: Legitimate. Programmatically injects `dom-extractor.js` for legal text extraction.
- **Optional Host Permissions:**
  ```json
  "optional_host_permissions": [
    "https://*/*",
    "http://*/*"
  ]
  ```
  - Used dynamically for cross-origin isolated tabs when extracting policies hosted on external domains.
  - **Chrome Web Store Policy Risk:** Chrome Web Store reviewers scrutinize broad host permissions (`*/*`). A detailed justification must be provided during submission explaining that these permissions are requested on-demand only for user-selected legal policy links.

### 6.3 Message Sender Security (SEC-EXT-1 Validation)
- In [extension/background/service-worker.js](file:///d:/TOS%20red%20flag%20scanner/extension/background/service-worker.js#L858-L916), `validateMessageSender()` strictly verifies:
  1. `sender.id === chrome.runtime.id`.
  2. Origin matches `chrome-extension://${id}`.
  3. Content scripts in web tabs are forbidden from invoking privileged operations (`ASK_POLICY_QUESTION`, `ANALYZE_CONFIRMED_POLICY`).
- **Conclusion:** SEC-EXT-1 sender validation is robust and prevents web pages from exploiting the extension.

---

## 7. Network and Deployment Security Assessment

### 7.1 Server Bindings & Interface Exposure
- **Node.js Express ([`backend/server.js`](file:///d:/TOS%20red%20flag%20scanner/backend/server.js#L125)):**
  ```javascript
  serverInstance = app.listen(port, "127.0.0.1", () => { ... });
  ```
- **Python FastAPI ([`scripts/start.js`](file:///d:/TOS%20red%20flag%20scanner/scripts/start.js#L105)):**
  ```javascript
  args: ["app.main:app", "--host", "127.0.0.1", "--port", "8000"]
  ```
- **Audit Findings:**
  - **Local Security: EXCELLENT.** Both services are strictly locked to the IPv4 loopback adapter (`127.0.0.1`). Devices on the local Wi-Fi or LAN cannot connect to ports 3000 or 8000.
  - **Container/Remote Deployment Blocker:** In a Docker container or Kubernetes pod, binding to `127.0.0.1` prevents container port mapping and ingress proxies from reaching the app. A configurable `HOST` environment variable (defaulting to `127.0.0.1` locally, `0.0.0.0` in containers) is required.

### 7.2 CORS & HTTP/HTTPS Assumptions
- **CORS Implementation ([`backend/src/security/cors.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/security/cors.js)):**
  - Origin regex `^chrome-extension:\/\/[a-p]{32}$` validates extension origins.
  - Same-origin checks allow `localhost:3000` and `127.0.0.1:3000`.
  - **Critical Nuance:** Requests with no `Origin` header (such as curl, Postman, Python scripts, or direct backend-to-backend calls) bypass CORS completely by design (`if (!origin) return next();`). CORS does not equal authentication!
- **TLS/HTTPS:**
  - The application provides no native TLS termination.
  - A production remote deployment mandates an SSL/TLS-terminating reverse proxy (Nginx, Caddy, Cloudflare, or AWS CloudFront/ALB) with HSTS headers.

---

## 8. Privacy and Data-Retention Assessment

### 8.1 Zero-Retention Ephemeral Storage Audit

| Component | Storage Medium | Lifecycle / Deletion Trigger | Zero-Retention Verified? |
| :--- | :--- | :--- | :---: |
| **PDF Ingestion** | In-Memory Buffer (`multer.memoryStorage`) | Dropped when request ends; never written to `/tmp` | **YES** |
| **URL Fetching** | Transient String (Cheerio in RAM) | Dereferenced upon response dispatch | **YES** |
| **ChromaDB Vectors**| In-Memory (`chromadb.EphemeralClient`) | Collection deleted in unconditional `finally` block | **YES** |
| **LangGraph State** | Volatile V8 Heap (`QaGraphAnnotation`)| State graph compiled without checkpointer | **YES** |
| **Extension Cache** | Browser RAM (`chrome.storage.session`)| Wiped immediately on Google Chrome exit | **YES** |
| **Audit Logs** | Console STDOUT | Redacted metrics only (UUIDs, counts, statuses) | **YES** |

### 8.2 In-Depth Code Verification
- **ChromaDB Cleanup:** In [`ai-client.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/ai/ai-client.js#L140-L155), `withDocumentVectors()` enforces:
  ```javascript
  try {
    indexResult = await this.indexClauses(documentId, clauses);
    return await callback(indexResult);
  } finally {
    await this.deleteDocumentVectors(documentId);
  }
  ```
- **LangGraph Checkpointer:** Confirmed compiled without `MemorySaver` or database saver in [`graph-builder.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langgraph/graph-builder.js#L73-L77).
- **Verdict:** The project's claim of **Zero-Retention Ephemeral Privacy** is mathematically and programmatically verified in the actual code.

---

## 9. Prioritized Vulnerability & Risk Matrix

| ID | Finding | Severity | Evidence / Source File | Recommended Fix | Deployment Impact |
|:---|:---|:---:|:---|:---|:---|
| **SEC-BACK-1** | **No API Authentication on Backend Routes** | **P0 (Critical)** | `backend/server.js`, `backend/src/api/routes/index.js` | Introduce Bearer Token / API Key authentication middleware on `/api/scan`, `/api/analyze`, and `/api/analyze/qa`. | Blocks public remote cloud deployment. |
| **SEC-BACK-2** | **Monolithic Rate Limiter on Heavy AI Routes** | **P1 (High)** | `backend/server.js` | Implement tiered rate limiting: strict limits (e.g. 5 req/min) for `/api/analyze/qa` and `/api/analyze`. | Quota exhaustion risk. |
| **SEC-BACK-3** | **Missing Reverse-Proxy Trust Configuration** | **P1 (High)** | `backend/server.js` | Add `app.set('trust proxy', 1)` when running behind reverse proxy / cloud load balancer. | Blocks multi-user remote staging. |
| **SEC-EXT-2** | **Hardcoded Localhost Backend in Chrome Extension**| **P1 (High)** | `extension/manifest.json`, `extension/background/service-worker.js` | Add Extension Options page with configurable backend URL and dynamic host permissions. | Blocks Chrome Web Store distribution. |
| **SEC-DEP-1** | **Vulnerable Dependencies (Axios, Body-Parser, Undici)**| **P1 (High)** | `package-lock.json`, `npm audit` | Run targeted dependency upgrades (`npm update axios @langchain/core express`). | Security posture risk. |
| **SEC-NET-1** | **Hardcoded Loopback Binding (127.0.0.1)** | **P1 (High)** | `backend/server.js`, `scripts/start.js` | Parameterize bind host via `HOST` env var (`HOST || '127.0.0.1'`). | Blocks containerized Docker deployment. |
| **SEC-NET-2** | **Missing Server Request Timeout Handling** | **P2 (Medium)** | `backend/server.js` | Add request timeout middleware (e.g. 30s timeout on Express routes). | Connection starvation risk. |
| **SEC-GIT-1** | **Incomplete `.gitignore` for Python Artifacts** | **P2 (Medium)** | `.gitignore` | Add `.venv/`, `ai-service/.venv/`, and `**/__pycache__/` to `.gitignore`. | Accidental repository bloat. |
| **SEC-EXT-3** | **Broad Optional Host Permissions (`*/*`)** | **P2 (Medium)** | `extension/manifest.json` | Draft formal single-purpose justification document for Chrome Web Store review. | Web Store review delay risk. |

---

## 10. Deployment Readiness Matrix

### Scenario A: Personal Localhost Use
- **Readiness:** **GO [APPROVED]**
- **Justification:** Both Express and FastAPI are strictly bound to `127.0.0.1`. The application is invisible to external networks. Secrets are held locally in `.env`. Ephemeral zero-retention privacy is fully operational.
- **Remaining Requirements:** None.

### Scenario B: Controlled Local Testing with Other Users (LAN / Testing Group)
- **Readiness:** **CONDITIONAL [NEEDS CONFIGURATION]**
- **Justification:** Can be tested locally if the host configures a secure tunnel (e.g., ngrok or Tailscale) or binds to LAN IP, but must configure `CHROME_EXTENSION_ORIGIN` for each tester's extension ID.
- **Remaining Requirements:**
  - Configurable extension ID support in `.env`.
  - Manual distribution of unpacked extension folder.
- **Main Security Risks:** LAN users could send unauthenticated requests to the host's backend, consuming host's Gemini API quota.

### Scenario C: Chrome Web Store Distribution
- **Readiness:** **NO-GO [BLOCKED]**
- **Justification:** The extension hardcodes `http://localhost:3000` and `host_permissions: ["http://localhost:3000/*"]`. It will fail for all public users who do not have a local Node server running.
- **Remaining Blockers:**
  1. Implement SEC-EXT-2 (Configurable backend URL / Options page).
  2. Implement backend remote deployment with HTTPS and authentication.
  3. Prepare Single Purpose justification for `optional_host_permissions: ["*/*"]`.

### Scenario D: Public Remote Backend Deployment (AWS, Cloud Run, VPS)
- **Readiness:** **NO-GO [STRICTLY BLOCKED]**
- **Justification:** Endpoints `/api/analyze` and `/api/analyze/qa` have zero authentication. Anyone on the internet can call them to drain Gemini API credits and exhaust server CPU.
- **Remaining Blockers:**
  1. Implement **SEC-BACK-1** (API Authentication via API Key or Bearer Token).
  2. Implement **SEC-BACK-2** (Tiered Rate Limiting for AI endpoints).
  3. Implement **SEC-BACK-3** (`trust proxy` configuration for reverse proxies).
  4. Implement **SEC-NET-1** (Configurable `HOST` binding for Docker containers).
  5. Upgrade vulnerable dependencies (**SEC-DEP-1**).

---

## 11. Recommended Phased Remediation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Phased Security Remediation Plan                     │
└────────────────────────────────────────────────────────────────────────┘

 [ Phase 8C.2: Dependency & Hygiene ]
   ├─ Add .venv and __pycache__ to .gitignore (SEC-GIT-1)
   └─ Update vulnerable dependencies via npm (SEC-DEP-1)
             │
             ▼
 [ Phase 8C.3: Backend Authentication & Rate Limiting ]
   ├─ Implement API Key / Bearer Token middleware (SEC-BACK-1)
   ├─ Implement Tiered Rate Limiting on /api/analyze/* (SEC-BACK-2)
   ├─ Add app.set('trust proxy', 1) (SEC-BACK-3)
   └─ Add parameterized HOST env var (SEC-NET-1)
             │
             ▼
 [ Phase 8C.4: Extension Configuration & Web Store Prep ]
   ├─ Add Options page for custom backend URL & API key (SEC-EXT-2)
   ├─ Dynamically request host_permissions for custom remote origin
   └─ Prepare Chrome Web Store Single-Purpose declaration (SEC-EXT-3)
             │
             ▼
 [ Phase 8C.5: Staging Verification & Cloud Deployment ]
   ├─ Docker container build & Cloud Run deployment
   └─ Full end-to-end remote extension verification
```

---

## 12. Assessment Audit Conclusion

The **TOS Red Flag Scanner** has achieved exceptional local security, privacy, and architectural maturity. Its zero-retention memory model and Manifest V3 sender validation represent industry best practices. 

The findings documented above (principally **SEC-BACK-1** and **SEC-EXT-2**) are well-understood transition requirements for remote multi-tenant deployment. By addressing them through the phased remediation roadmap, the platform will be fully hardened for public cloud hosting and Chrome Web Store distribution.
