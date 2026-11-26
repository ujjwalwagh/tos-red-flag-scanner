# PrismClause (ToS Red Flag Scanner) — Security & Privacy Specification

**Project:** PrismClause / ToS Red Flag Scanner
**Document Version:** 3.0 (Consolidated Master Security Specification)
**Status:** Authoritative Security Model
**Classification:** Public Engineering & Audit Guide

---

## 1. Executive Security Architecture

PrismClause is designed with a **local-first, zero-retention privacy architecture**. The application analyzes potentially sensitive consumer legal agreements, employment contracts, and privacy policies without persisting contract text, user questions, or semantic embeddings to disk or databases.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         TRUST BOUNDARIES & ENCLAVES                            │
└────────────────────────────────────────────────────────────────────────────────┘

 [ Untrusted Webpage / Internet ]
                │
                │  (Blocked by SEC-EXT-1 Runtime Sender Validation)
                ▼
      [ Chrome MV3 Extension ] ──(Dynamic Base URL / chrome.storage.local)──────┐
      (popup.js / service-worker.js)                                            │
                                                                                ▼
 [ Web Browser Client ] ──────────(CORS / Same-Origin)──────────► [ Express API Gateway ]
 (127.0.0.1:3000)                                                (Bound to 127.0.0.1:3000)
                                                                   ├─ Helmet CSP Headers
                                                                   ├─ Tiered Rate Limiting
                                                                   ├─ Multer 10MB (RAM only)
                                                                   ├─ Bearer Auth (SEC-BACK-1)
                                                                   │
                                                                   ▼ Internal Loopback HTTP
                                                                 [ Python AI Microservice ]
                                                                 (Bound to 127.0.0.1:8000)
                                                                   ├─ Sentence Transformers
                                                                   ├─ ChromaDB EphemeralClient
                                                                   ├─ DeBERTa NLI Cross-Encoder
                                                                   └─ Internal Auth (SEC-BACK-3)
```

---

## 2. Zero-Retention Privacy Model

PrismClause operates under verifiable zero-retention guarantees:

1. **Pure In-Memory Processing:**
   - Contract ingestion (PDF, URL, raw text) is conducted entirely within volatile Node.js V8 process memory.
   - Multipart PDF uploads utilize Multer's `MemoryStorage` engine with a hard 10MB allocation cap. Zero temporary files are written to `/tmp`, `%TEMP%`, or disk.
2. **Ephemeral Vector Store Lifecycle:**
   - ChromaDB is instantiated via `chromadb.EphemeralClient()`, guaranteeing that embeddings exist solely in process RAM.
   - Vector collections are created with unique request-scoped identifiers (`doc_<uuid>`).
   - Collections are unconditionally destroyed inside `finally` blocks upon completion of each Q&A query or pipeline analysis:
     ```python
     # ai-service/app/services/vector_store.py
     def delete_collection(self, document_id: str):
         collection_name = f"doc_{document_id}"
         self.client.delete_collection(name=collection_name)
     ```
3. **No Database Persistence:**
   - The application does not include PostgreSQL, MySQL, MongoDB, SQLite, or Redis.
   - Contracts, embeddings, extracted clauses, and Q&A interactions vanish immediately upon process termination or garbage collection.
4. **Log Sanitization & Privacy Hygiene:**
   - Operational logs in `backend/src/utils/logger.js` strictly record non-sensitive metadata (HTTP status codes, elapsed durations, word counts, UUIDs, NLI verdicts).
   - Verbatim contract clauses, user questions, prompts, and authentication tokens are never output to standard out, log files, or error traces.

---

## 3. Server-Side Request Forgery (SSRF) Protection

When users supply a document URL for scanning, the backend acts as an HTTP client. To prevent Server-Side Request Forgery attacks targeting internal cloud metadata services or local network devices, `backend/src/ingestion/url/url-fetcher.js` enforces strict pre-flight URL validation:

### 3.1 Prohibited Destination Addresses
The URL scanner automatically rejects requests targeting:
- **IPv4 Loopback Addresses:** `127.0.0.0/8` (e.g., `127.0.0.1`, `localhost`)
- **Private RFC-1918 Subnets:** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- **Link-Local & Autoconfiguration:** `169.254.0.0/16`
- **Cloud Instance Metadata Services:** `http://169.254.169.254/` (AWS/GCP/Azure metadata), `metadata.google.internal`
- **IPv6 Loopback & Link-Local:** `::1`, `fe80::/10`
- **Non-HTTP Schemes:** `file://`, `ftp://`, `gopher://`, `data://`

### 3.2 DNS Pinning & Redirect Bounds
- Enforces protocol validation (`http:` and `https:` only).
- Caps maximum HTTP redirect hops at 3.
- Implements a strict 10-second socket timeout to prevent Slowloris resource exhaustion.

---

## 4. API Authentication & Token Security (SEC-BACK-1)

To protect generative AI resources (Google Gemini API quotas) and local compute capacity (CPU-intensive PyTorch DeBERTa inferences), the API Gateway provides **Bearer Token Authentication**.

### 4.1 Timing-Safe Token Verification
Token comparison is implemented using cryptographic SHA-256 hashing followed by constant-time buffer comparison (`crypto.timingSafeEqual`) in `backend/src/security/auth.js`:

```javascript
import crypto from "node:crypto";

export function safeTokenCompare(providedToken, expectedToken) {
  if (typeof providedToken !== "string" || typeof expectedToken !== "string") {
    return false;
  }
  if (!providedToken || !expectedToken) {
    return false;
  }

  // Pre-hash both inputs to SHA-256 buffers of equal length (32 bytes)
  // before comparing to eliminate length-leakage and timing side-channels
  const hashProvided = crypto.createHash("sha256").update(providedToken).digest();
  const hashExpected = crypto.createHash("sha256").update(expectedToken).digest();

  return crypto.timingSafeEqual(hashProvided, hashExpected);
}
```

### 4.2 Configuration & Feature Flagging
- **Local Development Default:** `ENABLE_API_AUTH=false` allows zero-configuration local execution and automated test runs.
- **Production Staging:** Set `ENABLE_API_AUTH=true` and configure `API_BEARER_TOKEN` (or comma-separated `API_BEARER_TOKENS`) in `.env`.
- **Token Generation Helper:** Cryptographically strong tokens can be generated using:
  ```powershell
  node scripts/generate-token.mjs
  ```

---

## 5. Server-to-Server Internal Microservice Authentication (SEC-BACK-3)

Communication between the Node.js Express Gateway and the Python FastAPI microservice is authenticated via an internal shared secret.

### 5.1 Communication Hardening
- **Header:** `X-Internal-Token: <INTERNAL_AI_SERVICE_TOKEN>`
- **Python Verification:** `ai-service/app/security/auth.py` validates incoming requests using `secrets.compare_digest`.
- **Multi-Token Rotation:** Python supports comma-separated `INTERNAL_AI_SERVICE_TOKENS`, allowing zero-downtime credential rotation.
- **Circuit Breaker:** If the Python microservice rejects requests with HTTP 401, the Node.js client trips its internal circuit breaker after 3 consecutive failures, preventing cascading request timeouts.

---

## 6. Tiered Rate Limiting & Abuse Prevention (SEC-BACK-2)

In `backend/src/security/rate-limiters.js`, rate limiting is decoupled across operational cost tiers:

| Tier Name | Target Routes | Quota Window | Rate Limit Key Strategy |
| :--- | :--- | :---: | :--- |
| **Heavy AI Tier** | `POST /api/analyze/qa`<br>`POST /api/analyze` | 10 req / 1 min | Token hash (`token:<sha256>`) or Client IP |
| **Ingestion Tier** | `POST /api/scan`<br>`POST /api/documents/ingest` | 25 req / 15 min | Token hash or Client IP |
| **General Tier** | Categories, diffs, headless endpoints | 100 req / 15 min | Token hash or Client IP |
| **Health Tier** | `GET /health` | 60 req / 1 min | Client IP |

- **Safe Token-Hash Keying:** The rate limiter never uses raw Bearer tokens as storage keys. It hashes the token and utilizes the first 8 characters (`token:a1b2c3d4`), preventing credential leakage in memory dumps.
- **Proxy Trust Safety:** `app.set('trust proxy', false)` is enforced by default. Express will not trust spoofed `X-Forwarded-For` headers unless `TRUST_PROXY=true` is explicitly set behind an authenticated reverse proxy.

---

## 7. Chrome Extension Security Boundaries

The Manifest V3 Chrome Extension adheres to strict browser security boundaries:

### 7.1 Message Sender Validation (SEC-EXT-1)
In `extension/background/service-worker.js`, `validateMessageSender()` verifies that all incoming runtime messages originate exclusively from the extension's own execution context:
1. Validates `sender.id === chrome.runtime.id`.
2. Validates `sender.origin === "chrome-extension://" + chrome.runtime.id`.
3. Blocks untrusted web tabs from triggering privileged operations (`ASK_POLICY_QUESTION`, `ANALYZE_CONFIRMED_POLICY`).

### 7.2 Storage & Credential Isolation (SEC-EXT-2)
- Custom backend URLs and Bearer tokens are stored exclusively in `chrome.storage.local`. `chrome.storage.sync` is avoided to prevent cloud syncing of tokens across unmanaged accounts.
- **Redirection Attack Protection:** Every authenticated `fetch` in the background worker sets `{ redirect: "error" }`. If a backend server responds with a 301/302 redirect, Chrome immediately aborts the fetch, preventing token leakage to third-party endpoints.

### 7.3 Content Security Policy (CSP) & CORS
- Backend enforces Helmet Content Security Policy with `default-src 'self'`.
- CORS strictly validates `Origin` headers against the web app and authorized Chrome extension IDs (`chrome-extension://[a-p]{32}`). Wildcard origins (`*`) are disallowed.

---

## 8. Operational Limitations & Production Notes

1. **In-Memory Rate Limiting:** The default `express-rate-limit` implementation utilizes in-memory tracking. In horizontally scaled multi-instance deployments (e.g., Kubernetes or Cloud Run), an external Redis store should be attached.
2. **Loopback Transit:** Traffic between Node.js (`127.0.0.1:3000`) and Python (`127.0.0.1:8000`) travels over plain HTTP across the local loopback interface. If components are distributed across physical servers, mutual TLS (mTLS) or an isolated Virtual Private Cloud (VPC) must be configured.
3. **Local Extension Storage:** Bearer tokens saved in `chrome.storage.local` are isolated from web pages, but remain readable by processes with direct access to the local user profile filesystem. Dedicated, revocable tokens should be provisioned for extension clients.
