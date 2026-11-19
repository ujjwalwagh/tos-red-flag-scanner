# Phase 8C.3A — Backend Authentication Architecture Design

**Project:** TOS Red Flag Scanner (PrismClause)  
**Document Version:** 1.0 (Phase 8C.3A Architecture Specification)  
**Status:** ARCHITECTURE DESIGN (READ-ONLY)  
**Scope:** Node.js Express API Gateway, Chrome MV3 Extension, Frontend Client, and Python AI Microservice  
**Target Vulnerabilities:** SEC-BACK-1 (Missing API Authentication), SEC-BACK-2 (Monolithic AI Rate Limiting), SEC-EXT-2 (Hardcoded Extension Backend URL)  

---

## 1. Executive Architecture Summary

During the Phase 8C.1 security assessment, the absence of backend API authentication (**SEC-BACK-1**) was identified as the primary critical blocker preventing remote public cloud deployment and multi-user staging. Currently, any client capable of establishing a network connection to the Express server can trigger costly Google Gemini LLM API calls and compute-intensive PyTorch DeBERTa NLI cross-encoder inferences.

This document establishes the authoritative technical blueprint for integrating **Bearer Token Authentication**, **Tiered AI Rate Limiting**, **Extension Configurable Endpoints**, and **Internal Microservice Token Protection** into the TOS Red Flag Scanner without disrupting existing localhost workflows, test suites, or contract schemas.

### Core Architectural Principles
1. **Zero Breaking Changes on Localhost:** A feature flag (`ENABLE_API_AUTH`, defaulting to `false` in development) guarantees that local development, automated test runners (567 passing tests), and developer workflows continue functioning without configuration friction.
2. **Strict Secret Decoupling:** Client tokens authenticate clients to the *TOS Red Flag Scanner Gateway*. Third-party AI credentials (such as `GEMINI_API_KEY`) remain strictly isolated on the backend server and are never exposed or transmitted to any client.
3. **No Hardcoded Client Secrets:** The Chrome Extension package and frontend JavaScript bundles will contain zero hardcoded secrets. Extension authentication will rely on user-configured tokens stored in isolated extension storage.
4. **Timing-Safe Cryptography:** All token comparisons use constant-time cryptographic hash verification (`crypto.timingSafeEqual`) to eliminate timing-attack vulnerabilities.
5. **Tiered Defense:** Rate limiting is decoupled by operational expense, enforcing strict per-minute quotas on Gemini/DeBERTa pipelines while allowing high throughput on deterministic heuristic routes.

---

## 2. Client-to-Backend Architecture & Route Inventory

### 2.1 Client Communication Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Current Client-to-Backend Topology                   │
└────────────────────────────────────────────────────────────────────────┘

 [ Client Tier ]
   ├─ Browser Dashboard (frontend/public/app.js)
   │    └─ Directly invokes relative /api/* paths via browser fetch()
   │
   ├─ Chrome MV3 Extension (popup/popup.js)
   │    └─ Sends internal chrome.runtime.sendMessage to background worker
   │
   └─ Chrome MV3 Background (background/service-worker.js)
        └─ Invokes hardcoded BACKEND_BASE_URL (http://localhost:3000)
             │
             ▼
 [ Gateway Tier ] (Node.js Express @ 127.0.0.1:3000)
   ├─ Helmet Security Headers & CORS Middleware
   ├─ Monolithic Rate Limiter (100 req / 15 min)
   ├─ Zero Authentication Middleware (All routes public)
   ├─ Deterministic Rule Engine & Readability Scoring
   ├─ Dual-Engine Q&A Orchestrator (Procedural & LangGraph)
   │    │
   │    ├─ External HTTPS (TLS 1.3) ──► Google Gemini API (gemini-2.5-pro)
   │    │                                (Authenticated via x-goog-api-key)
   │    ▼
   ▼ Internal Loopback HTTP (127.0.0.1:8000)
 [ Microservice Tier ] (Python FastAPI @ 127.0.0.1:8000)
   ├─ Sentence Transformers (all-MiniLM-L6-v2)
   ├─ ChromaDB EphemeralClient (In-memory vectors)
   ├─ DeBERTa-v3 Cross-Encoder (CPU sequence classification)
   └─ Zero Authentication Middleware
```

### 2.2 Complete Express API Route Inventory

| Route Path | HTTP Method | Controller / Handler | Calling Client(s) | Triggers External LLM? | Triggers Heavy CPU? | Target Auth Status | Target Rate Limit Tier |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/health` | GET | Inline health check | Ext, Monitor, Start script | No | No | **Public (Unauthenticated)** | Health Tier (60/min) |
| `/api/scan` | POST | `scanPolicyController` | Web App, Extension | No | Low (Cheerio / Regex) | **Protected (Bearer Token)** | Ingestion Tier (20/15m) |
| `/api/analyze` | POST | `analyzeDocumentController` | Web App | **Yes (Gemini)** | Medium (SentenceTrans) | **Protected (Bearer Token)** | Heavy AI Tier (10/min) |
| `/api/analyze/qa` | POST | `qaDocumentController` | Web App, Extension | **Yes (Gemini)** | **High (Chroma + DeBERTa)**| **Protected (Bearer Token)** | Heavy AI Tier (10/min) |
| `/api/analyze/categories` | GET | `getCategoriesController` | Web App | No | None (Static Array) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/analyze/compare` | POST | `compareClausesController` | Web App | No | Low (Lexical Jaccard) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/documents/ingest` | POST | `ingestDocumentController` | Web App | No | Medium (PDF in RAM) | **Protected (Bearer Token)** | Ingestion Tier (20/15m) |
| `/api/pdf/ingest` (alias) | POST | `ingestDocumentController` | Web App | No | Medium (PDF in RAM) | **Protected (Bearer Token)** | Ingestion Tier (20/15m) |
| `/api/remediation/*` | POST | `remediationRouter` | Web App | No | Low (Heuristic builder) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/negotiation/*` | POST | `negotiationRouter` | Web App | No | Low (Template builder) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/portfolio/*` | POST | `portfolioRouter` | Web App | No | Low (Matrix scoring) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/sentinel/*` | POST/GET | `sentinelRouter` | Web App | No | Low (Diff calculator) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/api/compliance/*` | POST/GET | `complianceRouter` | Web App | No | Low (Statute mapping) | **Protected (Bearer Token)** | General Tier (100/15m) |
| `/*` (Static Frontend) | GET | `express.static` | Browser | No | No | **Public (Unauthenticated)** | Web Assets |

---

## 3. Bearer Token Authentication Architecture

### 3.1 Authentication Workflow

```
Client (Extension / Web App)
     │
     │ 1. Request with Header: "Authorization: Bearer <token>"
     ▼
[ Express authenticateRequest Middleware ]
     │
     ├─► Is ENABLE_API_AUTH === false? ───(YES)──► Pass to next() (Dev Mode)
     │
     ├─► Is Route Public? (e.g. /health) ─(YES)──► Pass to next()
     │
     ├─► Missing or Malformed Authorization Header?
     │     └── Reject HTTP 401 Unauthorized { error: "Missing or malformed Authorization header." }
     │
     ├─► Extract Token string
     │
     ├─► Constant-Time Comparison against configured tokens (crypto.timingSafeEqual)
     │     │
     │     ├── Match Found ──► Attach req.clientInfo, Pass to next()
     │     │
     │     └── No Match ────► Reject HTTP 401 Unauthorized { error: "Invalid API access token." }
```

### 3.2 Secure Token Verification Implementation Design

In [`backend/src/security/auth.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/security/auth.js) (to be implemented in Phase 8C.3B):

```javascript
import crypto from "node:crypto";
import { config } from "../config/env.js";

/**
 * Constant-time comparison between two strings to prevent timing attacks.
 * Hashes both strings with SHA-256 before comparing buffers of equal length.
 */
export function safeTokenCompare(providedToken, expectedToken) {
  if (typeof providedToken !== "string" || typeof expectedToken !== "string") {
    return false;
  }
  if (!providedToken || !expectedToken) {
    return false;
  }

  const hashProvided = crypto.createHash("sha256").update(providedToken).digest();
  const hashExpected = crypto.createHash("sha256").update(expectedToken).digest();

  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

/**
 * Authentication middleware for Express.
 */
export function createAuthMiddleware(options = {}) {
  return function authenticate(req, res, next) {
    // 1. Bypass authentication if feature flag is disabled (Localhost Dev Default)
    if (config.auth?.enabled !== true && options.enforce !== true) {
      return next();
    }

    // 2. Allow unauthenticated access to designated public routes
    if (req.path === "/health" || req.path === "/") {
      return next();
    }

    // 3. Extract and validate Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== "string") {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_token"');
      return res.status(401).json({
        success: false,
        error: "Authentication required. Authorization header missing."
      });
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_request"');
      return res.status(401).json({
        success: false,
        error: "Invalid authorization format. Format must be 'Bearer <token>'."
      });
    }

    const providedToken = parts[1];
    const validTokens = options.validTokens || config.auth?.tokens || [];

    // 4. Verify provided token against authorized token pool
    const isValid = validTokens.some((validToken) => safeTokenCompare(providedToken, validToken));

    if (!isValid) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_token"');
      return res.status(401).json({
        success: false,
        error: "Invalid or revoked API access token."
      });
    }

    // 5. Attach authenticated context (never attach raw token string)
    req.authenticated = true;
    req.tokenIdentifier = crypto.createHash("sha256").update(providedToken).digest("hex").slice(0, 8);

    return next();
  };
}
```

---

## 4. Token Lifecycle, Provisioning & Storage

### 4.1 Token Entropy & Generation
- Tokens must be cryptographically unguessable, generated using high-entropy random byte streams:
  $$\text{Token} = \text{crypto.randomBytes}(32)\text{.toString}("hex") \quad (\approx 256 \text{ bits of entropy})$$
- Example format: `tos_live_7f8a3c9b2e1d4f5a...`

### 4.2 Server-Side Token Provisioning
- **Configuration:** Managed via `.env`:
  ```env
  ENABLE_API_AUTH=false                    # Default false for local dev; true for remote prod
  API_BEARER_TOKENS=tos_live_xxx,tos_live_yyy  # Comma-separated pool supporting zero-downtime rotation
  ```
- **Zero Token Leakage In Logs:** The centralized logger ([backend/src/utils/logger.js](file:///d:/TOS%20red%20flag%20scanner/backend/src/utils/logger.js)) will explicitly sanitize request headers:
  ```javascript
  // In logger.js: Never log Authorization header or raw tokens
  if (entry.headers?.authorization) {
    entry.headers.authorization = "[REDACTED]";
  }
  ```

---

## 5. Chrome Extension Authentication Strategy

### 5.1 The Client-Side Secret Dilemma
In browser extensions, code running in the background worker or popup is executed on the user's machine and can be inspected via Chrome DevTools or unpacked ZIP archives. Therefore:
- **Rule 1:** A permanent master server secret must **NEVER** be hardcoded in `extension/background/service-worker.js` or `manifest.json`.
- **Rule 2:** `chrome.storage.local` is **not a cryptographic hardware vault**; it is an isolated browser storage area. While protected against other websites by Chrome sandboxing, it is accessible to anyone with physical access to the local machine's user profile.

### 5.2 Two-Stage Extension Authentication Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Extension Authentication Modes                       │
└────────────────────────────────────────────────────────────────────────┘

 [ Mode 1: Localhost Development (Current Default) ]
   ├─ Backend: ENABLE_API_AUTH=false
   ├─ Extension: Connects to http://localhost:3000
   └─ Result: Zero configuration required. Developer tests pass immediately.

 [ Mode 2: Remote Production Distribution (Future Stage C) ]
   ├─ Backend: ENABLE_API_AUTH=true, bound to https://api.tosscanner.com
   ├─ Extension Options Page (Planned Phase 8C.4):
   │    ├─ User inputs Backend Base URL: https://api.tosscanner.com
   │    └─ User inputs Personal API Access Token: tos_live_xxx
   │
   ├─ Storage: Stored securely in chrome.storage.sync (or chrome.storage.local)
   │
   └─ Service Worker: Reads token from storage and injects:
        headers: {
          "Authorization": `Bearer ${storedToken}`,
          "Content-Type": "application/json"
        }
```

### 5.3 Web Application (`frontend/`) Authentication
For the browser web app served directly from the Node.js Express backend:
1. When accessed via same-origin (`http://127.0.0.1:3000`), the backend can generate an **ephemeral session token** or bootstrap CSRF token injected into a `<meta name="api-session-token" content="...">` tag in `index.html`.
2. `frontend/public/app.js` reads this session token on startup and automatically attaches `Authorization: Bearer <session-token>` to all downstream API requests.
3. This eliminates hardcoded credentials in `app.js` while securing the API against third-party non-browser scrapers.

---

## 6. Multi-Tier Rate-Limiting & Abuse Prevention Strategy

To address finding **SEC-BACK-2**, the monolithic rate limiter must be replaced with four specialized tiers configured in [backend/server.js](file:///d:/TOS%20red%20flag%20scanner/backend/server.js):

### 6.1 Rate Limit Tiers

| Tier Name | Target Routes | Window | Max Requests | Keying Strategy | Purpose |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Heavy AI Tier** | `/api/analyze/qa`, `/api/analyze` | 1 minute | **10 requests** | Token ID (or IP) | Guards Gemini API token quota and prevents CPU saturation on DeBERTa NLI cross-encoder. |
| **Ingestion Tier** | `/api/scan`, `/api/documents/ingest`, `/api/pdf/ingest` | 15 minutes | **25 requests** | Token ID (or IP) | Prevents DoS via repeated 10MB PDF uploads or rapid external URL fetching loops. |
| **General Tier** | `/api/remediation/*`, `/api/negotiation/*`, `/api/compliance/*`, `/api/sentinel/*`, `/api/portfolio/*`, `/api/analyze/categories`, `/api/analyze/compare` | 15 minutes | **100 requests** | Token ID (or IP) | Standard operational protection for deterministic business heuristics. |
| **Health Tier** | `/health` | 1 minute | **60 requests** | Client IP | Ensures uptime probes, Docker health checks, and extension connectivity pings never trigger rate-limiting blocks. |

### 6.2 Reverse-Proxy Trust Configuration (SEC-BACK-3)
When deployed behind an Nginx reverse proxy, Cloudflare, or AWS Application Load Balancer:
```javascript
// In backend/server.js:
if (config.trustProxy) {
  app.set("trust proxy", 1); // Trust first-hop reverse proxy
}
```
- **Security Guardrail:** `trust proxy` must remain disabled on local development (`false`), and enabled only in production when an upstream proxy strips spoofed `X-Forwarded-For` headers.

---

## 7. Python AI Microservice Protection (`ai-service/`)

### 7.1 Local vs. Network Threat Analysis
- **Current State:** The Python FastAPI microservice binds to `127.0.0.1:8000` and has zero authentication.
- **Local Machine Boundary:** Any unauthorized local user account or local background process on the host could send HTTP requests to `POST http://127.0.0.1:8000/ai/nli/validate` or `POST /ai/embed`.
- **Container / Pod Boundary:** In Docker Compose or Kubernetes, the Python microservice is exposed within the internal network bridge.

### 7.2 Internal Service Token (`X-Internal-Token`) Design
To prevent unauthorized microservice access without altering the existing API contracts:
1. **Shared Internal Secret:** Configured in `.env`:
   ```env
   INTERNAL_AI_SERVICE_TOKEN=tos_internal_ai_secret_xxx
   ```
2. **Node.js Client Injection:** In [`backend/src/ai/ai-client.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/ai/ai-client.js), every request sent to Python includes the internal header:
   ```javascript
   headers["X-Internal-Token"] = config.pythonAi.internalToken;
   ```
3. **FastAPI Header Verification:** In [`ai-service/app/main.py`](file:///d:/TOS%20red%20flag%20scanner/ai-service/app/main.py), a lightweight dependency or middleware verifies the header:
   ```python
   # In ai-service/app/security.py (planned):
   from fastapi import Header, HTTPException, status
   from app.config import settings

   def verify_internal_token(x_internal_token: Optional[str] = Header(None)):
       if not settings.INTERNAL_TOKEN:
           return  # Dev bypass when unconfigured
       if not x_internal_token or x_internal_token != settings.INTERNAL_TOKEN:
           raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden: Invalid internal token")
   ```
4. **Localhost Default:** If `INTERNAL_AI_SERVICE_TOKEN` is unset or blank, verification is bypassed, ensuring zero disruption to existing Python pytest suites (61 passing tests).

---

## 8. Compatibility Invariants & Risk Analysis

The authentication architecture maintains strict adherence to all existing project invariants:

| Component / Subsystem | Invariant Requirement | Preservation Mechanism |
| :--- | :--- | :--- |
| **API Response Envelope** | Responses must strictly preserve `{ success: true, qa: { ... } }` and `{ status: "ok" }`. | Auth middleware acts as a pre-route gatekeeper. Controllers and response serializers are completely unmodified. |
| **Feature Flag Invariant** | `ENABLE_LANGGRAPH_QA=false` must remain the default. | Authentication middleware is decoupled from Q&A engine selection. |
| **Dual-Engine Q&A** | Both Procedural and LangGraph engines must operate identically. | Token validation occurs before controller routing. Both engines inherit the same authenticated request context. |
| **Test Suite Baseline** | 506 Node.js + 61 Python tests (567 total) must pass 100%. | `ENABLE_API_AUTH=false` default ensures existing mock and integration tests execute with zero modifications. Test helpers can inject a test token when testing auth. |
| **Zero-Retention Privacy** | Documents, vectors, and graph states must remain strictly ephemeral. | Auth middleware handles token verification only. No payload text or request bodies are cached or written to disk. |

---

## 9. Phased Remediation Roadmap

To prevent regressions and ensure surgical verification, implementation must be executed across distinct, testable sub-phases:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Phased Authentication Implementation                 │
└────────────────────────────────────────────────────────────────────────┘

 [ Phase 8C.3B: Express Authentication Middleware & Unit Tests ]
   ├─ Implement backend/src/security/auth.js with constant-time token comparison
   ├─ Add config.auth settings in backend/src/config/env.js
   ├─ Mount auth middleware in backend/server.js (conditional on ENABLE_API_AUTH)
   ├─ Add 100% test suite for auth middleware (valid, missing, invalid tokens)
   └─ Verify 506 Node + 61 Python baseline passes cleanly
             │
             ▼
 [ Phase 8C.3C: Tiered Rate Limiting & Proxy Hardening ]
   ├─ Split express-rate-limit into Heavy AI, Ingestion, and General tiers
   ├─ Configure configurable trust proxy setting in server.js
   └─ Add tests verifying tiered rate limits
             │
             ▼
 [ Phase 8C.3D: Extension Options Page & Dynamic Endpoints (SEC-EXT-2) ]
   ├─ Add extension/options/options.html and options.js for user-configured tokens
   ├─ Update service-worker.js to read dynamic backend URL & Bearer token
   └─ Maintain localhost default for zero-config developer use
             │
             ▼
 [ Phase 8C.3E: Internal Python Service Token Protection ]
   ├─ Inject X-Internal-Token in backend/src/ai/ai-client.js
   ├─ Add token verification dependency in ai-service/app/main.py
   └─ Verify pytest suite passes with and without internal token
```

---

## 10. Security Boundaries & Residual Limitations

1. **Localhost Scope:** On personal development machines, binding to `127.0.0.1` remains the primary security perimeter. Enabling Bearer tokens adds defense-in-depth, but physical machine compromise still allows local process inspection.
2. **Client-Side Token Storage:** Tokens stored in the Chrome extension (`chrome.storage.sync` / `local`) or the browser web app are protected from remote cross-origin web scripts by browser sandboxing, but are not protected against local malware running with the user's OS privileges.
3. **Transport Security Assumption:** Bearer tokens sent in HTTP headers are vulnerable to interception if transmitted over plain HTTP over public networks. **All remote staging and cloud deployments mandate HTTPS (TLS 1.3) termination** at the ingress load balancer.

---

## 11. Conclusion

The authentication architecture specified above completely resolves **SEC-BACK-1** and **SEC-BACK-2** while providing the technical foundation to resolve **SEC-EXT-2**. By utilizing feature flags, constant-time verification, and tiered rate limiting, the system is fully prepared for safe, incremental implementation in Phase 8C.3B without endangering existing functionality.
