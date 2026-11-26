# Phase 8: Multi-Vendor Portfolio Risk Analytics, Policy Drift Timeline Tracking & Jurisdictional Regulatory Compliance Auditing ("ClauseGuard Enterprise & Sentinel")

## Overview & Purpose
Phase 8 expands ClauseGuard AI into an enterprise-ready **Vendor Portfolio Risk Management & Continuous Compliance Platform**. Rather than analyzing individual documents in isolation (Phases 1–7), organizations and power users can now:
1. **Aggregate Multi-Vendor Portfolio Risk**: Ingest and compute cumulative "Stack Risk Scores" (0–100) across all active tools in a tech stack and expose systemic risk concentrations.
2. **Head-to-Head Comparative Vendor Matrix**: Align 2 to 5 competing vendors in a side-by-side grid across all 16 canonical risk categories with automated procurement recommendations.
3. **Continuous Policy Drift & Version History ("Sentinel")**: Chronologically track terms across revisions, calculate semantic drift magnitude, identify added/removed restrictions, and view redline transition diffs.
4. **Jurisdictional Regulatory Auditing ("LexCheck")**: Cross-reference clauses against statutory regimes (**EU GDPR / UCTD**, **California CCPA/CPRA**, **US Federal FTC Act § 5**, **UK Consumer Rights Act 2015**) with statutory citations and enforceability indicators.

---

## Architectural Additions

### 1. Portfolio & Vendor Comparator Engine (`backend/src/portfolio/`)
- `portfolio-engine.js`:
  - Computes weighted aggregate Stack Risk Scores.
  - Determines portfolio health status (`CONTROLLED_RISK`, `MODERATE_RISK`, `CRITICAL_EXPOSURE`).
  - Identifies systemic risk concentrations (e.g., arbitration prevalence across >40% of vendors).
  - Ranks vendors from lowest to highest contractual restrictiveness.
- `vendor-comparator.js`:
  - Normalizes and aligns clauses across 2 to 5 vendors for all 16 canonical risk categories.
  - Generates procurement scorecards and trade-off rationales.

### 2. Sentinel Policy Drift Engine (`backend/src/sentinel/`)
- `drift-engine.js`:
  - Evaluates baseline vs. current versions of vendor policies.
  - Detects `driftDirection` (`MORE_RESTRICTIVE`, `MORE_FAVORABLE`, `NEUTRAL`) and `driftMagnitude` (`HIGH`, `MODERATE`, `MINIMAL`).
  - Integrates with `redline-differ.js` for verbatim word-level transition diffs.
- `snapshot-store.js`:
  - Lightweight session store caching version snapshots for temporal analysis.

### 3. Statutory Compliance Auditor (`backend/src/compliance/`)
- `statutory-rules.js`:
  - Curated legal framework mappings:
    - **US Federal**: FTC Act § 5, FAA (9 U.S.C. § 2), ROSCA Negative Option Rule.
    - **California**: CCPA/CPRA, Cal. Civ. Code § 1750 (CLRA), Cal. Bus. & Prof. Code § 17600 (ARL) & § 17200 (UCL).
    - **European Union**: GDPR (Arts. 6, 7, 12, 17), Unfair Contract Terms Directive 93/13/EEC, Representative Actions Directive 2020/1828.
    - **United Kingdom**: Consumer Rights Act 2015 (Schedule 2 unfair terms).
- `statutory-auditor.js`:
  - Evaluates findings against target jurisdiction.
  - Emits statutory citations, guidance, and enforceability statuses (`LIKELY_UNENFORCEABLE_CONSUMER`, `REGULATORY_VIOLATION_RISK`, `UNENFORCEABLE_WITHOUT_NOTICE`, etc.).

---

## API Endpoints (Phase 8)

### 1. `POST /api/portfolio/evaluate`
Aggregates multiple vendor analyses into a unified corporate portfolio risk summary.

### 2. `POST /api/portfolio/compare`
Compiles a side-by-side comparative matrix across 2 to 5 competing vendors.

### 3. `POST /api/sentinel/drift`
Evaluates chronological drift between historical policy versions.

### 4. `POST /api/sentinel/snapshot` & `GET /api/sentinel/snapshots/:vendorName`
Saves and retrieves historical policy snapshots.

### 5. `POST /api/compliance/audit`
Audits findings against target statutory regimes (`US_FEDERAL`, `US_CALIFORNIA`, `EU_GDPR`, `UK_CRA`).

### 6. `GET /api/compliance/jurisdictions`
Returns list of supported statutory jurisdictions.

---

## Verification & Backward Compatibility
- **Backward Compatibility**: All Phase 1–7 APIs remain 100% operational with identical payload/response schemas.
- **Zero Dependencies**: Pure Node.js ES modules and vanilla web standards.
- **Legal Safeguards**: Mandatory informational disclaimers accompany all portfolio evaluations, vendor comparisons, and statutory audits.
