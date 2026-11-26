# Phase 9: AI Microservice Migration, Google Gemini 2.5 Pro Integration, ChromaDB RAG & Quantitative Academic Evaluation

> [!NOTE]
> **Architectural Progression Context:**  
> This specification documents the foundational AI Microservice migration that established the independent Python FastAPI service, Sentence-Transformers embeddings, ephemeral ChromaDB vector store, Gemini 2.5 Pro generative layer, and the quantitative academic evaluation framework.  
> Following this foundational migration, subsequent releases introduced **Phase 8A** (Manifest V3 Browser Extension & Multi-Document Isolation), **Phase 8B** (LangChain & LangGraph State Machine Dual-Engine Orchestration), and **Phase 8C** (Foundational API Bearer Authentication, Tiered Rate-Limiting, Internal Token Security, and Web/Extension Client Options). For the latest consolidated specifications, refer to [docs/architecture.md](../architecture.md) and [README.md](../../README.md).

## Overview & Purpose
Phase 9 transitions PrismClause from a single-tier rule-based application with optional NVIDIA NIM enrichment into a modern **hybrid Node.js/Express + Python/FastAPI architecture**. The phase establishes:
1. **Dedicated AI & NLP Microservice**: An independent Python/FastAPI service hosting dense sentence embeddings and semantic vector storage.
2. **Dense Vector Embeddings & Ephemeral Search**: Sentence-Transformers (`all-MiniLM-L6-v2`) generating 384-dimensional embeddings and ChromaDB managing document-scoped collections with a **zero-retention privacy runtime**.
3. **Resilient Microservice Bridge**: A non-fatal HTTP client with circuit breaking, health checks, and automatic fallback to deterministic lexical analysis.
4. **Google Gemini Generative Layer**: Migration to `gemini-2.5-pro` as the primary LLM provider for plain-English explanations and interactive evidence-grounded Q&A.
5. **Interactive Evidence-Grounded Q&A**: A secure, prompt-injection-shielded Q&A pipeline (`POST /api/analyze/qa`) with full frontend UI integration.
6. **Quantitative Evaluation Framework**: Automated academic evaluation measuring performance across the two core research gaps identified in literature (Personalized Ranking and Semantic ToS Change Detection).

---

## Sub-Phase Milestones

### Phase 9.1: Python & FastAPI Microservice Foundation
- Established `ai-service/` directory with standard Python packaging (`requirements.txt`).
- Implemented FastAPI application with CORS support, structured logging, and health endpoint (`GET /health`).
- Designed Pydantic v2 schemas for robust request/response validation.

### Phase 9.2: Sentence Transformer Embedding Engine & ChromaDB Vector Store
- **Embedding Engine (`EmbeddingService`)**:
  - Implemented singleton loader for `sentence-transformers/all-MiniLM-L6-v2`.
  - Exposed `/ai/embed` supporting both single strings and batched string arrays, returning normalized 384-dimensional dense vectors.
- **Vector Store Service (`VectorStoreService`)**:
  - Integrated **ChromaDB** using `chromadb.EphemeralClient()` for pure in-memory vector storage.
  - Implemented document-scoped collection lifecycle (`doc_<document_id>`) with explicit purge mechanisms (`DELETE /ai/vectors/{document_id}`).
  - Enforced zero-retention privacy: no customer contracts or vector graphs are permanently written to disk or databases.

### Phase 9.3: Resilient Node.js ↔ Python Bridge
- Implemented `PythonAiClient` in `backend/src/ai/ai-client.js`.
- Features:
  - Automated service health probing (`isAvailable()`).
  - Circuit breaker mechanism (trips after 3 consecutive failures; 10-second cooldown window).
  - Configurable timeouts (default 5,000ms).
  - Graceful fallback: If Python is offline, Node.js transparently reverts to deterministic rule analysis and lexical token diffing without returning errors to users.

### Phase 9.4: Google Gemini Integration, RAG Pipeline & Interactive Q&A
- **Gemini Provider (`GeminiProvider`)**:
  - Implemented dedicated adapter for Google Gemini (`gemini-2.5-pro`) targeting the `v1beta` `generateContent` endpoint.
  - Enforced structured JSON output via `responseMimeType: "application/json"`.
- **RAG Evidence Grounding**:
  - Extracted document clauses are indexed in ephemeral ChromaDB sessions.
  - Queries retrieve the Top-4 most semantically similar clauses to form the evidentiary basis for generative explanation.
- **Interactive Q&A API & Frontend Integration**:
  - Implemented `POST /api/analyze/qa` accepting user questions (3–500 chars) and document clauses (capped at 250).
  - Built prompt injection shielding using strict system instructions and triple-quote delimiters.
  - Integrated frontend UI in `frontend/public/` with character counter, live status indicator, grounded badge, and evidence citation cards.

### Phase 9.5: Quantitative Academic Evaluation Framework
- Built automated evaluation harness in `backend/src/evaluation/` executed via `node scripts/evaluate.js`.
- Implemented deterministic benchmark runners:
  - `ranking-evaluator.js`: Computes Precision@5 and Recall@5 over 20 distinct industry concern profiles.
  - `change-evaluator.js`: Computes Accuracy, Micro-F1, and Macro-F1 across 5 change magnitude classes (`NONE`, `MINOR`, `MODERATE`, `SIGNIFICANT`, `CRITICAL`) and 3 directional risk delta classes (`INCREASED_RISK`, `NEUTRAL`, `DECREASED_RISK`) over 30 annotated longitudinal revision pairs.
- Improved semantic change comparator (`clause-comparator.js`) with generalized duration, currency, modal obligation, and statutory liability extractions.

---

## Verified Quantitative Evaluation Results

The evaluation results on the standardized benchmark datasets comfortably surpass all academic targets:

| Evaluation Metric | Academic Target | Measured Result | Status |
|---|---|---|---|
| **Personalized Ranking Precision@5** | $\ge 85.00\%$ | **100.00%** | **MET [PASS]** |
| **Personalized Ranking Recall@5** | $\ge 85.00\%$ | **100.00%** | **MET [PASS]** |
| **ToS Change Magnitude Macro-F1** | $\ge 85.00\%$ | **92.06%** | **MET [PASS]** |
| **User Risk Delta Macro-F1** | $\ge 85.00\%$ | **100.00%** | **MET [PASS]** |

*Note: These metrics are measured on the project's curated benchmark datasets under experimental evaluation conditions and serve as an academic demonstration of algorithmic validity.*

---

## Verified Test Baseline & Progression

At the completion of Phase 9.5, the foundational AI microservice baseline was:
- **Node.js Test Suite (`node scripts/test-all.js`)**: **195 / 195 tests PASS** (16 test suites)
- **Python Test Suite (`pytest tests -v` in `ai-service/`)**: **24 / 24 tests PASS**
- **Phase 9 Baseline**: **219 / 219 tests PASS**

*Current Comprehensive Test Baseline (following Phases 8A, 8B, 8C, 9.1, 9.2, and 9.3):*
- **Node.js Test Suite (`npm test`)**: **606 / 606 tests PASS** (39 test suites)
- **Python AI Test Suite (`pytest ai-service/tests`)**: **73 / 73 tests PASS** (5 test files)
- **Quantitative Academic Evaluation (`scripts/evaluate.js`)**: **All 4 Targets Met** ($\ge 85\%$)
- **Historical Phase 9.3 Baseline**: **679 / 679 tests PASS (100% Pass Rate)**

*Verified Final Release Baseline (Phase 9.5 Local Release Readiness):*
- **Node.js Test Suite (`npm test`)**: **617 / 617 tests PASS** (40 test suites)
- **Python AI Test Suite (`pytest ai-service/tests`)**: **73 / 73 tests PASS** (5 test files)
- **Quantitative Academic Evaluation (`scripts/evaluate.js`)**: **All 4 Targets Met** (P@5: 99.00%, R@5: 99.00%, Macro-F1: 92.06%, Delta-F1: 100.00%)
- **Final Comprehensive Total**: **690 / 690 tests PASS (100% Pass Rate)**

---

## Zero-Retention Architecture Verification
- Document ingestion and clause segmentation execute strictly in-memory.
- Vector indexing utilizes `chromadb.EphemeralClient()`.
- Node.js invokes `withDocumentVectors(sessionId, clauses, callback)` which guarantees collection deletion via `deleteDocumentVectors` inside an unconditional `finally` block.
- Zero user agreements, clause texts, or embeddings persist beyond the lifecycle of an individual request.
