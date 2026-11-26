# PrismClause (ToS Red Flag Scanner) — REST API Reference

**Project:** PrismClause / ToS Red Flag Scanner
**Document Version:** 3.0 (Consolidated Master API Reference)
**Base URL (Localhost):** `http://127.0.0.1:3000`
**Internal AI Service Base URL:** `http://127.0.0.1:8000`

---

## 1. Global Conventions & Authentication

### 1.1 Authentication Model
The API Gateway supports optional **Bearer Token Authentication** (`SEC-BACK-1`).
- **Feature Flag:** Controlled via `ENABLE_API_AUTH` in `.env` (defaults to `false` for zero-configuration local development).
- **Header Format:** When enabled, clients must provide the HTTP header:
  ```http
  Authorization: Bearer <API_BEARER_TOKEN>
  ```
- **Internal Service Auth:** Server-to-server calls from Node.js to the Python AI microservice pass the secret header:
  ```http
  X-Internal-Token: <INTERNAL_AI_SERVICE_TOKEN>
  ```

### 1.2 Rate Limiting Tiers
Requests are rate-limited per client IP or authenticated token hash (`SEC-BACK-2`):
- **Heavy AI Tier (`POST /api/analyze/qa`, `POST /api/analyze`):** 10 requests / minute
- **Ingestion Tier (`POST /api/scan`, `POST /api/documents/ingest`):** 25 requests / 15 minutes
- **General API Tier (Metadata, Categories, Headless Engines):** 100 requests / 15 minutes
- **Health Tier (`GET /health`):** 60 requests / minute

### 1.3 Standard Error Format
All endpoints return standard JSON error structures:
```json
{
  "success": false,
  "error": "Descriptive human-readable error message."
}
```
Standard HTTP status codes:
- `400 Bad Request`: Validation failure, invalid payload, or SSRF-blocked URL.
- `401 Unauthorized`: Missing, malformed, or invalid Bearer token.
- `403 Forbidden`: CORS origin violation.
- `429 Too Many Requests`: Rate limit tier exceeded (`Retry-After` header included).
- `500 Internal Server Error`: Masked internal server error (no stack traces leaked).

---

## 2. Core Analyze UI & Browser Extension Endpoints

These endpoints power the primary **Analyze** user interface and the Manifest V3 Chrome Extension.

### 2.1 Public Health Check
Probes service uptime and microservice connectivity.

- **Method:** `GET`
- **Path:** `/health`
- **Auth Required:** No (Public)
- **Rate Limit:** Health Tier (60 req/min)
- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-26T00:00:00.000Z",
    "service": "tos-red-flag-scanner-backend",
    "version": "1.0.0",
    "aiService": {
      "status": "connected",
      "url": "http://127.0.0.1:8000"
    }
  }
  ```

---

### 2.2 Unified Policy Scan
Ingests legal contract text via URL, direct text string, or pre-extracted segments. Executes deterministic 14-category risk detection, readability scoring, and segment normalization.

- **Method:** `POST`
- **Path:** `/api/scan`
- **Auth Required:** When `ENABLE_API_AUTH=true`
- **Rate Limit:** Ingestion Tier (25 req/15min)
- **Request Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>` (optional on localhost)
- **Request Body (URL Ingestion):**
  ```json
  {
    "url": "https://example.com/terms",
    "metadata": {
      "title": "Example Terms of Service"
    }
  }
  ```
- **Request Body (Direct Raw Text Ingestion):**
  ```json
  {
    "text": "1. Binding Arbitration. Any dispute arising under this agreement shall be settled exclusively by individual binding arbitration...",
    "metadata": {
      "sourceType": "text",
      "title": "Pasted Agreement"
    }
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "document": {
      "id": "doc_a7f9c2e0b1",
      "sourceType": "url",
      "title": "Example Terms of Service",
      "text": "1. Binding Arbitration...",
      "wordCount": 1250,
      "characterCount": 8420,
      "segmentCount": 18
    },
    "score": {
      "overallScore": 68,
      "severity": "HIGH",
      "flagCount": 5,
      "highCount": 2,
      "mediumCount": 2,
      "lowCount": 1
    },
    "readability": {
      "readingEase": 32.4,
      "readingEaseLabel": "Difficult (Legal Text)",
      "gradeLevel": 15.2,
      "gradeLevelLabel": "College Graduate"
    },
    "findings": [
      {
        "id": "finding_1",
        "categoryId": "ARBITRATION",
        "categoryName": "Mandatory Binding Arbitration",
        "severity": "HIGH",
        "segmentId": "seg_1",
        "clauseText": "Any dispute arising under this agreement shall be settled exclusively by individual binding arbitration...",
        "summary": "Waives right to trial in public court and mandates private binding arbitration.",
        "whyItMatters": "You surrender your constitutional right to take disputes before a judge or jury.",
        "confidence": 0.95
      }
    ],
    "segments": [
      {
        "id": "seg_1",
        "index": 0,
        "text": "1. Binding Arbitration...",
        "wordCount": 42
      }
    ]
  }
  ```

---

### 2.3 Multipart PDF Upload & Ingestion
Uploads and parses a PDF contract file directly in memory without disk persistence.

- **Method:** `POST`
- **Path:** `/api/documents/ingest` *(alias: `/api/pdf/ingest`)*
- **Auth Required:** When `ENABLE_API_AUTH=true`
- **Rate Limit:** Ingestion Tier (25 req/15min)
- **Request Headers:**
  - `Content-Type: multipart/form-data`
- **Form Data:**
  - `file`: Binary PDF file (Max 10MB; validated for `%PDF-` magic bytes)
  - `title`: Optional document title string
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "document": {
      "id": "doc_f8e2a10c9b",
      "filename": "terms-of-service.pdf",
      "text": "Extracted document text...",
      "wordCount": 3420,
      "characterCount": 22100,
      "pageCount": 6,
      "segments": [
        {
          "id": "seg_1",
          "text": "...",
          "index": 0,
          "wordCount": 55
        }
      ]
    }
  }
  ```

---

### 2.4 Evidence-Grounded Q&A with DeBERTa NLI Verification
Performs contextual question answering using retrieved contract clauses, Google Gemini generative explanations, and local DeBERTa cross-encoder verification.

- **Method:** `POST`
- **Path:** `/api/analyze/qa`
- **Auth Required:** When `ENABLE_API_AUTH=true`
- **Rate Limit:** Heavy AI Tier (10 req/min)
- **Request Body:**
  ```json
  {
    "question": "Can I cancel my subscription and receive a refund?",
    "clauses": [
      {
        "id": "seg_5",
        "text": "5. Cancellation. You may cancel your Paid Subscription at any time prior to the end of the current billing cycle. Payments are non-refundable except where required by law."
      }
    ],
    "documentLabel": "Terms of Service"
  }
  ```
- **Response (200 OK — Grounded Answer with Supported NLI):**
  ```json
  {
    "success": true,
    "qa": {
      "answer": "You can cancel your subscription at any time before your current billing cycle concludes, but your payments are strictly non-refundable unless mandated by local law.",
      "grounded": true,
      "confidence": 0.94,
      "documentLabel": "Terms of Service",
      "evidence": [
        {
          "id": "seg_5",
          "text": "5. Cancellation. You may cancel your Paid Subscription at any time prior to the end of the current billing cycle. Payments are non-refundable except where required by law.",
          "similarity": 0.81,
          "similarityFormatted": "81%"
        }
      ],
      "nliValidation": {
        "status": "supported",
        "badge": "SUPPORTED",
        "entailmentScore": 0.962,
        "contradictionScore": 0.008,
        "neutralScore": 0.030,
        "verified": true,
        "explanation": "Factually entailed by clause seg_5."
      }
    }
  }
  ```
- **Response (200 OK — Ungrounded / Out-of-Scope Refusal):**
  ```json
  {
    "success": true,
    "qa": {
      "answer": "The provided contract does not contain information regarding physical hardware warranty coverage.",
      "grounded": false,
      "confidence": 0.20,
      "documentLabel": "Terms of Service",
      "evidence": [],
      "nliValidation": {
        "status": "uncertain",
        "badge": "UNCERTAIN",
        "verified": false,
        "explanation": "Answer was ungrounded in contract evidence; NLI skipped to prevent false contradictions."
      }
    }
  }
  ```

---

### 2.5 Risk Category Catalog
Returns the complete catalog of 14 canonical risk categories, severity levels, and descriptions.

- **Method:** `GET`
- **Path:** `/api/analyze/categories`
- **Auth Required:** When `ENABLE_API_AUTH=true`
- **Rate Limit:** General Tier (100 req/15min)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "categories": [
      {
        "id": "ARBITRATION",
        "name": "Mandatory Binding Arbitration",
        "severity": "HIGH",
        "description": "Requires resolving legal disputes through private binding arbitration instead of public courts.",
        "defaultWeight": 5
      },
      {
        "id": "CLASS_ACTION_WAIVER",
        "name": "Class Action Waiver",
        "severity": "HIGH",
        "description": "Prohibits participating in class actions or collective lawsuits.",
        "defaultWeight": 5
      }
    ]
  }
  ```

---

## 3. Supporting & Headless Backend APIs (Headless / Non-UI)

The following endpoints operate as supporting headless services. They are preserved in the backend and fully functional for API callers, automation, and testing.

### 3.1 Clause Version Comparison
Compares baseline and updated clauses to compute lexical Jaccard similarity and semantic change magnitude.

- **Method:** `POST`
- **Path:** `/api/analyze/compare`
- **Request Body:**
  ```json
  {
    "previousClause": "We will provide 30 days notice before modifying terms.",
    "currentClause": "We reserve the right to modify these terms immediately without prior notice."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "comparison": {
      "jaccardSimilarity": 0.28,
      "wordCountDelta": 1,
      "changeMagnitude": "CRITICAL",
      "riskDirection": "INCREASED_RISK",
      "explanation": "Notice period was removed, shifting terms from bilateral notice to immediate unilateral change."
    }
  }
  ```

---

### 3.2 Formal Opt-Out Notice Generator
Assembles legally styled formal opt-out notices citing relevant statutory authorities (e.g., FAA, CCPA, GDPR).

- **Method:** `POST`
- **Path:** `/api/remediation/opt-out`
- **Request Body:**
  ```json
  {
    "noticeType": "ARBITRATION_OPT_OUT",
    "companyName": "Acme Cloud Services",
    "userMetadata": {
      "fullName": "Jane Doe",
      "accountEmail": "jane@example.com",
      "mailingAddress": "123 Main St, Anytown USA",
      "accountNumber": "ACC-90412"
    },
    "evidenceClause": "You may opt out of this arbitration agreement within 30 days of opening your account by written notice."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "notice": {
      "title": "Formal Notice of Arbitration Opt-Out",
      "markdown": "VIA CERTIFIED MAIL / ELECTRONIC TRANSMISSION\n\nDate: November 26, 2026\nTo: Acme Cloud Services Legal Department\n...",
      "statutoryReferences": ["9 U.S.C. § 2", "Federal Arbitration Act"],
      "recommendedDeadline": "30 days from account inception"
    }
  }
  ```

---

### 3.3 Redline Diff & Amendment Rider Assembly
Tokenizes contract clauses and produces word-level LCS redlines and unified Contract Amendment Riders.

- **Method:** `POST`
- **Path:** `/api/negotiation/diff`
- **Request Body:**
  ```json
  {
    "originalText": "Vendor may terminate this agreement at any time without notice.",
    "proposedText": "Vendor may terminate this agreement upon 30 days prior written notice."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "diff": {
      "wordsAdded": 6,
      "wordsRemoved": 4,
      "wordsUnchanged": 6,
      "html": "Vendor may terminate this agreement <del class=\"diff-del\">at any time without</del><ins class=\"diff-ins\">upon 30 days prior written</ins> notice.",
      "chunks": [
        { "type": "equal", "value": "Vendor may terminate this agreement" },
        { "type": "delete", "value": "at any time without" },
        { "type": "insert", "value": "upon 30 days prior written" },
        { "type": "equal", "value": "notice." }
      ]
    }
  }
  ```

- **Assembly Endpoint:** `POST /api/negotiation/rider`
  Accepts an array of accepted negotiated amendments and compiles an execution-ready legal addendum with recitals, conflict clauses, and signature blocks.

---

### 3.4 Statutory Compliance Audit (LexCheck)
Evaluates flagged provisions against consumer protection statutes in target jurisdictions.

- **Method:** `POST`
- **Path:** `/api/compliance/audit`
- **Request Body:**
  ```json
  {
    "jurisdiction": "US_CALIFORNIA",
    "findings": [
      {
        "categoryId": "AUTO_RENEWAL",
        "clauseText": "Your subscription renews automatically without additional confirmation."
      }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "audit": {
      "jurisdiction": "US_CALIFORNIA",
      "jurisdictionLabel": "California, United States",
      "complianceScore": 45,
      "issues": [
        {
          "categoryId": "AUTO_RENEWAL",
          "statute": "California Automatic Renewal Law (ARL), Cal. Bus. & Prof. Code § 17600 et seq.",
          "enforceabilityStatus": "LIKELY_UNENFORCEABLE_CONSUMER",
          "guidance": "California law requires affirmative consent and clear, conspicuous disclosure of cancellation terms before billing."
        }
      ]
    }
  }
  ```

---

### 3.5 Portfolio Stack Evaluation
Aggregates risk metrics across multiple vendor analyses to quantify cumulative organizational exposure.

- **Method:** `POST`
- **Path:** `/api/portfolio/evaluate`
- **Request Body:**
  ```json
  {
    "vendors": [
      { "vendorName": "SaaS A", "overallScore": 75, "findings": [...] },
      { "vendorName": "SaaS B", "overallScore": 30, "findings": [...] }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "portfolio": {
      "stackScore": 52,
      "healthStatus": "MODERATE_RISK",
      "systemicExposures": [
        {
          "category": "ARBITRATION",
          "prevalence": "100%",
          "description": "All vendors in tech stack enforce mandatory arbitration."
        }
      ]
    }
  }
  ```

---

## 4. Internal Python AI Microservice Endpoints (`127.0.0.1:8000`)

Protected by `X-Internal-Token` header. These endpoints are called internally by the Node.js backend.

### 4.1 Dense Sentence Embeddings
- **Method:** `POST`
- **Path:** `/ai/embed`
- **Request Body:**
  ```json
  {
    "texts": ["First contract clause text", "Second contract clause text"]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "embeddings": [
      [-0.0421, 0.0812, 0.0135, "... 384 dimensions ..."],
      [0.0112, -0.0541, 0.0921, "... 384 dimensions ..."]
    ],
    "model": "all-MiniLM-L6-v2",
    "dimension": 384
  }
  ```

---

### 4.2 Ephemeral Vector Indexing & Semantic Search
- **Index:** `POST /ai/vectors/index`
  - Accepts `document_id` and array of clauses with embeddings. Stores vectors in an ephemeral ChromaDB collection (`doc_<id>`).
- **Query:** `POST /ai/vectors/query`
  - Accepts `document_id`, query string, and `top_k` (default: 8). Returns top semantic matches with cosine similarities.
- **Teardown:** `DELETE /ai/vectors/{document_id}`
  - Unconditionally deletes the ChromaDB collection upon query completion.

---

### 4.3 Independent NLI Cross-Encoder Verification
- **Method:** `POST`
- **Path:** `/ai/nli/validate`
- **Request Body:**
  ```json
  {
    "premise": "You may cancel your subscription at any time prior to the billing date.",
    "hypothesis": "Consumers have the right to cancel their subscription before the renewal date."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "status": "supported",
    "badge": "SUPPORTED",
    "scores": {
      "entailment": 0.971,
      "contradiction": 0.005,
      "neutral": 0.024
    },
    "verified": true,
    "model": "cross-encoder/nli-deberta-v3-base"
  }
  ```
