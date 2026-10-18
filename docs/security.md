# PrismClause (TOS Red Flag Scanner) — Security Architecture & Threat Model

## 1. Threat Model & Principles
PrismClause operates on an untrusted-input security model. All user-supplied inputs—including uploaded PDF documents, remote policy URLs, and raw text excerpts—are treated as potentially adversarial.

The platform enforces five core security guarantees:
1. **Zero Data Retention**: Contracts and policy excerpts are processed ephemerally in memory and never written to disk or permanent databases.
2. **SSRF Immunity**: Strict network boundaries prevent attackers from leveraging the server to access internal networks, localhost, or cloud metadata endpoints.
3. **MIME & Binary Validation**: All uploads must pass magic-byte verification to prevent disguised executable payloads.
4. **Strict Content Security Policy**: Client-side execution is locked down against Cross-Site Scripting (XSS).
5. **No Secret Leakage**: API credentials and internal stack traces are isolated and masked.

---

## 2. Server-Side Request Forgery (SSRF) Defense

Remote URL scanning (`/api/scan` and `/api/analyze`) is protected by a multi-stage validation engine in `backend/src/security/security.js` and `backend/src/ingestion/url/fetch-policy-text.js`:

```text
[ Incoming Policy URL ]
          │
          ▼
[ Protocol Validation ] ──► Reject non-http / non-https schemes (file://, ftp://, gopher://)
          │
          ▼
[ Hostname Resolution ] ──► Resolve DNS A/AAAA records before sending HTTP request
          │
          ▼
[ IP Range Blacklist ]  ──► Reject:
                            - Loopback: 127.0.0.0/8, ::1, localhost
                            - RFC 1918 Private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                            - Link-Local: 169.254.0.0/16, fe80::/10
                            - Cloud Metadata: 169.254.169.254, metadata.google.internal
                            - Carrier-Grade NAT: 100.64.0.0/10
          │
          ▼
[ Safe Fetch Execution ] ──► Timeout: 10 seconds | Max Redirects: 3 | Response Limit: 5MB
```

---

## 3. PDF Upload & Ingestion Security

File uploads are handled by Multer in memory storage (`backend/src/api/routes/upload.middleware.js`):
- **Memory Buffer Only**: Uploaded files are processed strictly in memory; no temporary files are written to the filesystem.
- **Payload Size Limit**: Hard ceiling of 10 MB per upload (`limits: { fileSize: 10 * 1024 * 1024 }`).
- **MIME Whitelist**: Only `application/pdf` MIME types are accepted.
- **Magic Byte Verification**: `backend/src/ingestion/pdf/document-processor.js` verifies that the initial 5 bytes of the buffer match `%PDF-`. Files with spoofed extensions are rejected with `HTTP 400 Bad Request`.

---

## 4. Content Security Policy (CSP) & HTTP Headers

Express is hardened using Helmet 8.1.0 (`backend/server.js`):

```javascript
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "https:", "data:"]
      }
    }
  })
);
```

- **Zero Inline Scripts**: All client logic is executed via bundled ES modules. No `unsafe-inline` is permitted in `script-src`.
- **Zero Inline Styles**: All visual styling is defined in `styles.css`. No `unsafe-inline` is permitted in `style-src`.
- **Zero Eval**: `unsafe-eval` is strictly forbidden.

---

## 5. Rate Limiting & DoS Mitigation

- **API Rate Limiter**: All `/api/*` endpoints are throttled by `express-rate-limit` to **100 requests per 15-minute window** per IP address.
- **JSON Payload Ceiling**: Body parser is capped at `250kb` (`express.json({ limit: "250kb" })`) to prevent heap exhaustion.
- **Request Timeouts**: Upstream fetches enforce a strict 10-second timeout.

---

## 6. Secrets & Environment Isolation

- **No Hardcoded Secrets**: Zero API keys, passwords, or tokens exist in source code or documentation.
- **Optional AI Key**: `NVIDIA_API_KEY` is loaded exclusively from `process.env`. If the key is omitted, the platform gracefully switches to `NullProvider` with zero errors and zero external requests.
- **Sanitized Error Envelopes**: In production, unhandled exceptions return a standardized error envelope (`{ "error": "Internal Server Error", "statusCode": 500 }`) without stack traces or internal file paths.
