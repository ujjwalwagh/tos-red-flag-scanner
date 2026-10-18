# PrismClause (TOS Red Flag Scanner)

An AI-based, informational legal-document analysis system for personalized prioritization of Terms of Service clauses, semantic detection of version changes, and evidence-grounded interactive Q&A.

PrismClause operates on a **hybrid Node.js/Express + Python/FastAPI architecture** with an in-memory **zero-retention privacy runtime** (no raw ToS documents or embeddings are permanently stored).

---

## 1. System Architecture Overview

PrismClause combines high-precision deterministic legal heuristics with modern NLP embeddings, vector retrieval, and generative AI explanations:

- **Frontend (`frontend/public/`)**: Modern Vanilla HTML5, CSS3, and ES6+ JavaScript client providing risk meters, personalized sliders, redline diff visualizers, and an interactive Q&A interface.
- **Gateway & Business Logic (`backend/`)**: Node.js and Express 5 server orchestrating ingestion, text normalization, clause segmentation, 14-category rule analysis, personalized ranking, and redline diffing.
- **AI & NLP Microservice (`ai-service/`)**: Python and FastAPI service providing dense embeddings (`sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions) and document-scoped vector retrieval via **ChromaDB**.
- **Generative AI Layer**: Google Gemini (`gemini-2.5-pro`) providing evidence-grounded plain-English explanations and interactive Q&A constrained strictly to retrieved ToS evidence.
- **Offline / Local Resilience**: If AI services or API keys are unavailable, the system degrades gracefully to deterministic rule-based analysis and local lexical comparisons without throwing fatal errors.

```text
User / Browser Client (http://localhost:3000)
       │
       ▼
Node.js / Express 5 API Gateway (backend/)
  ├── Deterministic Rule Engine (14 Legal Categories)
  ├── Personalized Clause Ranker (Dynamic User Concern Weights)
  ├── Contract Redline Differ & Remediation Generator
  └── Resilient AI Client Bridge (Circuit Breaker)
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
Python / FastAPI AI Service (ai-service/)   Google Gemini (gemini-2.5-pro)
  ├── Sentence-Transformers (all-MiniLM-L6-v2) ├── Evidence-Grounded Explanations
  └── ChromaDB (Ephemeral Vector Store)        └── Strict-JSON Interactive Q&A
```

---

## 2. Monorepo Structure

```text
d:/TOS red flag scanner/
│
├── .env.example                                      # Root environment variable template
├── package.json                                       # Root monorepo orchestrator & scripts
├── package-lock.json                                  # Monorepo lockfile
├── README.md                                          # Project documentation & overview
│
├── frontend/
│   └── public/                                        # Production Frontend (Vanilla HTML5/CSS/JS)
│       ├── index.html                                 # Semantic application shell & Q&A containers
│       ├── styles.css                                 # Design system tokens & glassmorphism styling
│       ├── app.js                                     # Authoritative client application controller
│       ├── logo.svg                                   # Brand vector icon
│       ├── share-card.svg                             # Social preview card
│       └── background.mp4                             # Video background (.bg-video: display: none)
│
├── backend/
│   ├── .env.example                                  # Backend environment configuration template
│   ├── package.json                                   # Backend microservice metadata & scripts
│   ├── server.js                                      # Express 5 server, CSP, security headers & routing
│   │
│   ├── src/
│   │   ├── ai/                                        # AI provider adapters (Gemini, NVIDIA, Null) & Python client
│   │   ├── analysis/                                  # Rule engine, readability, semantic comparator & ranker
│   │   ├── api/                                       # Route controllers, upload middleware & Q&A handlers
│   │   ├── architecture/                              # Central document analysis pipeline
│   │   ├── benchmarks/                                # SaaS & enterprise legal benchmark distributions
│   │   ├── compliance/                                # Statutory unenforceability auditor (EU, CA, UK, US)
│   │   ├── config/                                    # Centralized environment loader (env.js)
│   │   ├── evaluation/                                # Quantitative evaluation framework & datasets
│   │   │   ├── data/                                  # Curated ranking & change benchmark datasets
│   │   │   ├── ranking-evaluator.js                   # Precision@5 and Recall@5 benchmark runner
│   │   │   └── change-evaluator.js                    # Multi-class Macro-F1 benchmark runner
│   │   ├── ingestion/                                 # PDF magic-byte validation, OCR check & SSRF-safe URL fetcher
│   │   ├── negotiation/                               # Word-level redline differ & amendment generator
│   │   ├── portfolio/                                 # Multi-vendor portfolio risk aggregation & matrix comparator
│   │   ├── processing/                                # Unicode NFKC normalizer & clause segmenter
│   │   ├── remediation/                               # Opt-out notice generator & action checklist builder
│   │   ├── reporting/                                 # Markdown, JSON, and printable HTML report exporter
│   │   ├── security/                                  # AppError class and SSRF URL validator
│   │   ├── sentinel/                                  # Chronological policy drift calculator & snapshot store
│   │   └── utils/                                     # Structured JSON audit logging
│   │
│   └── tests/                                         # 16 Unit and Integration test suites (195 tests)
│
├── ai-service/                                        # Python / FastAPI AI & Vector Microservice
│   ├── requirements.txt                               # Python dependencies (FastAPI, ChromaDB, Sentence-Transformers)
│   ├── app/
│   │   ├── main.py                                    # FastAPI application & route endpoints
│   │   ├── config.py                                  # Pydantic v2 application settings
│   │   ├── schemas/                                   # Request & response data transfer models
│   │   └── services/
│   │       ├── embedding_service.py                   # Sentence-Transformers all-MiniLM-L6-v2 singleton
│   │       └── vector_store.py                        # ChromaDB ephemeral vector store service
│   └── tests/                                         # Pytest suite (24 tests)
│
├── docs/
│   ├── architecture.md                                # Authoritative hybrid system architecture specification
│   ├── ui-ux.md                                       # Complete UI/UX design system & modal behavior guide
│   ├── api.md                                         # Comprehensive HTTP API reference (including Q&A)
│   ├── security.md                                    # Threat model, SSRF protection, CSP & security rules
│   ├── testing.md                                     # Test layout, execution procedures & verification
│   ├── deployment.md                                  # Production deployment & service guide
│   └── phases/                                        # Historical milestone documentation (Phases 1–9)
│
└── scripts/
    ├── start.js                                       # Node.js backend launcher
    ├── test-all.js                                    # Automated Node.js test runner
    └── evaluate.js                                    # Academic quantitative evaluation CLI
```

---

## 3. Quickstart

### 3.1 Setup Node.js Backend Gateway
```bash
# 1. Install root & backend dependencies
npm install

# 2. Configure environment (optional)
cp .env.example .env

# 3. Start the Express server
npm start
```
The web application is accessible at [http://localhost:3000](http://localhost:3000).

### 3.2 Setup Python FastAPI AI Service (Optional for Local Vectors & Embeddings)
```bash
cd ai-service

# 1. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate

# 2. Install Python requirements
pip install -r requirements.txt

# 3. Run FastAPI microservice
uvicorn app.main:app --port 8000
```
*Note: If the Python service is offline, the Node.js gateway automatically falls back to deterministic lexical diffing and rule matching without interruptions.*

---

## 4. Test Verification Baseline

The repository is covered by an automated test suite across both Node.js and Python runtimes:

- **Node.js Test Suite**: **195 / 195 PASS** (16 test suites via `npm test` or `node scripts/test-all.js`)
- **Python Test Suite**: **24 / 24 PASS** (FastAPI, Embeddings, ChromaDB via `pytest tests -v` inside `ai-service/`)
- **Total Combined Tests**: **219 / 219 PASS (100% Pass Rate)**

---

## 5. Quantitative Evaluation Results

The system implements automated benchmarking across the two primary research gaps identified in literature:

```bash
node scripts/evaluate.js
```

### Verified Benchmark Results:
1. **Personalized Clause Ranking (Core Gap 1)**:
   - **Mean Precision@5**: **100.00%** (Academic Target: $\ge 85.00\%$) $\rightarrow$ **MET [PASS]**
   - **Mean Recall@5**: **100.00%** (Academic Target: $\ge 85.00\%$) $\rightarrow$ **MET [PASS]**
   - *Evaluated over 20 distinct industry concern profiles (SaaS, FinTech, E-Commerce, Social Media, HealthTech, etc.).*

2. **ToS Change Impact Detection (Core Gap 2)**:
   - **Change Magnitude Accuracy**: **93.33%**
   - **Change Magnitude Macro-F1**: **92.06%** (Academic Target: $\ge 85.00\%$) $\rightarrow$ **MET [PASS]**
   - **User Risk Delta Accuracy**: **100.00%**
   - **User Risk Delta Macro-F1**: **100.00%** (Academic Target: $\ge 85.00\%$) $\rightarrow$ **MET [PASS]**
   - *Evaluated over 30 annotated longitudinal clause revision pairs.*

> [!NOTE]
> **Academic Scope & Evaluation Notice:** These metrics are measured on the project's standardized benchmark evaluation datasets. They demonstrate algorithmic validity and target achievement under experimental conditions; they do not imply or guarantee universal real-world accuracy across all unseen legal texts. The system serves as an informational document-analysis tool and does not provide legal advice.

---

## 6. Core Platform Capabilities

- **PDF Ingestion & OCR Check:** Validates `%PDF-` magic bytes, extracts text per page, preserves page numbering, and flags image scans.
- **SSRF-Protected URL Fetching:** Resolves public policy URLs while strictly blocking private, internal, loopback (RFC 1918), and cloud metadata IP spaces.
- **Deterministic Rule Engine:** 14 legal risk categories evaluated via regex and pattern heuristics.
- **Personalized Risk Ranking:** Dynamic user concern weights ($1\dots5$) calculate custom impact scores and ranking reasons.
- **Semantic Change Detection:** Multi-class change magnitude (`NONE`, `MINOR`, `MODERATE`, `SIGNIFICANT`, `CRITICAL`) and risk direction shifts (`INCREASED_RISK`, `NEUTRAL`, `DECREASED_RISK`).
- **ChromaDB RAG Evidence Grounding:** Ephemeral document-scoped vector retrieval (top-4 clauses) supporting downstream explanations.
- **Interactive Grounded Q&A:** User questions are bounded (500 chars), prompt-injection shielded, and answered strictly using retrieved ToS evidence via `gemini-2.5-pro`.
- **Zero-Retention Privacy:** No raw policy texts or vector embeddings are permanently persisted to databases.

---

## 7. Documentation Index

- [System Architecture](file:///d:/TOS%20red%20flag%20scanner/docs/architecture.md) — Hybrid architecture and component boundaries.
- [API Endpoints Reference](file:///d:/TOS%20red%20flag%20scanner/docs/api.md) — HTTP API contracts including Q&A.
- [Phase 9 Milestone Report](file:///d:/TOS%20red%20flag%20scanner/docs/phases/phase-9.md) — Gemini 2.5 Pro, RAG, Q&A, and evaluation.
- [UI/UX Design System](file:///d:/TOS%20red%20flag%20scanner/docs/ui-ux.md) — Visual styling and accessible components.
- [Security & Threat Model](file:///d:/TOS%20red%20flag%20scanner/docs/security.md) — SSRF protection, CSP, and prompt isolation.
- [Testing & Verification Guide](file:///d:/TOS%20red%20flag%20scanner/docs/testing.md) — Node and Python testing procedures.
- [Historical Milestone Archives](file:///d:/TOS%20red%20flag%20scanner/docs/phases/) — Milestone records (Phases 1 through 9).
