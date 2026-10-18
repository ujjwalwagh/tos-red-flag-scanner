# Phase 5: Personalized Risk Ranking, Change Impact & User-Focused Analysis

## Overview & Purpose
Phase 5 introduces the user-centric analysis layer on top of the canonical pipeline (Document Ingestion -> Text Normalization -> Clause Segmentation -> Rule-Based Detection -> AI/Semantic Analysis). It translates raw technical detections into personalized, explainable, and actionable insights aligned with individual user concerns and risk tolerance.

---

## Key Capabilities

1. **Centralized Risk Categories** (`backend/src/analysis/risk-categories.js`):
   - 16 canonical risk categories covering data privacy, arbitration, content licensing, billing/renewal, liability, unilateral modifications, and account termination.
   - Comprehensive metadata: canonical ID, display name, description, default user weight (1–5), baseline severity characteristics, and impact domain.
   - Case-insensitive alias resolution ensuring backward compatibility across legacy rule definitions and user input strings.

2. **User Concern Weight Preferences** (`backend/src/analysis/user-preferences.js`):
   - Numerical weights from `1` (minimal concern / low impact) to `5` (critical concern / high impact).
   - Strict validation, normalization, and bounds clamping `[1, 5]`.
   - Safe deterministic fallback to category default weights when preferences are omitted or malformed.

3. **Personalized Risk Ranking Engine** (`backend/src/analysis/personalized-ranker.js`):
   - Computes a deterministic `personalizedScore` blending base severity, detection confidence, user concern weight, and AI enhancement factors.
   - Sorts findings dynamically by personalized urgency while preserving stable secondary sorting.
   - Generates 1-indexed ranks, context-aware `rankingReason`, and an aggregated `personalizedSummary` (overall personalized score, severity distribution, top prioritized categories).

4. **Impact Magnitude Evaluation & Plain-English Explanations** (`backend/src/analysis/impact-evaluator.js`):
   - Derives consumer-friendly impact levels: `Critical`, `High`, `Medium`, `Low`.
   - Generates transparent, multi-dimensional plain-English explanations answering:
     - What does this clause say? (Original evidence strictly preserved)
     - Why was it flagged?
     - What category does it belong to?
     - Why might it matter to the user?
     - What specific actions/attention points are recommended?

5. **Semantic Change & Clause Comparison** (`backend/src/analysis/semantic/clause-comparator.js`):
   - Compares previous vs. updated clause provisions when versions are supplied.
   - Computes deterministic lexical similarity metrics (token sets, Jaccard similarity, word count delta).
   - Engages semantic AI analysis via `NvidiaProvider` when available, returning structured alignment, change magnitude (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), and plain-English impact explanations.
   - Degrades safely to `available: false` with method `lexical_fallback` when the AI provider or API key is absent, avoiding fabricated semantic claims.

---

## Architectural Changes & Pipeline Integration

- **Analysis Pipeline (`backend/src/architecture/pipeline/analysis-pipeline.js`)**:
  - Incorporates `rankFindings()` as the final stage of analysis.
  - Returns both `findings` (Phase 3/4 baseline order) and `rankedFindings` (Phase 5 personalized order) to guarantee 100% backward compatibility with all prior consumers and tests.
  - Attaches `summary.personalized` containing personalized health/risk metrics.

- **API Layer**:
  - `GET /api/analyze/categories`: Returns catalog of all supported risk categories and default concern weights.
  - `POST /api/analyze`: Accepts optional `userPreferences` object; generates ranked findings with personalized impact and plain-English explanations.
  - `POST /api/analyze/compare`: Compares `oldClauseText` and `newClauseText`, providing structured change impact analysis.
  - Legacy `POST /api/scan`: Enriched to include personalized ranks and impact badges when preferences are supplied.

- **Frontend User Interface**:
  - Collapsible **User Risk Preferences** panel with interactive sliders (Arbitration, Privacy & Data Sharing, Auto-Renewal, Content Rights).
  - Prominent `#Rank` badges, severity badges, and personalized impact indicators (`Critical`, `High`, `Medium`, `Low`).
  - Transparent "Why this is ranked here" explanation callouts for each flagged clause.

---

## AI Safety & Graceful Degradation
- All baseline functionality, category mappings, preference clamping, impact evaluations, plain-English translations, and personalized rankings operate 100% deterministically without external network calls.
- When `NVIDIA_API_KEY` is omitted or invalid, `NullProvider` activates cleanly.
- Clause comparison responds with `available: false`, transparently exposing deterministic lexical comparison metrics without ever fabricating artificial AI consensus or conclusions.

---

## Test Verification
- All 48 Phase 1–4 regression tests pass.
- All 22 new Phase 5 tests pass (`backend/tests/personalized-analysis.test.js`).
- Total: **70 passed, 0 failed**.
- 0 broken imports detected.
- 0 circular dependencies detected.
