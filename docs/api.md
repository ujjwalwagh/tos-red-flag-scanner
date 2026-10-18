# TOS Red Flag Scanner — API Endpoints Reference

### 1. Ingest PDF Document
- **Route**: `POST /api/documents/ingest` (alias: `POST /api/pdf/ingest`)
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file` or `policyFile`: PDF file buffer (Max 10MB)
- **Response**:
  ```json
  {
    "success": true,
    "document": {
      "metadata": { "filename": "terms.pdf", "pageCount": 5, "requiresOcr": false, "wordCount": 3096 },
      "pages": [...],
      "segments": [...],
      "normalizedText": "..."
    }
  }
  ```

---

### 2. Analyze Document
- **Route**: `POST /api/analyze`
- **Content-Type**: `application/json` or `multipart/form-data`
- **Payload**:
  - JSON with `{ "document": { ... } }` or `{ "policyText": "..." }`
  - Or multipart file upload with `file`
- **Response**:
  ```json
  {
    "success": true,
    "analysis": {
      "documentMetadata": { ... },
      "findings": [
        {
          "findingId": "...",
          "categoryId": "ARBITRATION",
          "title": "Mandatory Arbitration Clause",
          "severity": "HIGH",
          "confidence": 0.95,
          "explanation": "...",
          "evidence": "...",
          "pageNumber": 1,
          "segmentIndex": 0,
          "ruleDetected": true,
          "aiDetected": true,
          "detectionMethod": "ai_enhanced"
        }
      ],
      "summary": { ... }
    }
  }
  ```

---

### 3. Policy Scanner (Legacy Phase 1)
- **Route**: `POST /api/scan`
- **Content-Type**: `application/json` or `multipart/form-data`
- **Payload**:
  - `{ "url": "https://example.com/terms", "scanMode": "broad" }`
  - Or `{ "policyText": "...", "scanMode": "strict" }`
  - Or multipart file upload `policyFile`
- **Response**:
  ```json
  {
    "sourceUrl": "...",
    "scanMode": "broad",
    "overallRisk": "high",
    "flags": [...],
    "readability": { "score": 68, "level": "complex", "metrics": { ... } }
  }
  ```

---

### 4. Get Risk Categories (Phase 5)
- **Route**: `GET /api/analyze/categories`
- **Response**:
  ```json
  {
    "success": true,
    "categories": [
      {
        "id": "ARBITRATION",
        "displayName": "Arbitration & Class Action Waiver",
        "description": "...",
        "defaultWeight": 5,
        "baseSeverity": "HIGH",
        "impactDomain": "Legal Rights"
      }
    ],
    "defaultPreferences": {
      "ARBITRATION": 5,
      "PRIVACY_DATA_COLLECTION": 4
    }
  }
  ```

---

### 5. Compare Clause Revisions (Phase 5)
- **Route**: `POST /api/analyze/compare`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "oldClauseText": "We may share your data with affiliates.",
    "newClauseText": "We will share your data with all third-party advertising partners.",
    "category": "PRIVACY_DATA_SHARING"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "comparison": {
      "available": true,
      "method": "semantic_ai",
      "similarityScore": 0.42,
      "changeMagnitude": "HIGH",
      "impactDomain": "Data Privacy",
      "explanation": "...",
      "riskShift": "INCREASED_RISK",
      "oldClauseEvidence": "...",
      "newClauseEvidence": "..."
    }
  }
  ```

---

### 6. Interactive Evidence-Grounded Q&A (Phase 9)
- **Route**: `POST /api/analyze/qa`
- **Content-Type**: `application/json`
- **Purpose**: Evidence-grounded question answering over supplied Terms of Service clauses or raw policy text. The endpoint indexes supplied clauses in an ephemeral ChromaDB vector collection, retrieves the top semantically relevant clauses using dense embeddings (`sentence-transformers/all-MiniLM-L6-v2`), and prompts Google Gemini (`gemini-2.5-pro`) to generate a plain-English answer strictly constrained to the retrieved ToS evidence.
- **Validation Rules**:
  - `question`: Required string, minimum 3 characters, maximum 500 characters.
  - Document input: Either a non-empty `clauses` array (maximum 250 clauses) or non-empty `policyText` string (automatically segmented into clauses).
- **Zero-Retention Lifecycle**:
  - Vector collections are isolated under an ephemeral session ID (`qa_<uuid>`).
  - Collections are explicitly purged upon query completion via `withDocumentVectors()` in an unconditional `finally` block. No customer data or embeddings are stored persistently.
- **Payload**:
  ```json
  {
    "question": "Can I cancel my subscription and get a refund?",
    "clauses": [
      {
        "clauseId": "clause_1",
        "text": "Subscriptions may be cancelled at any time upon 30 days prior notice, but all fees paid prior to cancellation are strictly non-refundable.",
        "section": "Billing & Termination"
      }
    ]
  }
  ```
  *Alternatively, provide raw policy text:*
  ```json
  {
    "question": "Can I cancel my subscription and get a refund?",
    "policyText": "Subscriptions may be cancelled at any time upon 30 days prior notice, but all fees paid prior to cancellation are strictly non-refundable."
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "qa": {
      "question": "Can I cancel my subscription and get a refund?",
      "answer": "You can cancel your subscription at any time by giving 30 days prior notice; however, all subscription fees paid prior to cancellation are strictly non-refundable.",
      "evidence": [
        {
          "clauseId": "clause_1",
          "text": "Subscriptions may be cancelled at any time upon 30 days prior notice, but all fees paid prior to cancellation are strictly non-refundable.",
          "section": "Billing & Termination",
          "similarityScore": 0.89
        }
      ],
      "grounded": true,
      "confidence": 0.9,
      "available": true,
      "reason": null
    }
  }
  ```
- **Graceful Failure & Fallback Handling**:
  - **Python AI Service Unavailable**: If the Python/FastAPI microservice or ChromaDB vector store is unreachable or times out, the system falls back gracefully without returning an error response (`retrievedEvidence = []`). Gemini answers using the available context or declares ungrounded.
  - **Gemini Unavailable / No API Key**: If `GEMINI_API_KEY` is not configured or the provider experiences a network failure, the endpoint returns HTTP 200 with `{ available: false, reason: "no_api_key_configured" | "timeout" | "provider_server_error", answer: "Unable to generate an AI answer. Please review the provided ToS evidence directly." }` alongside any retrieved evidence clauses.
  - **Information Not in ToS**: When the supplied document does not contain relevant information to answer the question, Gemini returns `grounded: false`, `confidence: 0.0`, and an explicit statement that the ToS lacks the necessary evidence, preventing hallucinated answers.

---

### 7. Generate Opt-Out Notice (Phase 6)
- **Route**: `POST /api/remediation/opt-out`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "remediationType": "ARBITRATION",
    "companyName": "Acme Corp",
    "clauseEvidence": "Any dispute must be arbitrated...",
    "userMetadata": {
      "userName": "Jane Doe",
      "userEmail": "jane@example.com",
      "accountNumber": "ACC-1002"
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "notice": {
      "noticeType": "ARBITRATION_OPT_OUT",
      "title": "Mandatory Arbitration & Class Action Opt-Out Letter",
      "subject": "...",
      "body": "...",
      "deliveryInstructions": [...]
    }
  }
  ```

---

### 8. Actionable Checklist (Phase 6)
- **Route**: `POST /api/remediation/checklist`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "rankedFindings": [ ... ],
    "companyName": "Acme Corp"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "checklist": {
      "summary": { "totalItems": 3, "immediateCount": 1, "day30Count": 1, "ongoingCount": 1 },
      "items": [ ... ]
    }
  }
  ```

---

### 9. Export Audit Report (Phase 6)
- **Route**: `POST /api/export/report`
- **Content-Type**: `application/json`
- **Query Params**: `?raw=true` (optional, for direct file streams)
- **Payload**:
  ```json
  {
    "analysis": { ... },
    "format": "markdown",
    "documentTitle": "Terms of Service"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "format": "markdown",
    "content": "# ClauseGuard AI — Terms of Service Risk Audit\n..."
  }
  ```

---

### 10. Generate Fair Amendment Proposal (Phase 7)
- **Route**: `POST /api/negotiation/amendment`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "categoryId": "ARBITRATION",
    "clauseText": "All disputes must be submitted to individual binding arbitration.",
    "posture": "BALANCED",
    "companyName": "Acme SaaS"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "amendment": {
      "categoryId": "ARBITRATION",
      "categoryDisplayName": "Mandatory Arbitration & Court Waivers",
      "title": "Mutual Dispute Resolution & Judicial Access Amendment",
      "posture": "BALANCED",
      "talkingPoints": [ ... ],
      "originalClause": "All disputes must be submitted to individual binding arbitration.",
      "proposedAmendment": "In the event of any dispute, claim, or controversy...",
      "fallbackAlternative": "If judicial resolution is rejected, propose AAA commercial arbitration...",
      "redline": {
        "diffChunks": [ ... ],
        "htmlDiff": "<del class=\"diff-del\">All</del> <ins class=\"diff-ins\">In the event of</ins>...",
        "stats": { "wordsAdded": 42, "wordsRemoved": 8, "wordsUnchanged": 2 }
      },
      "disclaimer": "LEGAL DISCLAIMER: ..."
    }
  }
  ```

---

### 11. Compile Contract Amendment Rider (Phase 7)
- **Route**: `POST /api/negotiation/rider`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "amendments": [
      {
        "categoryId": "ARBITRATION",
        "originalClause": "Mandatory arbitration is required.",
        "proposedAmendment": "Disputes shall be resolved in a court of competent jurisdiction."
      }
    ],
    "companyName": "Vendor Corp",
    "counterpartyName": "Client LLC",
    "agreementTitle": "Master Cloud Services Agreement",
    "effectiveDate": "2026-10-03"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "rider": {
      "agreementTitle": "Master Cloud Services Agreement",
      "companyName": "Vendor Corp",
      "counterpartyName": "Client LLC",
      "effectiveDate": "2026-10-03",
      "clauseCount": 1,
      "markdown": "# CONTRACT AMENDMENT RIDER\n\n...",
      "disclaimer": "LEGAL DISCLAIMER: ..."
    }
  }
  ```

---

### 12. Comparative Sector Benchmark Evaluation (Phase 7)
- **Route**: `POST /api/benchmarks/evaluate`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "findings": [
      { "categoryId": "ARBITRATION", "severity": "HIGH" }
    ],
    "sector": "SAAS_CLOUD"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "benchmarks": {
      "sector": "saas_cloud",
      "sectorDisplayName": "SaaS, Cloud & Productivity",
      "restrictivenessScore": 24,
      "percentileRank": 26,
      "relativeStanding": "Favorable",
      "domainBreakdown": { ... },
      "keyRiskOutliers": [ ... ],
      "disclaimer": "LEGAL DISCLAIMER: ..."
    }
  }
  ```

---

### 13. Evaluate Enterprise Portfolio Stack (Phase 8)
- **Route**: `POST /api/portfolio/evaluate`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "stack": [
      {
        "vendorId": "slack",
        "vendorName": "Slack",
        "tier": "CRITICAL",
        "findings": [
          { "categoryId": "ARBITRATION", "severity": "HIGH" },
          { "categoryId": "AI_TRAINING", "severity": "MEDIUM" }
        ]
      },
      {
        "vendorId": "github",
        "vendorName": "GitHub",
        "tier": "HIGH",
        "findings": [
          { "categoryId": "LIABILITY_LIMITS", "severity": "LOW" }
        ]
      }
    ]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "portfolio": {
      "portfolioRiskScore": 54,
      "portfolioPosture": "MODERATE_RISK",
      "vendorCount": 2,
      "tierDistribution": { "CRITICAL": 1, "HIGH": 1, "MEDIUM": 0, "LOW": 0 },
      "systemicConcentrations": [
        {
          "categoryId": "ARBITRATION",
          "categoryName": "Arbitration & Dispute Resolution",
          "vendorCount": 1,
          "vendorPercentage": 50,
          "systemicSeverity": "CONCENTRATED",
          "affectedVendors": ["Slack"]
        }
      ],
      "vendorRankings": [ ... ],
      "disclaimer": "INFORMATIONAL NOTICE: ..."
    }
  }
  ```

---

### 14. Multi-Vendor Head-to-Head Comparison (Phase 8)
- **Route**: `POST /api/portfolio/compare`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "vendors": [
      {
        "vendorName": "Vendor Alpha",
        "findings": [
          { "categoryId": "ARBITRATION", "severity": "HIGH" }
        ]
      },
      {
        "vendorName": "Vendor Beta",
        "findings": [
          { "categoryId": "PRIVACY_DATA_COLLECTION", "severity": "LOW" }
        ]
      }
    ]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "matrix": {
      "vendors": ["Vendor Alpha", "Vendor Beta"],
      "categories": [ ... ],
      "scorecard": [
        {
          "vendorName": "Vendor Beta",
          "totalRiskScore": 15,
          "posture": "LEAST_RESTRICTIVE",
          "highRiskClauses": 0
        },
        {
          "vendorName": "Vendor Alpha",
          "totalRiskScore": 65,
          "posture": "HIGH_RISK",
          "highRiskClauses": 1
        }
      ],
      "recommendation": {
        "preferredVendor": "Vendor Beta",
        "rationale": "Vendor Beta exhibits significantly lower aggregated risk..."
      },
      "disclaimer": "INFORMATIONAL NOTICE: ..."
    }
  }
  ```

---

### 15. Policy Version Drift Analysis (Phase 8)
- **Route**: `POST /api/sentinel/drift`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "vendorName": "CloudCorp",
    "previousPolicy": {
      "version": "1.0",
      "date": "2025-01-01",
      "text": "We do not sell user data or train generative models on your inputs."
    },
    "currentPolicy": {
      "version": "2.0",
      "date": "2026-10-01",
      "text": "We may train AI machine learning models on customer inputs and share with partners."
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "drift": {
      "vendorName": "CloudCorp",
      "previousVersion": "1.0",
      "currentVersion": "2.0",
      "driftDirection": "MORE_RESTRICTIVE",
      "magnitudeScore": 68,
      "summary": "Policy became more restrictive with 2 new risk restrictions added.",
      "addedRestrictions": [ ... ],
      "removedRestrictions": [ ... ],
      "diff": {
        "diffChunks": [ ... ],
        "htmlDiff": "...",
        "stats": { "wordsAdded": 10, "wordsRemoved": 6, "wordsUnchanged": 4 }
      },
      "disclaimer": "INFORMATIONAL NOTICE: ..."
    }
  }
  ```

---

### 16. Manage Policy Snapshots (Phase 8)
- **Save Snapshot Route**: `POST /api/sentinel/snapshot`
  - **Payload**: `{ "vendorName": "Slack", "version": "2026.1", "policyText": "...", "metadata": { ... } }`
  - **Response**: `{ "success": true, "snapshot": { "id": "...", "vendorName": "Slack", "version": "2026.1", "createdAt": "..." } }`
- **Get Snapshots Route**: `GET /api/sentinel/snapshots/:vendorName`
  - **Response**: `{ "success": true, "vendorName": "Slack", "snapshots": [ ... ] }`

---

### 17. Jurisdictional Statutory Audit (Phase 8)
- **Route**: `POST /api/compliance/audit`
- **Content-Type**: `application/json`
- **Payload**:
  ```json
  {
    "findings": [
      {
        "categoryId": "ARBITRATION",
        "severity": "HIGH",
        "evidence": "You agree to resolve all disputes exclusively through individual binding arbitration."
      }
    ],
    "jurisdiction": "EU_GDPR"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "compliance": {
      "jurisdiction": "EU_GDPR",
      "jurisdictionName": "European Union (GDPR & Consumer Rights Directive)",
      "overallEnforceability": "UNENFORCEABLE",
      "vulnerableClausesCount": 1,
      "audits": [
        {
          "categoryId": "ARBITRATION",
          "status": "UNENFORCEABLE",
          "statutoryBasis": "Directive 93/13/EEC (Unfair Contract Terms) Annex 1(q)",
          "citation": "EU Directive 93/13/EEC on Unfair Terms in Consumer Contracts",
          "guidance": "Mandatory pre-dispute arbitration clauses against EU consumers are generally deemed unfair and unenforceable under Annex 1(q)."
        }
      ],
      "disclaimer": "LEGAL DISCLAIMER: Informational compliance analysis only. Does not constitute legal advice."
    }
  }
  ```

---

### 18. Supported Jurisdictions Catalog (Phase 8)
- **Route**: `GET /api/compliance/jurisdictions`
- **Response**:
  ```json
  {
    "success": true,
    "jurisdictions": [
      { "id": "US_FEDERAL", "name": "United States (Federal / FTC / FAA)", "region": "US" },
      { "id": "US_CALIFORNIA", "name": "California (CCPA/CPRA, Auto-Renewal, UCL)", "region": "US-CA" },
      { "id": "EU_GDPR", "name": "European Union (GDPR & Unfair Contract Terms)", "region": "EU" },
      { "id": "UK_CRA", "name": "United Kingdom (Consumer Rights Act 2015)", "region": "UK" }
    ]
  }
  ```

---

### 19. Health Check
- **Route**: `GET /health`
- **Response**: `{ "status": "ok", "timestamp": "..." }`

