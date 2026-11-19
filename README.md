# TOS Red Flag Scanner (PrismClause)

**TOS Red Flag Scanner** is an AI-powered document intelligence and legal risk analysis platform designed for consumer Terms of Service, Paid Subscription Agreements, and Privacy Policies. It combines high-precision deterministic legal heuristics with semantic vector search (ChromaDB + Sentence Transformers), DeBERTa Natural Language Inference (NLI), and Google Gemini generative AI explanations.

The system features both an **interactive Web Application** and a **Manifest V3 Chrome Extension** operating on a unified, local-first backend with zero permanent data retention.

---

## 1. Problem Statement

Consumer legal agreements are intentionally long, dense, and difficult to comprehend. The average consumer agrees to dozens of contracts yearly—granting broad content licenses, waiving class action rights, consenting to aggressive tracking, and enrolling in automatic renewal subscriptions—without reading or understanding the terms.

Standard LLM solutions suffer from hallucinations, token truncation on 500+ clause documents, and lack of factual verification. **TOS Red Flag Scanner** solves this with a **grounded multi-tier architecture**:
1. Automatic detection and in-situ extraction of policies directly from live websites.
2. 14-category deterministic legal risk scoring.
3. Bounded semantic vector retrieval (up to 1,000 clauses).
4. Evidence-constrained Gemini Q&A.
5. Cross-Encoder DeBERTa NLI verification to ensure answers are factually entailed by the original contract text.

---

## 2. Key Features

- **Automated Legal Document Discovery:** Scans the active browser tab to identify Terms of Service, Paid Subscription Terms, Privacy Policies, Regional Privacy Links ("Do Not Sell"), and Central Legal Hubs.
- **In-Place & Isolated Cross-Origin Extraction:** Extracts clean, readable text directly on-page or via isolated background tabs (closed immediately after extraction).
- **Multi-Document Isolation:** Complete candidate-specific state isolation ensuring Terms, Subscription Terms, and Privacy Policies never share extraction state, risk reports, or Q&A histories.
- **Deterministic 14-Category Risk Engine:** Instantly evaluates arbitration clauses, liability caps, unilateral modification clauses, auto-renewals, and content licensing.
- **Readability & Grade-Level Scoring:** Computes Flesch-Kincaid Grade Level and Reading Ease scores for legal transparency.
- **1,000-Clause Scalability:** Processes massive legal documents (e.g., Spotify Privacy Policy with 642+ clauses) using sequential batch chunking with atomic rollback.
- **Oversized Document Consent:** Documents exceeding 100,000 characters require explicit user consent for partial scanning, eliminating silent truncation.
- **Dual-Engine Q&A Orchestration:** Features both a proven procedural RAG pipeline and an advanced **LangChain.js & LangGraph.js State Machine** (`backend/src/rag/`) with structured output validation (`qaAnswerSchema`) and dynamic conditional routing.
- **At-Most-Once LLM Quota Protection:** Dual-engine integration safeguards prevent duplicate Gemini calls during downstream verification or network failures.
- **Evidence-Grounded Q&A:** Gemini 2.5 Pro answers questions strictly using retrieved contract clauses.
- **DeBERTa NLI Verification:** Independent cross-encoder verification (`cross-encoder/nli-deberta-v3-base`) scores entailment, contradiction, and neutrality for every generated answer.
- **Accurate Vector Similarity Scores:** Formats genuine cosine similarities (`72%`, `67%`) and preserves unscored exception clauses (`Similarity unavailable`) without fabricating 0% scores.
- **Zero-Retention Privacy:** No raw policy documents, user questions, or embeddings are permanently stored on disk. ChromaDB collections are deleted immediately after each query.
- **Extension Security Boundary:** Strict sender validation prevents web pages from invoking extension actions or draining Gemini API quotas.

---

## 3. Technology Stack

- **Chrome Extension:** Chrome Manifest V3, ES Modules, `chrome.scripting`, `chrome.storage.session`.
- **Frontend Web App:** Vanilla HTML5, CSS3 Glassmorphism design system, ES6+ JavaScript.
- **Backend API Gateway:** Node.js v22+, Express 5, Helmet, Express-Rate-Limit, Axios, Cheerio.
- **RAG & Agentic Orchestration:** LangChain.js (`@langchain/core`, `@langchain/google-genai`), LangGraph.js (`@langchain/langgraph`), Zod structured schema validation.
- **AI Microservice:** Python 3.13+, FastAPI, Uvicorn, PyTorch (CPU inference).
- **Embeddings & Vector Store:** `sentence-transformers/all-MiniLM-L6-v2` (384-dimensional dense vectors), ChromaDB (ephemeral in-memory collections).
- **NLI Verification:** `cross-encoder/nli-deberta-v3-base` (Sequence classification on CPU).
- **Generative AI Provider:** Google Gemini API (`gemini-2.5-pro` with automatic flash failover).
- **Testing:** Node.js native test runner (`node:test`), Pytest.

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
[ Web Application ] ────────► [ Node.js Express Backend ] (127.0.0.1:3000)
(app.js / index.html)              │  - Ingestion (PDF / URL / Text)
                                   │  - Deterministic Risk Engine & Readability
                                   │  - Dual-Engine Q&A Architecture:
                                   │      ├─ Engine 1: Procedural Pipeline
                                   │      └─ Engine 2: LangGraph State Machine
                                   │  - LangChain Model & Prompt Adapter
                                   │  - Ephemeral Session Manager
                                   │
                                   ▼ HTTP / REST (Internal Bridge)
                             [ Python AI Microservice ] (127.0.0.1:8000)
                               - FastAPI (Uvicorn)
                               - Sentence Transformers (all-MiniLM-L6-v2)
                               - ChromaDB Vector Store (Ephemeral Collections)
                               - DeBERTa NLI Cross-Encoder (CPU)
```

---

## 5. Project Folder Structure

```text
D:\TOS red flag scanner/
├── .env.example                     # Environment configuration template
├── package.json                     # Root orchestrator & scripts
├── scripts/
│   ├── start.js                     # Unified concurrent process manager (npm start)
│   └── test-all.js                  # Master Node.js test runner
│
├── frontend/                        # Web dashboard client
│   └── public/
│       ├── index.html               # Main dashboard UI
│       ├── app.js                   # Web application logic
│       └── styles.css               # Design system styling
│
├── backend/                         # Node.js Express API server (127.0.0.1:3000)
│   ├── server.js                    # Express application entry point
│   ├── src/
│   │   ├── ai/                      # Gemini adapter, provider factory & Python bridge
│   │   ├── analysis/                # Deterministic risk engine & readability
│   │   ├── api/                     # Controllers and routes (/api/scan, /api/analyze/qa)
│   │   ├── ingestion/               # SSRF-safe URL fetching & PDF text extraction
│   │   ├── rag/                     # LangChain & LangGraph RAG orchestration (Phase 8B)
│   │   │   ├── langchain/           # Prompts, schemas (Zod), and ChatGoogle adapter
│   │   │   └── langgraph/           # State annotation, 6 graph nodes, conditional routing
│   │   └── security/                # CORS middleware, loopback binding & SSRF validation
│   └── tests/                       # 33 Node.js test suites (506 passing tests)
│
├── ai-service/                      # Python FastAPI microservice (127.0.0.1:8000)
│   ├── app/
│   │   ├── main.py                  # FastAPI application entry point & lifespan
│   │   ├── services/
│   │   │   ├── embedding_service.py # Sentence Transformers singleton
│   │   │   ├── vector_store.py      # ChromaDB vector store service
│   │   │   └── nli_service.py       # DeBERTa-v3 NLI verification engine
│   │   └── routers/                 # Vector and NLI API endpoints
│   └── tests/                       # Pytest test suite (61 passing tests)
│
├── extension/                       # Chrome Manifest V3 Extension
│   ├── manifest.json                # MV3 extension manifest
│   ├── background/
│   │   └── service-worker.js        # Background worker & SEC-EXT-1 sender validation
│   ├── popup/
│   │   ├── popup.html               # Extension popup UI
│   │   ├── popup.js                 # Candidate registry & state management
│   │   └── popup.css                # Compact extension styling
│   ├── content/
│   │   ├── content-script.js        # On-demand legal link detection
│   │   └── dom-extractor.js         # Substantive text extraction
│   └── utils/
│       ├── detector-rules.js        # Detection heuristics & URL canonicalization
│       └── extractor-core.js        # DOM extraction validation
│
└── docs/                            # In-depth architectural & operational guides
    ├── ARCHITECTURE.md              # Complete technical architecture specification (v3.0)
    ├── ACADEMIC_ALIGNMENT.md        # Academic alignment, viva defense guide & RAG theory
    ├── INSTALLATION.md              # Step-by-step Windows setup guide
    ├── USER_GUIDE.md                # 10-step user guide with feature walkthroughs
    ├── SECURITY_AND_PRIVACY.md      # Security model, trust boundaries & limitations (v3.0)
    └── RELEASE_CHECKLIST.md         # Pre-flight release verification checklist
```

---

## 6. Prerequisites & Installation

### System Requirements
- **OS:** Windows 10/11, macOS, or Linux.
- **Node.js:** v20.0.0 or higher (v22 recommended).
- **Python:** v3.10 to v3.13 (v3.13 supported).
- **Browser:** Google Chrome (v115+ for Manifest V3).
- **Google Gemini API Key:** Required for plain-English explanations and Q&A.

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
   Copy `.env.example` to `.env` in the project root:
   ```powershell
   Copy-Item .env.example .env
   ```
   Edit `.env` and insert your Gemini API key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ENABLE_GEMINI_PROVIDER=true
   PORT=3000
   ENABLE_PYTHON_AI_SERVICE=true
   PYTHON_AI_SERVICE_URL=http://localhost:8000
   ENABLE_LANGGRAPH_QA=false # Feature flag for LangGraph Q&A engine (defaults to false)
   ```

---

## 7. Starting the Services

Launch both the Node.js backend (Port 3000) and Python AI service (Port 8000) concurrently with a single command:

```powershell
npm start
```

The unified launcher will:
- Check for port collisions on 3000 and 8000.
- Verify the Python virtual environment.
- Pre-warm the DeBERTa NLI model on CPU.
- Stream prefixed logs: `[BACKEND]` and `[PYTHON AI]`.

Web Application is available at: [http://localhost:3000](http://localhost:3000)  
Backend Health Check: [http://localhost:3000/health](http://localhost:3000/health)  
Python AI Health Check: [http://localhost:8000/health](http://localhost:8000/health)  

---

## 8. Installing the Chrome Extension

1. Open Google Chrome and navigate to: `chrome://extensions/`
2. Enable **Developer mode** via the toggle switch in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `extension` directory inside the project root:
   ```text
   D:\TOS red flag scanner\extension
   ```
5. Pin the **TOS Red Flag Scanner** icon to your Chrome toolbar.
6. Open the popup to verify backend connectivity (the status dot will turn green).

---

## 9. User Workflow Guide

1. **Navigate to Any Website:** Open any service with legal agreements (e.g., `https://www.spotify.com`).
2. **Open Extension:** Click the toolbar icon. The extension displays the active website hostname.
3. **Find Legal Documents:** Click **Find Legal Documents**. The extension detects Terms of Service, Paid Terms, Privacy Policies, Cookie Policies, and Legal Hubs.
4. **Select a Document:** Click **Select** on the desired document (e.g., *Privacy Policy*).
5. **Extract Text:** Click **Extract Selected Document**. The extension previews the extracted text, word count, character count, and heading structure.
6. **Confirm Document:** Click **Confirm Document** to enable scanning.
7. **Analyze:** Click **Analyze Document**. The extension renders the Risk Dashboard with high/medium/low severity findings and readability metrics.
8. **Interactive Q&A:** Ask questions in plain English (e.g., *"Does this company share my data with third parties?"*).
9. **Review Grounded Evidence:** Examine Gemini's answer alongside the exact cited clauses, genuine similarity scores, and DeBERTa NLI validation status (`SUPPORTED`, `CONTRADICTED`, `UNCERTAIN`).
10. **Multi-Document Switching:** Switch freely between Terms and Privacy Policies without history contamination.

---

## 10. Running Automated Tests

Run the complete Node.js test suite (506 tests across 33 suites):
```powershell
npm test
```

Run the complete Python test suite (61 tests):
```powershell
cd ai-service; ..\.venv\Scripts\python -m pytest tests/ -v; cd ..
```

**Total Test Coverage:** **567 tests passing, 0 failing, 0 skipped.**

---

## 11. Known Limitations & Current Status

- **Localhost Deployment Only:** The backend currently operates without API authentication (**SEC-BACK-1**). It is intended strictly for local execution (`localhost:3000` / `127.0.0.1:3000`). Public remote cloud exposure is not yet approved.
- **CPU Inference Speed:** Running DeBERTa NLI cross-encoder inference on CPU takes ~1.5s to 3s per multi-clause Q&A request.
- **100,000-Character Threshold:** Documents exceeding 100,000 characters require explicit user consent for partial scanning.
- **Hardcoded Extension Origin:** The Chrome extension is configured for `http://localhost:3000/*` (**SEC-EXT-2**). An extension options page for dynamic server URLs will be introduced in future updates.

---

## 12. In-Depth Documentation

For detailed architectural specifications, setup walkthroughs, and security disclosures, refer to the `docs/` directory:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Complete technical design and system data flows (v3.0).
- [docs/ACADEMIC_ALIGNMENT.md](docs/ACADEMIC_ALIGNMENT.md): Academic alignment, viva defense guide & RAG/NLI theory.
- [docs/INSTALLATION.md](docs/INSTALLATION.md): Windows-specific beginner setup and troubleshooting.
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): Complete feature manual and Q&A interpretation guide.
- [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md): Threat model, trust boundaries, and security disclosures (v3.0).
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md): Pre-flight verification checklist for local release.
