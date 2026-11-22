# PrismClause (TOS Red Flag Scanner) — Deployment & Production Guide

**Document Version:** 3.1 (Phase 9.1 Release)  
**Status:** Approved for Localhost & Staging Preparation

---

## 1. System Requirements & Runtime Prerequisites

- **Node.js**: `>= 20.0.0` (Verified on Node.js v22 & v24 LTS).
- **Python**: `3.10` to `3.13` (Verified on Python 3.13 with PyTorch CPU).
- **Architecture**: Linux, macOS, or Windows Server.
- **Memory**: Minimum 2 GB RAM (4 GB recommended for concurrent sentence embedding, ChromaDB vector indexing, and DeBERTa NLI cross-encoder inference).
- **Disk**: ~2.5 GB (including Node modules, Python virtual environment, Sentence-Transformers weights, and DeBERTa model cache).
- **Network**: Outbound HTTPS (443) access to `generativelanguage.googleapis.com` (Google Gemini API). Both application services bind strictly to loopback (`127.0.0.1`) by default.

---

## 2. Architecture & Service Topology

PrismClause operates as a decoupled, privacy-preserving hybrid system:

1. **API Gateway & Web Server (Node.js Express 5):**
   - **Port:** Default `3000` (`http://localhost:3000` / `127.0.0.1:3000`).
   - **Responsibilities:** Static frontend asset delivery, SSRF-safe URL fetching, PDF document ingestion, 14-category deterministic legal risk heuristics, Readability scoring, Dual-Engine Q&A orchestration (Procedural vs. LangGraph), API Bearer authentication, and Tiered rate limiting.
2. **AI Microservice (Python FastAPI / Uvicorn):**
   - **Port:** Default `8000` (`http://127.0.0.1:8000`).
   - **Responsibilities:** Sentence Transformers dense embeddings (`all-MiniLM-L6-v2`), ephemeral in-memory ChromaDB vector store (`chromadb.EphemeralClient`), DeBERTa Natural Language Inference (`cross-encoder/nli-deberta-v3-base`), and internal token authentication.

---

## 3. Environment Variables Configuration

Create a `.env` file in the project root by copying `.env.example`:

```bash
cp .env.example .env
```

### Complete Environment Variable Reference:

```bash
# ==============================================================================
# 1. CORE EXPRESS BACKEND CONFIGURATION
# ==============================================================================
PORT=3000
HOST=127.0.0.1

# Reverse Proxy Trust (Phase 8C.3C)
# Set to true, 1, or proxy IP when operating behind Nginx/Cloudflare reverse proxy
TRUST_PROXY=false

# ==============================================================================
# 2. GENERATIVE AI PROVIDER (GOOGLE GEMINI)
# ==============================================================================
ENABLE_GEMINI_PROVIDER=true
GEMINI_API_KEY=your_google_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-pro

# ==============================================================================
# 3. PYTHON AI MICROSERVICE (127.0.0.1:8000)
# ==============================================================================
ENABLE_PYTHON_AI_SERVICE=true
PYTHON_AI_SERVICE_URL=http://localhost:8000
PYTHON_AI_SERVICE_TIMEOUT_MS=5000
PYTHON_AI_NLI_TIMEOUT_MS=15000

# Startup readiness timeout for DeBERTa pre-warming on CPU (scripts/start.js)
PYTHON_AI_STARTUP_TIMEOUT_MS=60000

# ==============================================================================
# 4. DUAL-ENGINE Q&A ORCHESTRATION (PHASE 8B)
# ==============================================================================
# Feature flag governing Q&A engine (defaults to false -> Procedural RAG engine active)
# Set to true to route Q&A requests through the LangGraph State Machine
ENABLE_LANGGRAPH_QA=false

# ==============================================================================
# 5. FOUNDATIONAL API AUTHENTICATION (SEC-BACK-1, PHASE 8C.3B)
# ==============================================================================
# Toggle enforcement on /api/* routes (default: false for zero-config local dev)
ENABLE_API_AUTH=false

# Primary Bearer Token for API access
API_BEARER_TOKEN=

# Comma-separated token rotation list (supports zero-downtime rollover)
API_BEARER_TOKENS=

# ==============================================================================
# 6. INTERNAL NODE-TO-PYTHON AUTHENTICATION (PHASE 8C.3E)
# ==============================================================================
# Toggle enforcement on /ai/* endpoints (default: false for zero-config local dev)
ENABLE_INTERNAL_AUTH=false

# Internal server-to-server token (attached as X-Internal-Token by Node.js client)
INTERNAL_AI_SERVICE_TOKEN=
INTERNAL_AI_SERVICE_TOKENS=

# ==============================================================================
# 7. CHROME & EDGE EXTENSION ORIGIN BINDING
# ==============================================================================
# Comma-separated allowed extension origins (e.g. chrome-extension://<id>)
CHROME_EXTENSION_ORIGIN=
```

---

## 4. Installation & Startup Procedures

### 4.1 Node.js Dependencies Installation
```bash
npm install
```

### 4.2 Python Virtual Environment Setup
```bash
# Create Python virtual environment
python -m venv .venv

# Activate virtual environment (Windows PowerShell)
.\.venv\Scripts\Activate.ps1
# Or on Linux/macOS:
# source .venv/bin/activate

# Install Python microservice dependencies
pip install -r ai-service/requirements.txt
```

### 4.3 Running the Application

**Unified Concurrent Startup (Production & Standard Local Run):**
```bash
npm start
```
`npm start` executes `scripts/start.js`, which concurrently:
1. Validates that ports 3000 and 8000 are available.
2. Discovers the `.venv` Python executable.
3. Launches the Python FastAPI service and pre-warms the DeBERTa NLI cross-encoder on CPU.
4. Launches the Express API Gateway.
5. Polls both health endpoints (`/health`) with progress feedback and validates genuine readiness (`status: "ok"`).
6. Streams prefixed, color-coded console logs (`[BACKEND]` and `[PYTHON AI]`).

**Development Mode (Express Auto-Reload):**
```bash
npm run dev
# Spawns node --watch backend/server.js
```

---

## 5. Serving Architecture & Reverse Proxy Configuration

In a production deployment, place PrismClause behind an Nginx reverse proxy. The Node.js Express server is exposed publicly to handle client requests, while the Python FastAPI service remains strictly internal:

```
[ Internet / Browser / Extension ]
               │
               ▼ HTTPS (Port 443)
       [ Nginx Reverse Proxy ]
               │
               ├─► Proxy to Node.js Express (http://127.0.0.1:3000)
               │     ├─ Static Web Assets (/index.html, /app.js, /styles.css)
               │     ├─ Public Health Check (/health)
               │     └─ Protected API Endpoints (/api/*)
               │           │
               │           └─ (Internal loopback call with X-Internal-Token)
               │                 ▼
               └─► Python FastAPI AI Microservice (http://127.0.0.1:8000)
                     (STRICTLY INTERNAL: Never exposed to the public internet)
```

### Example Nginx Configuration (`/etc/nginx/sites-available/prismclause`):

```nginx
server {
    listen 80;
    server_name clause.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name clause.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/clause.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clause.yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Enforce maximum client body size for PDF document uploads (10 MB limit)
    client_max_body_size 12M;

    # Forward to Node.js API Gateway
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }

    # Explicitly block any external attempt to route directly to internal AI paths
    location /ai/ {
        return 403 "Direct access to internal AI service is forbidden.";
    }
}
```

When using Nginx, configure `TRUST_PROXY=true` in your `.env` so Express rate limiters properly key off `X-Forwarded-For` client IPs rather than the proxy loopback IP.

---

## 6. Health Check & Monitoring Probes

Both services expose automated `/health` probes:

### 6.1 Node.js Express Backend Health Probe
```bash
curl http://localhost:3000/health
```
**Expected HTTP 200 Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-11-20T23:00:00.000Z"
}
```

### 6.2 Python FastAPI AI Microservice Health Probe
```bash
curl http://127.0.0.1:8000/health
```
**Expected HTTP 200 Response:**
```json
{
  "status": "ok",
  "model_loaded": true,
  "nli_status": "ready"
}
```

---

## 7. Pre-Deployment Verification Checklist

Before deploying updates or promoting to production traffic, execute the following verification steps:

- [ ] **Node.js Master Test Suite:** `npm test` passes all **601 automated tests across 38 suites** with 0 failures.
- [ ] **Python AI Service Test Suite:** `pytest ai-service/tests` passes all **73 tests across 5 suites** with 0 failures.
- [ ] **Academic Evaluation Benchmarks:** `node scripts/evaluate.js` meets all targets ($\ge 85\%$).
- [ ] **Backend Health Probe:** `GET /health` returns HTTP 200 `{ status: "ok" }`.
- [ ] **Python AI Health Probe:** `GET http://127.0.0.1:8000/health` returns `{ status: "ok", model_loaded: true, nli_status: "ready" }`.
- [ ] **Content Security Policy (CSP):** Verified Helmet CSP headers active with no console CSP violations.
- [ ] **SSRF Defense:** Submitting private IPv4/IPv6 addresses (e.g. `http://192.168.1.1`, `http://169.254.169.254`) to `/api/scan` returns HTTP 400 SSRF block.
- [ ] **PDF Boundary:** Uploading a PDF larger than 10MB returns HTTP 400 rejection.
- [ ] **Zero-Retention Lifecycle:** Ephemeral ChromaDB collections are verified purged upon query completion.
- [ ] **Credential Protection:** Zero API keys, Bearer tokens, or internal service tokens are committed to source control or logged to console output.
