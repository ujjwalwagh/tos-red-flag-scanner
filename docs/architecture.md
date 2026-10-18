# PrismClause (TOS Red Flag Scanner) — System Architecture

## 1. Architectural Philosophy & Evolution

PrismClause implements a **hybrid Node.js/Express + Python/FastAPI architecture** with an in-memory **zero-retention privacy runtime**. It balances deterministic rule execution with modern deep learning representations and generative language model explanations.

### Architectural Evolution Note
The original academic proposal envisioned a monolithic Python/FastAPI backend with a persistent SQLite database. During development, the platform evolved into a production-grade decoupled hybrid architecture:
1. **Node.js / Express 5 Gateway**: Serves static assets, manages client sessions, executes high-throughput deterministic legal rules, enforces SSRF/CSP security, and orchestrates multi-vendor business logic.
2. **Python / FastAPI AI Microservice**: Hosts compute-intensive NLP workloads, computing dense sentence embeddings (`all-MiniLM-L6-v2`) and managing **ChromaDB** vector similarity indexes.
3. **Zero-Retention Ephemeral Storage**: Rather than storing user contracts in a persistent SQLite database, all document vectors and clause caches are generated on-the-fly and destroyed in memory immediately upon request completion. This guarantees absolute privacy and data sovereignty.

---

## 2. Conceptual System Topology

```text
User / Browser Client (http://localhost:3000)
    │
    │  Static HTML5 / Vanilla CSS / ES6+ JS
    ▼
Frontend (`frontend/public/`)
    │
    │  HTTP REST Requests (JSON / Multi-part PDF Upload)
    ▼
Node.js / Express 5 API Gateway (`backend/`)
  ├── Ingestion, Normalization (NFKC) & Clause Segmentation
  ├── Deterministic Rule Engine (14 Canonical Legal Categories)
  ├── Personalized Risk Ranker (Multiplicative User Concern Weights)
  ├── Redline Diff Engine & Statutory Compliance Auditor
  └── Resilient AI Client Bridge (HTTP / Circuit Breaker)
        │
        ├───────────────────────────────────────┐
        ▼                                       ▼
Python / FastAPI AI Service (`ai-service/`)        Google Gemini (`gemini-2.5-pro`)
  ├── Sentence-Transformers (all-MiniLM-L6-v2)    ├── Evidence-Grounded Clause Explanations
  ├── ChromaDB (Ephemeral In-Memory Client)       └── Bounded, Prompt-Shielded Q&A
  └── Semantic Vector Indexing & Querying
        │                                       ▲
        └──────────── Retrieved Evidence ───────┘
```

---

## 3. Component Responsibilities

### 3.1 Node.js / Express Gateway (`backend/`)
- **API Gateway & Routing**: Exposes canonical endpoints under `/api/documents`, `/api/analyze`, `/api/remediation`, `/api/negotiation`, `/api/portfolio`, `/api/sentinel`, and `/api/compliance`.
- **Request Orchestration**: Manages document processing pipelines, error handling via `AppError`, and security middleware (Helmet CSP, rate limiting, SSRF IP blocking).
- **Deterministic Legal Analysis**: Executes regex-based clause matching against 14 risk categories, computing base severity and structural metadata.
- **Personalized Risk Ranking**: Evaluates dynamic user concern weights ($1\dots5$) to compute personalized attention scores, impact magnitudes, and transparent reasoning.
- **Resilient AI Bridge (`aiClient`)**: Manages communication with the Python microservice using timeouts, circuit breaker cooldowns, and seamless fallback to lexical matching when offline.

### 3.2 Python / FastAPI AI Microservice (`ai-service/`)
- **Dense Embedding Generation (`EmbeddingService`)**: Loads `sentence-transformers/all-MiniLM-L6-v2` to transform clauses and queries into normalized 384-dimensional vector embeddings.
- **Vector Indexing & Similarity Search (`VectorStoreService`)**: Dynamically indexes clause vectors in document-scoped collections, calculating cosine similarity to surface top-$K$ evidentiary clauses.
- **Microservice Endpoints**: Exposes `/health`, `/ai/embed`, `/ai/vectors/index`, `/ai/vectors/query`, and `/ai/vectors/{document_id}` with strict Pydantic v2 schemas.

### 3.3 ChromaDB Ephemeral Vector Store
- **Ephemeral Vector Engine**: Instantiates `chromadb.EphemeralClient()`, isolating vector graphs strictly in system RAM without writing to disk.
- **Session-Scoped Document Isolation**: Vector collections are partitioned by unique document/session IDs (`doc_<id>`).
- **Guaranteed Cleanup**: Node.js orchestrates vector sessions through `withDocumentVectors()`, which executes collection deletion in an unconditional `finally` block to prevent lingering data.

### 3.4 Generative AI Explanation Layer (`GeminiProvider`)
- **Evidence-Grounded Synthesis**: Prompts Google Gemini (`gemini-2.5-pro`) using structured system instructions that forbid hallucinations and enforce grounding in retrieved ToS clauses.
- **Interactive Q&A (`POST /api/analyze/qa`)**: Accepts user questions, injects top-4 retrieved ToS evidence clauses within strict delimiters, and returns strict JSON responses indicating answer, grounded status, confidence, and clause citations.

---

## 4. Canonical Module Map

| Domain Capability | Canonical Module Path | Purpose |
| :--- | :--- | :--- |
| **API Gateway Server** | `backend/server.js` | Express 5 application setup, static serving, and security middleware. |
| **Central Pipeline** | `backend/src/architecture/pipeline/analysis-pipeline.js` | Orchestrates multi-stage ingestion, segmentation, rule analysis, AI merging, and compliance. |
| **Python AI Bridge** | `backend/src/ai/ai-client.js` | Resilient HTTP bridge with circuit breaker and fallback mechanisms. |
| **AI Service Orchestrator** | `backend/src/ai/ai-service.js` | Merges rule findings and semantic AI findings; coordinates vector indexing. |
| **Gemini Provider** | `backend/src/ai/providers/gemini-provider.js` | Google Gemini API adapter configured for `gemini-2.5-pro` and strict JSON schemas. |
| **Provider Factory** | `backend/src/ai/provider-factory.js` | Resolves active provider (Gemini, NVIDIA NIM, or NullProvider fallback). |
| **FastAPI Microservice** | `ai-service/app/main.py` | FastAPI application exposing health, embedding, and vector routes. |
| **Embedding Engine** | `ai-service/app/services/embedding_service.py` | Sentence-Transformers (`all-MiniLM-L6-v2`) embedding singleton. |
| **Vector Store Service** | `ai-service/app/services/vector_store.py` | ChromaDB in-memory ephemeral collection management and semantic retrieval. |
| **Clause Comparator** | `backend/src/analysis/semantic/clause-comparator.js` | Semantic version change detection, entity extraction, magnitude & risk delta evaluation. |
| **Personalized Ranker** | `backend/src/analysis/personalized-ranker.js` | Multiplicative user concern weighting and Top-K personalized ranking. |
| **Evaluation Framework** | `backend/src/evaluation/` | Automated Precision@5, Recall@5, and Change Impact Macro-F1 evaluators. |
| **PDF Extraction** | `backend/src/parsers/pdf-parser.js` | Validates `%PDF-` magic bytes and extracts text page-by-page. |
| **Text Normalization** | `backend/src/parsers/text-cleaner.js` | Unicode NFKC normalization, whitespace standardisation, and quote cleanup. |
| **Clause Segmentation** | `backend/src/parsers/clause-segmenter.js` | Splits legal documents into clause-level units based on numbering and structure. |
| **Remediation Toolkit** | `backend/src/remediation/optout-generator.js` | Generates formal opt-out notices (Arbitration, Data Sharing, Auto-Renewal). |
| **Negotiation Engine** | `backend/src/negotiation/` | Word-level redline differ and amendment rider generation. |
| **Portfolio Analytics** | `backend/src/portfolio/` | Multi-vendor contract exposure evaluation and comparative vendor matrix. |
| **Sentinel Drift** | `backend/src/sentinel/` | Longitudinal policy change tracking and temporal snapshot management. |
| **Statutory Auditor** | `backend/src/compliance/` | Evaluates enforceability under EU GDPR, CCPA/CPRA, UK CRA, and US Federal regimes. |
| **Security & SSRF** | `backend/src/security/url-validator.js` | DNS-level private IP blocking and URL sanitization. |

---

## 5. End-to-End Analysis & Q&A Workflow

### 5.1 Document Analysis Workflow
1. **Ingestion & Normalization**: The document (PDF or text) is validated, sanitized, and normalized via Unicode NFKC.
2. **Clause Segmentation**: The document is partitioned into logical clauses with page number annotations.
3. **Deterministic Pass**: Rule engine flags clauses across 14 legal categories.
4. **Semantic Pass**: When enabled, the Python microservice indexes clauses in ChromaDB and Gemini enriches findings.
5. **Personalized Ranking**: The ranker multiplies clause weights by user concern settings ($1\dots5$) to produce a customized attention hierarchy.
6. **Statutory Audit**: Findings are checked against statutory unenforceability rules.

### 5.2 Interactive Q&A Workflow
1. **User Query**: User submits a question (3–500 characters) via `#qa-form`.
2. **Ephemeral Vector Indexing**: Document clauses (up to 250) are indexed in an ephemeral ChromaDB collection (`qa_<uuid>`).
3. **Semantic Search**: The question embedding is queried against ChromaDB to extract the Top-4 most similar clauses.
4. **Prompt Delimitation & Shielding**: Untrusted user question text is wrapped in strict delimiters and passed with retrieved clauses to `gemini-2.5-pro`.
5. **Strict JSON Generation**: Gemini synthesizes an evidence-grounded answer, returning confidence score and citation IDs.
6. **Zero-Retention Destruction**: The ChromaDB collection is unconditionally deleted in the `finally` block.
7. **Client Rendering**: The answer card displays the grounded status badge, confidence percentage, and supporting quote snippets.
