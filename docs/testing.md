# PrismClause (TOS Red Flag Scanner) — Testing Strategy & Verification

## 1. Overview & Test Architecture
PrismClause uses Node.js native test runner (`node:test` and `node:assert/strict`), eliminating external test framework dependencies (such as Jest or Mocha) for maximum execution speed, zero transitive dependency vulnerabilities, and native ES module compatibility.

All tests reside in a single canonical directory:
```text
backend/tests/
```

Running the full automated test suite:
```bash
npm test
# OR
node scripts/test-all.js
```

---

## 2. Test Suites & Coverage Breakdown

> [!NOTE]
> The table below captures the initial Phase 3 test suite baseline (118 tests across 11 suites). As of Phase 9.5, the comprehensive test suite has expanded to **690 automated tests** (617 Node.js backend tests across 40 suites + 73 Python AI service tests across 5 files). See [docs/architecture.md](architecture.md) and [docs/phases/phase-9.5-release-readiness-audit.md](phases/phase-9.5-release-readiness-audit.md) for the complete verified release breakdown.

The initial foundational test suite consists of **118 passing automated tests** across **11 test suites**:

| Test Suite File | Tests | Focus Area | Scope & Assertions |
| :--- | :---: | :--- | :--- |
| **`ai-analysis.test.js`** | 18 | AI Semantic Layer & Resilience | Validates `NullProvider` offline fallback, response schema parsing, finding deduplication, and non-blocking degradation on network failure. |
| **`api.test.js`** | 7 | HTTP Transport & Health | Tests `/health`, route mounting, rate limiting headers, and 404/405 error envelopes. |
| **`ingestion.test.js`** | 7 | Document Ingestion Safety | Verifies `%PDF-` magic-byte checks, buffer limits, scanned image OCR flags, and page-by-page extraction. |
| **`negotiation-benchmarks.test.js`**| 13 | Amendments & Benchmarks | Tests word-level diffing (`diffWords`), counter-proposal generation, and SaaS industry percentile comparisons. |
| **`normalization.test.js`** | 8 | Text Processing | Confirms Unicode NFKC normalization, smart-quote unification, ligature handling, and hyphenated word repair. |
| **`personalized-analysis.test.js`** | 14 | User Preferences & Lexical Diff | Tests weight clamping (1–5), dynamic reranking, impact magnitude, and lexical clause similarity algorithms. |
| **`portfolio-compliance.test.js`** | 12 | Portfolio, Drift & Compliance | Tests multi-vendor matrix comparisons, systemic concentration risk, chronological drift detection, and statutory unenforceability audits. |
| **`readability.test.js`** | 2 | Legalese Complexity | Verifies Flesch Reading Ease score, Flesch-Kincaid Grade Level, and complexity categorization. |
| **`remediation-reporting.test.js`** | 14 | Remediation & Multi-Format Export| Validates formal opt-out letters, action checklists, and Markdown, JSON, and HTML report export generators. |
| **`security.test.js`** | 4 | SSRF & URL Validation | Verifies rejection of private IP ranges, localhost targets, loopback addresses, and non-HTTP protocols. |
| **`segmentation.test.js`** | 19 | Clause Segmentation | Tests section heading detection, numbered clause parsing, boundary preservation, and multi-page index tracking. |
| **Total** | **118** | **Full System Coverage** | **118 Passing / 0 Failing** |

---

## 3. Static Code Integrity Verification

The repository verifies structural code integrity through automated AST validation scripts:

1. **Broken Import Verification**:
   Ensures every `import` across all `.js` files resolves to an existing file on disk.
2. **Circular Dependency Verification**:
   Traverses the module graph to guarantee zero circular dependency cycles.
3. **Secret Leakage Scan**:
   Scans all repository files with regular expressions matching known token and credential formats.

---

## 4. Headless Browser & Runtime Verification Protocol

In addition to automated unit tests, the live application is validated at `http://localhost:3000` via Chrome DevTools Protocol (CDP):

1. **Fresh Load Stability**:
   Navigate to `http://localhost:3000`. Observe for 15 seconds. Confirm zero background blinking, zero white flashes, and zero GPU compositing anomalies.
2. **Modal Interaction Cycles**:
   - Open and close Policy Drift Modal (`#drift-modal`) 3 times via both X button and Close button.
   - Open and close Multi-Vendor Matrix Modal (`#matrix-modal`).
   - Open and close SaaS Portfolio Modal (`#portfolio-modal`).
   - Verify modal backdrop renders cleanly (`rgba(0,0,0,0.75)` + blur) and dismisses cleanly without altering page state or restarting background animations.
3. **Console Hygiene**:
   Ensure 0 console errors, 0 CSP violations, and 0 uncaught promise rejections.
