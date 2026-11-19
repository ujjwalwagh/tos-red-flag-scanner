# TOS Red Flag Scanner — Academic Alignment & Viva Defense Guide

**Project:** TOS Red Flag Scanner (PrismClause)  
**Document Version:** 1.0 (Phase 8B Release)  
**Target Audience:** Academic Examiners, Viva Defense Committees, Machine Learning Engineers, and Software Architects  

---

## Executive Abstract

Consumer legal contracts—such as Terms of Service (ToS), Paid Subscription Agreements, and Privacy Policies—are deliberately verbose, legally dense, and frequently revised. They typically exceed 5,000 to 15,000 words (40 to 100+ pages), far outstripping average consumer reading capacity and presenting significant challenges for artificial intelligence systems:
1. **Context Window & Cost Inefficiencies:** Naively ingesting complete agreements into Large Language Models (LLMs) incurs substantial latency, token costs, and attention dilution ("lost in the middle" phenomena).
2. **Hallucination & Legal Liability:** Autoregressive LLMs tend to fabricate plausible provisions or assert rights not present in the contract text.
3. **Absence of Independent Factual Verification:** LLM generation alone lacks formal mathematical or entailment guarantees.

**TOS Red Flag Scanner** addresses these limitations through an end-to-end, privacy-preserving, hybrid architecture:
- **Client Tier:** Chrome Manifest V3 extension featuring in-situ DOM extraction, isolated candidate tracking, and zero disk persistence.
- **API Gateway Tier:** Localhost-bound Node.js Express service providing deterministic risk heuristic scoring (14 risk categories) and dual-engine RAG orchestration.
- **RAG Orchestration Tier:** LangChain.js prompt templating and structured output schema parsing, governed by an isolated **LangGraph.js state machine** executing alongside the legacy procedural engine.
- **Vector Retrieval Tier:** Dense semantic clause retrieval powered by `sentence-transformers/all-MiniLM-L6-v2` and ephemeral in-memory ChromaDB vector collections.
- **Generative Synthesis Tier:** Google Gemini 2.5 Pro generating evidence-grounded answers.
- **Verification Tier:** `cross-encoder/nli-deberta-v3-base` Natural Language Inference (NLI) model operating on local CPU to calculate mathematical entailment probabilities ($P(\text{entailment}), P(\text{contradiction}), P(\text{neutral})$) between generated answers and retrieved source clauses.

---

## 1. Core Theoretical Foundations

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                   RAG Pipeline with Formal NLI Verification            │
   └────────────────────────────────────────────────────────────────────────┘
                                                                               
   User Question ───► [ Bi-Encoder Embedding ]                                 
                            │ (all-MiniLM-L6-v2)                               
                            ▼                                                  
   Contract Text ───► [ Ephemeral ChromaDB ] ──► Top-K Dense Retrieval         
                                                       │                       
                                                       ▼                       
                                             [ Evidence Expansion ]            
                                                       │                       
                                                       ▼                       
                                             [ Generative LLM ] (Gemini 2.5)   
                                                       │                       
                                                       ▼                       
                                              Generated Answer                 
                                                       │                       
                                      ┌────────────────┴───────────────┐       
                                      │ Is Answer Grounded in Evidence?│       
                                      └────────────────┬───────────────┘       
                                                       │                       
                                    YES                │             NO        
                         ┌─────────────────────────────┴─────────────┐         
                         ▼                                           ▼         
              [ Cross-Encoder NLI ]                          [ Skip NLI Step ] 
              (DeBERTa-v3-base CPU)                          (Preserve Refusal 
                         │                                    State Intact)    
                         ▼                                           │         
             { SUPPORTED / CONTRADICTED }                            │         
                         │                                           │         
                         └─────────────────────┬─────────────────────┘         
                                               ▼                               
                                    Verified JSON Response                     
```

### 1.1 What is Retrieval-Augmented Generation (RAG)?
Retrieval-Augmented Generation (RAG) is an architectural framework that optimizes the output of Large Language Models by referencing an authoritative external knowledge base outside its training data sources before generating a response. 

Instead of relying solely on the parametric memory of an LLM—which is static, prone to hallucination, and uninformed about specific user agreements—RAG decouples **knowledge retrieval** from **language synthesis**:
1. **Retrieval Phase:** Given a user query $q$, the system queries an external index $\mathcal{D}$ of segmented contract clauses $C = \{c_1, c_2, \dots, c_n\}$ to identify a subset of top-$k$ relevant clauses $K \subset C$ where $\text{similarity}(q, c_i)$ is maximized.
2. **Augmentation Phase:** The retrieved clauses $K$ are injected into a prompt template, establishing an explicit, bounded context window for the model.
3. **Generation Phase:** The model generates a response $a \sim P_{LLM}(a \mid q, K)$, instructed to synthesize an answer strictly and exclusively from $K$.

### 1.2 Why RAG for Legal Document Analysis?
In legal contract analysis, standard direct LLM prompting fails for several reasons:
- **Token Budget & Latency:** Ingesting a 700-clause Privacy Policy (e.g., Spotify, Google) on every user question consumes tens of thousands of tokens, driving up latency to 8–15 seconds and inflating API costs.
- **Attention Degradation:** Research demonstrates that LLMs suffer severe recall degradation when target information is buried in the middle of long context windows (the "Lost in the Middle" problem).
- **Auditability and Lineage:** In legal and regulatory domains, an assertion without a source citation is unacceptable. RAG guarantees that every assertion in the answer can be traced directly to specific retrieved contract clauses with genuine cosine similarity scores.
- **Strict Grounding:** Consumer contracts frequently omit specific rights (e.g., no mention of refunds or GDPR erasure). A raw LLM will often assume or fabricate statutory rights; a RAG model constrained to $K$ correctly determines that the document is silent on the matter and issues a refusal (`grounded: false`).

### 1.3 Why LangChain?
[LangChain.js](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langchain/) provides standardized abstractions for compound AI systems:
- **Prompt Templating ([`backend/src/rag/langchain/prompts.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langchain/prompts.js)):** Formalizes role separation (System Instructions vs. User Evidence vs. Human Question) with input validation, preventing prompt injection and formatting drifts.
- **Structured Output Parsing ([`backend/src/rag/langchain/schemas.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langchain/schemas.js)):** Uses Zod schemas (`qaAnswerSchema`) to enforce strict type checking on LLM outputs:
  - `grounded` (boolean)
  - `answer` (string)
  - `confidence` (float between 0 and 1)
  - `citedClauses` (array of integers)
  - `reason` (nullable string)
- **Model Adapter Abstraction ([`backend/src/rag/langchain/model.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langchain/model.js)):** Wraps `@langchain/google-genai` (`ChatGoogleGenerativeAI`), enabling seamless swapping or failover between models (e.g., `gemini-2.5-pro` to `gemini-2.5-flash`) without modifying downstream business logic.

### 1.4 Why LangGraph?
While LangChain organizes components, complex multi-step pipelines require explicit **control flow orchestration**. Standard procedural code (nested `if/else`, loops, and sequential `try/catch` blocks) becomes fragile when handling:
- Multi-step validation pipelines
- Conditional branching (e.g., skip NLI when ungrounded)
- State persistence and partial retries
- Granular step-by-step observability

**LangGraph.js** models the RAG pipeline as a **Cyclic/Acyclic Directed State Graph**:
- **State (`QaGraphAnnotation`):** A strictly typed data structure passed from node to node. Every transition represents a pure transformation over the state.
- **Nodes:** Isolated execution units with single responsibilities:
  1. `retrieve`: Vector search + evidence expansion.
  2. `format`: Construct LangChain messages and serialize evidence.
  3. `generate`: Invoke Gemini via `ChatGoogle` and parse structured JSON.
  4. `validate`: Sanity check grounding, confidence, and answer lengths.
  5. `verify`: Cross-encoder DeBERTa NLI inference.
  6. `formatOutput`: Assemble the final standardized HTTP response.
- **Conditional Routing:** Dynamic edges (e.g., `routeAfterValidation`) evaluate the current state: if `grounded === false` or `confidence < 0.2`, the graph routes directly to `formatOutput`, cleanly bypassing `verify`.

---

## 2. Component Deep-Dives

### 2.1 Google Gemini 2.5 Pro (Generative Synthesis)
- **Role:** Generates natural language explanations and synthesizes disparate legal clauses into clear answers.
- **Configuration:** Temperature is set to `0.1`–`0.2` (near-deterministic) to suppress creative hallucinations and prioritize verbatim semantic alignment.
- **Structured JSON Mode:** Configured via LangChain's `withStructuredOutput` or system prompt schema injection, requiring the model to return typed JSON conforming to `qaAnswerSchema`.
- **System Safeguards:** The prompt explicitly instructs:
  > *"If the provided evidence does not contain sufficient information to answer the question, set grounded to false, explain the silence in reason, and do not assume terms outside the text."*

### 2.2 DeBERTa-v3 NLI Cross-Encoder (Factual Verification)
- **Model:** `cross-encoder/nli-deberta-v3-base` (DeBERTa: Decoding-enhanced BERT with Disentangled Attention).
- **Bi-Encoder vs. Cross-Encoder:**
  - *Bi-Encoder (Retrieval):* Encodes the query and document independently into fixed 384-dimensional vectors: $\vec{u} = f(q)$, $\vec{v} = f(c)$. Fast ($O(1)$ cosine comparison), ideal for indexing and searching 1,000 clauses.
  - *Cross-Encoder (NLI):* Feeds the concatenation `[CLS] Premise [SEP] Hypothesis [EOS]` simultaneously into all self-attention layers. Cross-attention allows every word in the generated answer to attend to every word in the source clause. Computationally intensive, but delivers unmatched factual verification accuracy.
- **Classification Output:** Produces 3 logits normalized via Softmax into probabilities:
  $$\text{Softmax}([z_{\text{entail}}, z_{\text{neutral}}, z_{\text{contradict}}])$$
  - **Entailment ($P \ge 0.60$):** The generated answer is logically supported and necessitated by the premise clauses $\rightarrow$ `SUPPORTED`.
  - **Contradiction ($P > 0.40$):** The generated answer makes an assertion directly refuting the premise clauses $\rightarrow$ `CONTRADICTED`.
  - **Neutral:** The premise neither confirms nor refutes the hypothesis $\rightarrow$ `UNCERTAIN`.

### 2.3 ChromaDB & Dense Vector Retrieval
- **Embedding Model:** `sentence-transformers/all-MiniLM-L6-v2` generating 384-dimensional unit-normalized embeddings.
- **Similarity Metric:** Cosine similarity computed via inner product of normalized vectors:
  $$\text{CosineSimilarity}(\vec{u}, \vec{v}) = \frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\| \|\vec{v}\|} = \sum_{i=1}^{384} u_i v_i$$
- **Storage Lifecycle:** Managed via `chromadb.EphemeralClient`. Vectors reside in Python process memory and are completely destroyed when the collection is deleted in `finally` blocks, upholding the Zero-Retention security policy.
- **Evidence Expansion:** When a clause $c_i$ is retrieved as top-$k$, the retrieval engine also extracts adjacent boundary clauses ($c_{i-1}, c_{i+1}$) to provide complete contextual framing for provisions spanning multiple sentences.

---

## 3. Architectural Comparison: Procedural vs. LangGraph

| Dimension | Legacy Procedural Engine | LangGraph State Machine |
| :--- | :--- | :--- |
| **Control Flow** | Sequential imperative JavaScript with manual branch conditions. | Formal StateGraph with declarative Nodes and Conditional Edges. |
| **State Management** | Distributed mutable local variables passed across function arguments. | Centralized, immutable, strictly typed `QaGraphAnnotation`. |
| **Modularity & Isolation**| Functions tightly coupled to controller lifecycle; partial mocks needed. | Each node is an isolated, testable pure function receiving state and returning state delta. |
| **Routing Logic** | Hardcoded nested `if/else` checks inside the controller execution loop. | Explicit conditional edge functions (`routeAfterValidation`) cleanly separating routing from execution. |
| **Observability** | Ad-hoc `console.log` statements and logger calls. | Native LangChain/LangGraph trace events per node execution. |
| **Error Containment** | Broad `try/catch` wrapping entire controller; failures cause full fallback. | Node-level error boundaries; downstream post-Gemini failures recover partial answers without duplicate LLM calls. |
| **Extensibility** | Adding human-in-the-loop, multi-query expansion, or cyclic re-ranking requires rewiring procedural logic. | New nodes can be spliced into the graph with single edge updates. |

---

## 4. Top 10 Viva & Project Defense Questions & Answers

### Q1: What is RAG, and why is it necessary for Terms of Service analysis instead of feeding the entire contract directly to an LLM?
> **Answer:**  
> RAG (Retrieval-Augmented Generation) couples an external semantic search index with an LLM. For Terms of Service analysis, RAG is necessary because:
> 1. **Context Window Limitations & Cost:** Legal policies easily exceed 1,000 clauses (50,000+ words). Sending this entire context for every single question is financially prohibitive and results in high latency.
> 2. **Attention Degradation ("Lost in the Middle"):** LLMs frequently fail to extract critical details buried in lengthy mid-sections of 50-page agreements.
> 3. **Hallucination Prevention:** By constraining the context to the top-5 retrieved clauses and adjacent context, Gemini is forced to synthesize its answer solely from actual contract provisions, drastically mitigating fabricated clauses.
> 4. **Verifiable Auditability:** RAG yields explicit clause indices and cosine similarity scores, providing users with exact citations for every answer.

---

### Q2: Why did you use both a Bi-Encoder (`all-MiniLM-L6-v2`) and a Cross-Encoder (`nli-deberta-v3-base`)? What is the trade-off?
> **Answer:**  
> This two-tier design balances computational throughput with semantic verification precision:
> - **Bi-Encoder (`all-MiniLM-L6-v2`):** Computes embeddings for the query and all 1,000 clauses independently in advance ($O(N)$). Vector comparison is an instantaneous dot product ($O(1)$). This makes it ideal for indexing and retrieving candidate clauses in milliseconds. However, bi-encoders cannot capture fine-grained token-to-token cross-interactions between the question and the text.
> - **Cross-Encoder (`nli-deberta-v3-base`):** Processes the concatenated premise and hypothesis simultaneously through all self-attention layers ($O(L^2)$ complexity). While too slow to evaluate against all 1,000 clauses, it is exceptionally accurate. We apply it selectively to the single generated answer and retrieved evidence (a 1-to-1 comparison), achieving rigorous factual verification on a standard CPU in 1.5–3 seconds.

---

### Q3: What is Natural Language Inference (NLI), and why is it used as a post-generation verification step?
> **Answer:**  
> Natural Language Inference (NLI) is the NLP task of determining whether a Hypothesis logically follows from a Premise. It classifies relationships into three categories: **Entailment**, **Contradiction**, or **Neutral**.
> 
> In our project, NLI serves as an **adversarial, objective guardrail** against LLM hallucinations. While Gemini generates the answer, it is still an autoregressive model that might slip in ungrounded assumptions. By treating the retrieved contract clauses as the *Premise* and Gemini's generated answer as the *Hypothesis*, our local DeBERTa model independently verifies mathematical entailment:
> - If $P(\text{entailment}) \ge 0.60$, the answer is confirmed `SUPPORTED`.
> - If $P(\text{contradiction}) > 0.40$, the answer is flagged `CONTRADICTED`, alerting the user that the LLM may have misstated their legal rights.

---

### Q4: Why did you integrate LangGraph when the existing procedural controller was already working?
> **Answer:**  
> The procedural controller worked well for a linear pipeline, but suffered from architectural limitations:
> 1. **Monolithic Control Flow:** Data retrieval, formatting, generation, validation, and NLI verification were tightly intertwined, making partial retries or alternative flows messy.
> 2. **State Mutability:** State variables were passed through multiple functional layers, obscuring data lineage.
> 3. **Non-Trivial Routing:** Conditional execution (such as skipping NLI on ungrounded answers or handling fallback paths) required nested conditionals that are hard to audit.
> 
> LangGraph elevates the pipeline into an explicit **State Machine**. Each step is an isolated node that receives a strongly-typed state (`QaGraphAnnotation`) and returns only its state updates. Edges define deterministic routing. This architecture makes the system modular, testable, visually observable, and readily extensible to multi-agent loops or re-ranking nodes in future phases.

---

### Q5: How does LangGraph manage state, and how do you ensure zero-retention / ephemeral privacy during graph execution?
> **Answer:**  
> In [`backend/src/rag/langgraph/state.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/rag/langgraph/state.js), state is declared via `Annotation.Root({ ... })` containing strictly typed fields (`documentId`, `clauses`, `question`, `retrievedClauses`, `geminiResponse`, `nliResult`, etc.).
> 
> To guarantee **zero-retention privacy**:
> 1. **No Checkpointer:** We intentionally compile the graph without persistent checkpointers (e.g., no `MemorySaver` or database checkpointer). The state instance exists in volatile Node.js RAM only for the lifespan of the `graph.invoke()` promise.
> 2. **Garbage Collection:** Once the HTTP response is dispatched to the client, the state object is dereferenced and reclaimed by the V8 garbage collector.
> 3. **Audit Redaction:** The centralized logger logs only high-level metadata (UUID, word counts, NLI status), never raw question text or legal clauses.

---

### Q6: Explain how your system handles "Out-of-Scope" or unanswerable questions without hallucinating.
> **Answer:**  
> When a user asks a question whose subject matter is absent from the contract (e.g., *"What is the policy on refunds?"* in a Terms of Service that mentions no refund policy, or an irrelevant question like *"What is the capital of France?"*):
> 1. **Retrieval Phase:** Dense vector search retrieves clauses with low cosine similarities (or semantically distant clauses).
> 2. **Prompt Instruction:** Gemini is explicitly instructed: *"If the provided evidence does not contain the answer, set grounded to false and provide a refusal explanation in reason."*
> 3. **Model Output:** Gemini returns `{ "grounded": false, "answer": "The agreement does not contain provisions regarding refunds...", "reason": "No relevant clauses found" }`.
> 4. **Validation Node:** Detects `grounded === false` and sets `available: false`.
> 5. **Conditional Edge:** Immediately routes to `formatOutput`, bypassing DeBERTa NLI. The UI displays an ungrounded refusal notice without fabricating answers.

---

### Q7: Why do you skip DeBERTa NLI verification when `grounded: false`? What invariant does this protect?
> **Answer:**  
> When Gemini correctly refuses to answer because information is absent from the contract, its answer typically states: *"The provided text does not contain any information regarding X."*
> 
> If we passed this refusal statement as a *Hypothesis* to DeBERTa against the retrieved clauses (the *Premise*), DeBERTa would evaluate whether the clauses *entail* that the contract doesn't mention X. Because the retrieved clauses discuss other topics (or the topic is missing entirely), DeBERTa would classify the relationship as **Neutral** or **Contradiction**.
> 
> Mislabeling a valid, honest refusal as `CONTRADICTED` or `UNCERTAIN` would degrade user trust and corrupt accuracy metrics. Skipping NLI on ungrounded responses preserves the refusal state intact and prevents false-alarm contradiction flags.

---

### Q8: How do you prevent the dual-engine architecture from calling Gemini twice and consuming double the API quota?
> **Answer:**  
> In [`backend/src/api/qaDocumentController.js`](file:///d:/TOS%20red%20flag%20scanner/backend/src/api/qaDocumentController.js), the function `executeLangGraphQa` implements an **At-Most-Once Call Boundary**:
> 1. It maintains a closure variable `geminiCalled = false` and stores `geminiResult`.
> 2. Inside the LangGraph state machine, the `generate` node sets `state.geminiCalled = true`.
> 3. If an error occurs in a downstream node *after* Gemini has successfully responded (e.g., a timeout or network glitch during Python NLI verification in the `verify` node), the catch block inspects `geminiCalled`.
> 4. If `geminiCalled` is true, the catch block **does NOT fall back to the procedural engine** (which would execute a second Gemini API call). Instead, it recovers `geminiResult`, formats the answer gracefully with NLI marked as `SKIPPED`, and returns the response. Procedural fallback is only triggered if LangGraph failed *prior* to Gemini invocation.

---

### Q9: How does your vector search scale to 1,000+ clauses, and how do you handle vector store cleanup?
> **Answer:**  
> Large legal documents (such as Spotify's 642-clause policy) can overwhelm ChromaDB if indexed in a single synchronous payload:
> 1. **Batch Chunking:** In [`ai-service/app/services/vector_store.py`](file:///d:/TOS%20red%20flag%20scanner/ai-service/app/services/vector_store.py), clauses are ingested in sequential batches of 100 clauses.
> 2. **Atomic Rollback:** If any batch fails mid-indexing, the partial collection is immediately dropped, preventing corrupted vector states.
> 3. **Deterministic ID Hashing:** Document collections use unique UUID-derived names (`qa_<uuid>`).
> 4. **Guaranteed Ephemeral Cleanup:** In Node.js, `withDocumentVectors()` wraps all RAG operations in an unconditional `try...finally` block. Regardless of whether the query succeeds, times out, or throws an unhandled exception, `finally` invokes `DELETE /ai/vectors/{id}`, immediately purging the collection from memory.

---

### Q10: How does the Chrome extension ensure security and document isolation between Terms of Service and Privacy Policies?
> **Answer:**  
> 1. **Message Sender Validation (SEC-EXT-1):** In `service-worker.js`, every incoming message must have `sender.id === chrome.runtime.id` and origin matching `chrome-extension://`. Any unauthorized webpage attempting to trigger scans or access API keys is rejected with HTTP 403.
> 2. **Tab Context Restriction:** Content scripts running in web pages are forbidden from calling `ASK_POLICY_QUESTION` or `ANALYZE_CONFIRMED_POLICY`. Only the extension popup UI can initiate these operations.
> 3. **Candidate Registry & Multi-Document Isolation:** The extension popup maintains isolated candidate objects keyed by document type (`terms`, `privacy`, `subscription`). Switching from Terms to Privacy Policy swaps the active candidate pointer. Cached risk findings, extracted text chunks, and Q&A conversation histories are stored in separate namespaces within `chrome.storage.session`, guaranteeing zero cross-document contamination.

---

## 5. Real Project Walkthrough Examples

### Example 1: Grounding Validation & Semantic Synthesis
* **Document:** GitHub Terms of Service
* **Question:** *"Can I get a refund if I cancel my paid account?"*
* **Retrieved Clauses:**
  - Clause 54: *"You are responsible for properly canceling your account..."*
  - Clause 56: *"You will not be charged again after your cancellation takes effect."*
  - Clause 58: *"There will be no refunds or credits for partial months of service, upgrade/downgrade refunds, or refunds for months unused with an open account."*
* **LangChain Synthesis:**
  ```json
  {
    "grounded": true,
    "answer": "No. GitHub clearly states that there will be no refunds or credits for partial months of service, upgrade or downgrade refunds, or refunds for unused months with an active account.",
    "confidence": 0.95,
    "citedClauses": [58]
  }
  ```
* **DeBERTa NLI Verification:**
  - Premise: Clause 58 verbatim text.
  - Hypothesis: Gemini's synthesized answer.
  - Entailment Logit: $P(\text{entailment}) = 0.982$ $\rightarrow$ Status: `SUPPORTED`.

---

### Example 2: Out-of-Scope Refusal Handling
* **Document:** Spotify Privacy Policy
* **Question:** *"What is the company's policy on cryptocurrency payments?"*
* **Retrieved Clauses:** Clauses discussing payment processors, billing cycles, and tax compliance (similarity scores $< 0.45$).
* **LangChain Synthesis:**
  ```json
  {
    "grounded": false,
    "answer": "The provided Spotify Privacy Policy does not contain any terms or policies regarding cryptocurrency payments.",
    "confidence": 0.0,
    "citedClauses": [],
    "reason": "Cryptocurrency payment methods are not addressed in the document text."
  }
  ```
* **LangGraph Execution Path:**
  - `validate` node reads `grounded === false`.
  - Conditional edge `routeAfterValidation` detects ungrounded status.
  - **DeBERTa NLI is bypassed**, avoiding a false contradiction classification.
  - Final response returns `available: false` with the exact explanation.

---

### Example 3: Multi-Clause Synthesis & Evidence Expansion
* **Document:** Consumer SaaS Subscription Agreement
* **Question:** *"How does arbitration work, and can I join a class action?"*
* **Retrieval & Expansion:**
  - Clause 102 retrieved as top candidate (Binding Arbitration).
  - Evidence expansion pulls Clause 101 (Informal Dispute Resolution) and Clause 103 (Class Action Waiver).
* **LangChain Synthesis:**
  - Synthesizes all three clauses into a coherent 2-part summary: (1) mandatory 30-day informal negotiation, (2) individual binding arbitration under AAA rules, and (3) explicit waiver of class action participation.
* **DeBERTa NLI Verification:**
  - Evaluates synthesis against concatenated premises $[c_{101}, c_{102}, c_{103}]$.
  - Result: $P(\text{entailment}) = 0.891$ $\rightarrow$ Status: `SUPPORTED`.

---

### Example 4: Invariant Refusal Preservation (No False Contradictions)
* **Document:** Generic Terms of Service
* **Question:** *"What is the warranty period for hardware defects?"*
* **Context:** Pure software SaaS agreement with no hardware provisions.
* **Pipeline Behavior:**
  - Top retrieved clauses: General "AS IS" software disclaimer (Clause 42).
  - Gemini outputs `grounded: false`.
  - Invariant Guard: `verifyNli` check `if (!grounded) return { skipped: true, reason: 'unverified_ungrounded' }`.
  - **Outcome:** System returns clean refusal. Zero false-alarm contradiction penalties. User experience remains transparent and trustworthy.

---

## 6. Summary for Examination Boards

TOS Red Flag Scanner bridges modern AI theory with practical software engineering:
1. **Academic Rigor:** Combines statistical NLP (DeBERTa cross-encoder sequence classification), dense vector embeddings (Sentence Transformers), and state-of-the-art generative LLMs (Gemini 2.5).
2. **Architectural Maturity:** Deploys a fault-tolerant **dual-engine architecture** with formal LangGraph state machine orchestration, bounded retries, and atomic rollback.
3. **Consumer Privacy & Ethics:** Implements zero permanent storage, ephemeral vector lifecycles, and strict Chrome extension trust boundaries.
