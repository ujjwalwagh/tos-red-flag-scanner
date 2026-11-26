# PrismClause (ToS Red Flag Scanner)

**PrismClause** is an AI-powered document intelligence and legal risk analysis platform designed for consumer Terms of Service, Paid Subscription Agreements, and Privacy Policies. It combines high-precision deterministic legal heuristics with semantic vector search (ChromaDB + Sentence Transformers), Google Gemini generative AI explanations, and independent DeBERTa Natural Language Inference (NLI) cross-encoder verification.

The platform provides a streamlined, **Analyze-only Web Application** and a companion **Manifest V3 Chrome Extension** operating on a unified, local-first backend with a zero-retention privacy runtime.

---

## 1. Problem Statement

Consumer legal agreements are intentionally long, dense, and difficult to comprehend. The average consumer agrees to dozens of contracts yearly—granting broad content licenses, waiving class action rights, consenting to aggressive tracking, and enrolling in automatic renewal subscriptions—without reading or understanding the terms.

Standard LLM solutions suffer from hallucinations, token truncation on 500+ clause documents, and lack of factual verification. **PrismClause** solves this with a **grounded multi-tier architecture**:
1. Automatic detection and in-situ extraction of legal policies directly from live websites.
2. 14-category deterministic legal risk scoring.
3. Bounded semantic vector retrieval (up to 1,000 clauses).
4. Evidence-constrained Gemini Q&A.
5. Independent Cross-Encoder DeBERTa NLI verification to ensure answers are factually entailed by the original contract text.

---

## 2. Key Features

- **Focused Analyze Workflow:** Unified, clutter-free interface supporting three document ingestion modalities:
  - **URL Scanner:** Enter any online terms URL (e.g. `https://example.com/terms`) with automated server-side SSRF safety checks.
  - **PDF Ingestion:** Upload PDF contracts (up to 10MB) parsed in-memory with magic-byte validation.
  - **Raw Text Area:** Paste contract text directly for instant clause segmentation and evaluation.
- **14-Category Deterministic Risk Engine:** Instantly evaluates arbitration clauses, class action waivers, unilateral modification terms, auto-renewals, and broad content licensing without relying on external network calls.
- **Readability & Grade-Level Scoring:** Computes Flesch Reading Ease and Flesch-Kincaid Grade Level scores to quantify legal obscurity.
- **Evidence-Grounded Q&A:** Google Gemini answers user questions in plain English strictly using retrieved contract provisions.
- **Independent DeBERTa NLI Verification:** Local cross-encoder (`cross-encoder/nli-deberta-v3-base`) independently verifies whether Gemini's answer is factually entailed by the source clause, flagging contradictions and unverified claims.
- **Accurate Cosine Similarity Scores:** Formats genuine cosine similarity percentages (`81%`, `74%`) for cited clauses without fabricated scores.
- **Zero-Retention Privacy Runtime:** No raw agreements, user questions, or embeddings are permanently stored on disk. Ephemeral ChromaDB collections are created in memory and deleted immediately after query completion.
- **Manifest V3 Chrome Extension:** One-click legal link discovery on active browser tabs, in-situ text extraction, document isolation, and inline risk analysis.
- **Dual-Engine Q&A Architecture:** Features both a proven procedural RAG pipeline and an advanced **LangChain.js & LangGraph.js State Machine DAG** (`backend/src/rag/`) with structured output validation and dynamic conditional routing (`ENABLE_LANGGRAPH_QA`).
- **At-Most-Once LLM Quota Protection:** Dual-engine integration safeguards prevent duplicate Gemini calls during downstream verification or network failures.
- **Supporting Headless Domain APIs:** The backend retains modular, headless REST APIs for statutory compliance auditing (US, CA, EU, UK, IN), contract negotiation redline diffing, sector benchmarking, and multi-vendor portfolio analytics.

---

## 3. Technology Stack

- **Chrome & Edge Extension:** Manifest V3, ES Modules, `chrome.scripting`, `chrome.storage.session`, `chrome.storage.local`.
- **Frontend Web App:** Vanilla HTML5, CSS3 Glassmorphism design system, ES6+ JavaScript, Centralized `api-client.js`.
- **Backend API Gateway:** Node.js v22+, Express 5, Helmet, Express-Rate-Limit, Axios, Cheerio.
- **RAG & Agentic Orchestration:** LangChain.js (`@langchain/core`, `@langchain/google-genai`), LangGraph.js (`@langchain/langgraph`), Zod structured schema validation.
- **AI Microservice:** Python 3.13+, FastAPI, Uvicorn, PyTorch (CPU inference).
- **Embeddings & Vector Store:** `sentence-transformers/all-MiniLM-L6-v2` (384-dimensional dense vectors), ChromaDB (ephemeral in-memory collections).
- **NLI Verification:** `cross-encoder/nli-deberta-v3-base` (Sequence classification on CPU).
- **Generative AI Provider:** Google Gemini API (`gemini-2.5-pro` with automatic fallback to `gemini-3.5-flash-lite`, and `NullProvider` zero-key fallback).
- **Testing:** Node.js native test runner (`node:test`, 596 tests across 40 suites), Pytest (73 tests across 5 suites). Total: **669 passing tests (100% pass rate)**.

---

## 4. Architecture Overview

```
[ Active Webpage DOM ]
         ▲
         │ chrome.scripting (On-demand DOM extraction)
         ▼
[ Chrome MV3 Extension ] ────────┐
(popup.js / service-worker.js)   │  HTTP / REST (JSON)
                                 ▼
[ Web Application (Analyze) ] ──► [ Node.js Express Backend ] (127.0.0.1:3000)
(app.js / index.html)              │  - Ingestion (PDF / URL / Text)
                                   │  - Deterministic Risk Engine (14 Categories)
                                   │  - Readability Scoring (Flesch-Kincaid)
                                   │  - Dual-Engine Q&A Orchestrator:
                                   │      ├─ Engine 1: Procedural RAG Pipeline
                                   │      └─ Engine 2: LangGraph State Machine DAG
                                   │  - Supporting Headless APIs (Compliance, Negotiation)
                                   │
                                   ▼ HTTP / REST (Internal Bridge, Header: X-Internal-Token)
                             [ Python AI Microservice ] (127.0.0.1:8000)
                               - FastAPI (Uvicorn)
                               - Sentence Transformers (all-MiniLM-L6-v2)
                               - ChromaDB Ephemeral Vector Store (Memory-Only)
                               - DeBERTa NLI Cross-Encoder (CPU)
```

---

## 5. Project Structure

```text
D:\TOS red flag scanner/
├── .env.example                     # Environment configuration template
├── package.json                     # Root orchestrator & scripts
├── scripts/
│   ├── start.js                     # Unified concurrent process manager (npm start)
│   ├── test-all.js                  # Master Node.js test runner
│   ├── evaluate.js                  # Quantitative academic evaluation benchmark runner
│   └── generate-token.mjs           # Cryptographic token generator
│
├── frontend/                        # Web client (Analyze-Only Interface)
│   └── public/
│       ├── index.html               # Main Analyze dashboard UI
│       ├── app.js                   # Web application logic & UI controllers
│       ├── api-client.js            # Secure API client with Bearer auth & URL validation
│       └── styles.css               # Dark cyber glassmorphism design system
│
├── backend/                         # Node.js Express API server (127.0.0.1:3000)
│   ├── server.js                    # Express application entry point & middleware mounting
│   ├── src/
│   │   ├── ai/                      # Gemini adapter, provider factory & Python bridge
│   │   ├── analysis/                # Deterministic risk engine & readability
│   │   ├── api/                     # Controllers and routes (/api/scan, /api/analyze/qa)
│   │   ├── compliance/              # Supporting statutory compliance auditor (US, CA, EU, UK, IN)
│   │   ├── config/                  # Environment loading & validation (env.js)
│   │   ├── evaluation/              # Academic benchmark datasets & evaluators
│   │   ├── ingestion/               # SSRF-safe URL fetching & PDF text extraction
│   │   ├── negotiation/             # Supporting contract amendment & LCS redline differ
│   │   ├── portfolio/               # Supporting multi-vendor portfolio risk aggregator
│   │   ├── rag/                     # LangChain & LangGraph RAG orchestration
│   │   │   ├── langchain/           # Prompts, schemas (Zod), and model adapter
│   │   │   └── langgraph/           # State annotation, 6 graph nodes, conditional routing
│   │   ├── security/                # CORS, Bearer auth, tiered rate limits, origin validator
│   │   └── sentinel/                # Supporting policy drift engine & redline differ
│   └── tests/                       # 40 Node.js test suites (596 passing tests)
│
├── ai-service/                      # Python FastAPI microservice (127.0.0.1:8000)
│   ├── app/
│   │   ├── main.py                  # FastAPI application entry point & lifespan
│   │   ├── config.py                # Environment configuration & internal auth settings
│   │   ├── security/                # InternalTokenAuthMiddleware (X-Internal-Token)
│   │   ├── services/
│   │   │   ├── embedding_service.py # Sentence Transformers singleton (all-MiniLM-L6-v2)
│   │   │   ├── vector_store.py      # ChromaDB ephemeral vector store service
│   │   │   └── nli_service.py       # DeBERTa-v3 NLI verification engine
│   │   └── routers/                 # Vector and NLI API endpoints
│   └── tests/                       # 5 Pytest suites (73 passing tests)
│
├── extension/                       # Chrome & Edge Manifest V3 Extension
│   ├── manifest.json                # MV3 extension manifest with options_ui
│   ├── background/
│   │   └── service-worker.js        # Background worker & SEC-EXT-1 sender validation
│   ├── popup/
│   │   ├── popup.html               # Extension popup UI
│   │   ├── popup.js                 # Candidate registry & state management
│   │   └── popup.css                # Compact extension styling
│   ├── options/                     # Options page (Dynamic backend & Bearer auth)
│   ├── content/                     # In-situ legal link detection & DOM extraction
│   └── utils/                       # Detection heuristics & backend configuration
│
└── docs/                            # Consolidated Master Documentation
    ├── ARCHITECTURE.md              # Technical architecture & RAG lifecycle specification
    ├── API_REFERENCE.md             # Complete REST API reference (UI & Supporting APIs)
    ├── SECURITY.md                  # Zero-retention model, SSRF defenses & Bearer auth
    ├── DEVELOPMENT.md               # Windows setup, .env guide, testing & benchmarks
    ├── ACADEMIC_ALIGNMENT.md        # Academic alignment, viva defense guide & RAG theory
    ├── RELEASE_CHECKLIST.md         # Pre-flight release verification checklist
    ├── ui-ux.md                     # UI/UX design tokens and Analyze interface specification
    └── archive/                     # Historical project milestones & audit records
        ├── phases/                  # Historical phase specifications (Phases 1–9.5)
        └── phase-8c/                # Historical security assessment & auth design notes
```

---

## 6. Quickstart & Installation

### Prerequisites
- **Node.js:** `>= 20.0.0` (v22 LTS recommended)
- **Python:** `3.10` to `3.13` (Python 3.13 tested)
- **Google Chrome / Microsoft Edge:** For Manifest V3 extension loading
- **Google Gemini API Key:** From [Google AI Studio](https://aistudio.google.com/app/apikey)

### Quick Setup

1. **Clone or Navigate to the Repository:**
   ```powershell
   cd "D:\TOS red flag scanner"
   ```

2. **Install Node.js Dependencies:**
   ```powershell
   npm install
   ```

3. **Set Up Python Virtual Environment:**
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r ai-service/requirements.txt
   ```

4. **Configure Environment Variables:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Configure your `GEMINI_API_KEY` in `.env`.

5. **Start Services:**
   ```powershell
   npm start
   ```
   The unified process manager (`scripts/start.js`) launches both microservices concurrently:
   - Web Application: [http://localhost:3000](http://localhost:3000)
   - Backend Health Check: [http://localhost:3000/health](http://localhost:3000/health)
   - Python AI Health Check: [http://localhost:8000/health](http://localhost:8000/health)

6. **Load Extension in Chrome:**
   - Open `chrome://extensions/` and toggle on **Developer mode**.
   - Click **Load unpacked** and select `D:\TOS red flag scanner\extension`.

For comprehensive setup details and troubleshooting, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## 7. Automated Testing & Verification

Execute the complete test suite across Node.js and Python:

```powershell
# Run Node.js test suite (596 tests across 40 suites)
npm test

# Run Python AI service test suite (73 tests across 5 suites)
.\.venv\Scripts\python.exe -m pytest ai-service\tests -q

# Run Academic Quantitative Evaluation benchmark
node scripts/evaluate.js
```

**Total Automated Test Coverage:** **669 tests passing, 0 failing, 0 skipped (100% pass rate)**.

---

## 8. Master Documentation

For in-depth technical specifications, refer to the consolidated documentation guides:

| Guide | Description |
| :--- | :--- |
| **[Architecture Specification](docs/ARCHITECTURE.md)** | System topology, 9-stage RAG lifecycle, LangGraph DAG, and NLI Softmax formulation. |
| **[API Reference](docs/API_REFERENCE.md)** | Complete REST endpoint schemas for Analyze UI and supporting headless APIs. |
| **[Security & Privacy Specification](docs/SECURITY.md)** | Zero-retention model, SSRF protection, Bearer token auth, and extension security bounds. |
| **[Developer & Operations Guide](docs/DEVELOPMENT.md)** | Step-by-step Windows provisioning, `.env` matrix, process manager, and test execution. |
| **[Academic Alignment & Viva Guide](docs/ACADEMIC_ALIGNMENT.md)** | Mathematical formulations of RAG/NLI, IR benchmark metrics, and theoretical defense. |
| **[Pre-Flight Release Checklist](docs/RELEASE_CHECKLIST.md)** | Authoritative verification checklist for local release and demonstration. |
