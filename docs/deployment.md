# PrismClause (TOS Red Flag Scanner) — Deployment & Production Guide

## 1. System Requirements & Runtime Prerequisites

- **Runtime**: Node.js `>= 20.0.0` (Verified on Node.js v24 LTS).
- **Architecture**: Linux, macOS, or Windows Server.
- **Memory**: Minimum 512 MB RAM (1 GB recommended for concurrent PDF buffer parsing).
- **Disk**: ~150 MB (excluding node_modules).
- **Network**: Outbound HTTPS (443) access if using NVIDIA NIM AI enhancements; otherwise fully offline capable.

---

## 2. Environment Variables Configuration

Create a `.env` file in the project root based on `.env.example`:

```bash
# Server Port (Default: 3000)
PORT=3000

# Optional NVIDIA NIM AI Integration (Llama 3.1 70B)
# If omitted or empty, platform runs 100% locally and deterministically via the Rule Engine.
NVIDIA_API_KEY=
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

---

## 3. Installation & Startup Procedures

### 3.1 Dependencies Installation
```bash
npm install
```

### 3.2 Running the Application

**Production Mode:**
```bash
npm start
# Spawns scripts/start.js -> node backend/server.js
```

**Development Mode (Live Auto-Reload):**
```bash
npm run dev
# Spawns node --watch backend/server.js
```

---

## 4. Serving Architecture

PrismClause operates as a unified Node.js service:
- **API Endpoints**: Mounted under `/api/*` and handled by Express route controllers.
- **Frontend Assets**: Served directly from `frontend/public/` using `express.static()` middleware.
- **Single Port**: The entire platform runs on a single port (default: 3000).

---

## 5. Reverse Proxy Configuration (Nginx)

In production environments, placing PrismClause behind an Nginx reverse proxy is recommended for SSL termination and static asset caching:

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

    client_max_body_size 12M;

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
    }
}
```

---

## 6. Health Check & Monitoring

The service exposes an automated health probe at `/health`:

```bash
curl http://localhost:3000/health
```

**Expected HTTP 200 Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-10-04T02:00:00.000Z"
}
```

---

## 7. Pre-Deployment Verification Checklist

Before exposing the service to production traffic, verify:
- [ ] `npm test` passes all 118 unit and integration tests.
- [ ] `/health` returns HTTP 200 `{ status: "ok" }`.
- [ ] Content Security Policy (CSP) headers are active on all responses.
- [ ] Uploading a sample PDF larger than 10MB correctly returns HTTP 400.
- [ ] Submitting a private IP address (e.g. `http://192.168.1.1`) to `/api/scan` returns HTTP 400 SSRF block.
- [ ] Main page loads cleanly with zero background flickering or white flashes.
