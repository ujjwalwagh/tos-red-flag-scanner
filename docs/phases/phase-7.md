# Phase 7: Interactive Contract Negotiation, Redline Amendments & Comparative Vendor Benchmarking ("ClauseGuard FairTerms")

## Overview & Purpose
Phase 7 advances ClauseGuard AI into an active commercial negotiation and contract drafting companion. Rather than solely analyzing one-sided terms and generating opt-out notices (Phases 1–6), users can now:
1. **Generate Fair Counter-Proposals**: Attorney-vetted alternative contract language across canonical risk categories, configurable across 3 negotiation postures (`BALANCED`, `AGGRESSIVE`, `CONSERVATIVE`).
2. **Visual Word-Level Redline Diffing**: Pure JavaScript token-level Longest Common Subsequence (LCS) engine generating structured diff chunks (`insert`, `delete`, `equal`) and safe HTML formatting (`<ins>`, `<del>`).
3. **Assemble Unified Contract Amendment Riders**: Compiles multiple negotiated amendments into an execution-ready legal addendum with recitals, conflict clauses, and signature blocks.
4. **Comparative Empirical Benchmarking**: Computes a vendor Restrictiveness Score (0–100) and sector percentile ranking across empirical industry baseline datasets (`SAAS_CLOUD`, `SOCIAL_MEDIA`, `ECOMMERCE`, `CONSUMER_APPS`, `GENERAL`).

---

## Architectural Additions

### 1. Negotiation Engine (`backend/src/negotiation/`)
- `redline-differ.js`:
  - Tokenizes contract clauses into semantic word/punctuation units.
  - Computes word-level diffs via Longest Common Subsequence (LCS) dynamic programming.
  - Emits structured diff chunks with statistics (`wordsAdded`, `wordsRemoved`, `wordsUnchanged`).
  - Generates safe HTML diffs using `<del class="diff-del">` and `<ins class="diff-ins">`.
- `amendment-generator.js`:
  - Contains standard, attorney-vetted fair counter-language templates across 16 canonical risk categories.
  - Provides 3 negotiation postures (`BALANCED`, `AGGRESSIVE`, `CONSERVATIVE`).
  - Generates tactical talking points and practical fallback alternatives.
  - Assembles multiple accepted amendments into a unified Contract Amendment Rider in Markdown.
  - Attaches informational legal disclaimer distinguishing self-advocacy drafting aids from legal counsel.

### 2. Comparative Benchmarking Engine (`backend/src/benchmarks/`)
- `benchmark-data.js`:
  - Empirical baseline distributions across 5 primary tech sectors.
  - Tracks average flag frequencies, arbitration prevalence, broad content rights overreach, and unilateral change rates.
- `benchmark-engine.js`:
  - Computes raw restrictiveness score based on weighted finding severities.
  - Normalizes score against sector averages to determine percentile ranking (5th to 99th percentile).
  - Categorizes standing: `Favorable` (<=30%), `Standard` (31–65%), `Restrictive` (66–85%), `High_Risk` (>85%).
  - Evaluates 4 key domains: Dispute Resolution, Content & IP Rights, Data Privacy & Sharing, Billing & Renewals.
  - Identifies outlier restrictiveness warnings.

### 3. Pipeline Augmentation
- In `backend/src/architecture/pipeline/analysis-pipeline.js`, the output envelope non-destructively includes `benchmarks` alongside `documentMetadata`, `findings`, `rankedFindings`, `checklist`, and `summary`.

---

## API Endpoints (Phase 7)

### 1. `POST /api/negotiation/amendment`
- **Request Body**:
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
      "talkingPoints": [
        "Mandatory binding arbitration strips constitutional jury rights and appeals.",
        "A 30-day informal mediation escalation period resolves legitimate disputes faster."
      ],
      "originalClause": "All disputes must be submitted to individual binding arbitration.",
      "proposedAmendment": "In the event of any dispute, claim, or controversy...",
      "fallbackAlternative": "If judicial resolution is rejected, propose AAA commercial arbitration...",
      "redline": {
        "diffChunks": [...],
        "htmlDiff": "<del class=\"diff-del\">All</del> <ins class=\"diff-ins\">In the event of</ins>...",
        "stats": { "wordsAdded": 42, "wordsRemoved": 8, "wordsUnchanged": 2 }
      },
      "disclaimer": "LEGAL DISCLAIMER: This document and proposed amendment language are automated informational drafting aids..."
    }
  }
  ```

### 2. `POST /api/negotiation/rider`
- **Request Body**:
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
    "agreementTitle": "Master Cloud Agreement",
    "effectiveDate": "2026-10-03"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "rider": {
      "agreementTitle": "Master Cloud Agreement",
      "companyName": "Vendor Corp",
      "counterpartyName": "Client LLC",
      "effectiveDate": "2026-10-03",
      "clauseCount": 1,
      "markdown": "# CONTRACT AMENDMENT RIDER\n\n...",
      "disclaimer": "LEGAL DISCLAIMER: ..."
    }
  }
  ```

### 3. `POST /api/benchmarks/evaluate`
- **Request Body**:
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
      "domainBreakdown": {
        "disputeResolution": { "status": "Restricted (Mandatory Arbitration)", "industryPrevalence": "52% of peers mandate arbitration", "isOutlier": false },
        "contentRights": { "status": "Standard Limited License", "industryPrevalence": "22% of peers claim broad licenses", "isOutlier": false }
      },
      "keyRiskOutliers": [...],
      "disclaimer": "LEGAL DISCLAIMER: Comparative benchmarking rankings are statistical approximations..."
    }
  }
  ```

---

## Verification & Backward Compatibility
- **Backward Compatibility**: All Phase 1–6 endpoints and response models remain 100% functional.
- **Zero Dependencies**: Pure ES module implementation without new npm packages.
- **Legal Safeguards**: Informational disclaimers are embedded across all negotiation proposals and riders to distinguish automated drafting aids from legal counsel.
