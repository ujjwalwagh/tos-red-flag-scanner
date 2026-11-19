/**
 * Python AI Service Client & Bridge for TOS Red Flag Scanner (Phase 9.3).
 *
 * Provides a resilient, decoupled communication bridge between the Node.js
 * backend and the Python/FastAPI microservice (ai-service).
 *
 * Capabilities:
 * - Health check probe: GET /health
 * - Dense embedding generation: POST /ai/embed
 * - Vector store indexing: POST /ai/vectors/index
 * - Semantic vector query: POST /ai/vectors/query
 * - Document vector cleanup: DELETE /ai/vectors/{document_id}
 * - Zero-retention session runner: withDocumentVectors(documentId, clauses, fn)
 * - Cosine similarity and semantic clause comparison helpers
 *
 * Resilience & Safety Invariants:
 * - Non-fatal: Failures, timeouts, or 500s from Python never crash Node.
 * - Circuit breaker: Cooldown window prevents waiting on repeated timeouts.
 * - Zero-retention: withDocumentVectors guarantees cleanup in finally block.
 * - Backward compatible: Falls back to deterministic lexical metrics when Python is down.
 */

import { config } from "../config/env.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_NLI_TIMEOUT_MS = 15000;
const DEFAULT_BASE_URL = "http://localhost:8000";
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10000; // 10 seconds

export class PythonAiClient {
  /**
   * Helper to parse and validate timeout integers safely.
   * @param {any} val
   * @param {number} fallback
   * @returns {number}
   */
  static parseTimeout(val, fallback) {
    if (val === undefined || val === null || String(val).trim() === "") return fallback;
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
  }

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl]      - Python service base URL
   * @param {number} [options.timeoutMs]    - Request timeout in milliseconds (embeddings/vectors)
   * @param {number} [options.nliTimeoutMs] - Dedicated timeout for NLI validation
   * @param {boolean} [options.enabled]     - Feature flag to toggle Python AI calls
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || config?.pythonAi?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = PythonAiClient.parseTimeout(
      options.timeoutMs ?? config?.pythonAi?.timeoutMs,
      DEFAULT_TIMEOUT_MS
    );
    this.nliTimeoutMs = PythonAiClient.parseTimeout(
      options.nliTimeoutMs ?? config?.pythonAi?.nliTimeoutMs,
      DEFAULT_NLI_TIMEOUT_MS
    );
    this.enabled = options.enabled !== undefined
      ? Boolean(options.enabled)
      : (config?.pythonAi?.enabled !== undefined ? Boolean(config.pythonAi.enabled) : true);
    this.internalToken = (
      options.internalToken !== undefined
        ? options.internalToken
        : (config?.pythonAi?.internalToken || "")
    )?.trim() || "";

    // Circuit breaker state
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    this.lastChecked = null;
  }

  /**
   * Node.js custom inspection hook preventing raw internalToken leakage in console/debug logs.
   */
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      baseUrl: this.baseUrl,
      enabled: this.enabled,
      timeoutMs: this.timeoutMs,
      nliTimeoutMs: this.nliTimeoutMs,
      hasInternalToken: Boolean(this.internalToken),
      circuitClosed: this.isCircuitClosed(),
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Returns a sanitized view of client settings with raw token redacted.
   * @returns {Object}
   */
  getSanitizedConfig() {
    return {
      baseUrl: this.baseUrl,
      enabled: this.enabled,
      timeoutMs: this.timeoutMs,
      nliTimeoutMs: this.nliTimeoutMs,
      hasInternalToken: Boolean(this.internalToken),
      circuitClosed: this.isCircuitClosed()
    };
  }

  /**
   * Checks if the client is enabled and circuit breaker is open.
   * @returns {boolean}
   */
  isCircuitClosed() {
    if (!this.enabled) return false;
    if (this.cooldownUntil > Date.now()) return false;
    return true;
  }

  /**
   * Records a successful communication to reset the circuit breaker.
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    this.lastChecked = Date.now();
  }

  /**
   * Records a failure to trip the circuit breaker after threshold.
   * @param {Error|string} error
   */
  recordFailure(error) {
    this.consecutiveFailures += 1;
    this.lastChecked = Date.now();
    if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.cooldownUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }

  /**
   * Internal HTTP request helper with timeout, token injection, and error handling.
   * @private
   */
  async _request(path, method = "GET", body = null, timeoutMs = null, customHeaders = null) {
    if (!this.isCircuitClosed()) {
      return {
        success: false,
        available: false,
        error: !this.enabled
          ? "python_ai_service_disabled"
          : "python_ai_service_circuit_open"
      };
    }

    const url = `${this.baseUrl}${path}`;
    const headers = { "Content-Type": "application/json" };

    // Attach server-side internal service token to protected routes (Phase 8C.3E)
    const isPublicPath = path === "/health" || path === "/health/";
    if (!isPublicPath && this.internalToken && typeof this.internalToken === "string" && this.internalToken.trim() !== "") {
      headers["X-Internal-Token"] = this.internalToken.trim();
    }
    if (customHeaders && typeof customHeaders === "object") {
      Object.assign(headers, customHeaders);
    }

    const effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : this.timeoutMs;
    const options = {
      method,
      headers,
      signal: AbortSignal.timeout(effectiveTimeout)
    };

    if (body !== null && method !== "GET" && method !== "HEAD") {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const isJson = (response.headers.get("content-type") || "").includes("application/json");
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorDetail = typeof data === "object" && data?.detail ? data.detail : `HTTP_${response.status}`;
        this.recordFailure(errorDetail);
        return {
          success: false,
          available: false,
          status: response.status,
          error: String(errorDetail)
        };
      }

      this.recordSuccess();
      return {
        success: true,
        available: true,
        status: response.status,
        data
      };
    } catch (err) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const errorMsg = isTimeout ? "request_timeout" : (err?.message || "connection_failed");
      this.recordFailure(errorMsg);
      return {
        success: false,
        available: false,
        error: errorMsg,
        isTimeout
      };
    }
  }

  /**
   * Probes the Python AI service health.
   * GET /health
   * @returns {Promise<{ available: boolean, status?: string, error?: string, latencyMs?: number }>}
   */
  async checkHealth() {
    const t0 = Date.now();
    const res = await this._request("/health", "GET");
    const latencyMs = Date.now() - t0;

    if (res.success && res.data?.status === "ok") {
      return {
        available: true,
        status: "ok",
        latencyMs
      };
    }

    return {
      available: false,
      status: "unavailable",
      error: res.error || "health_check_failed",
      latencyMs
    };
  }

  /**
   * Generates a 384-dimensional dense vector embedding for a single text.
   * POST /ai/embed
   * @param {string} text
   * @returns {Promise<{ success: boolean, embedding?: number[], dimension?: number, error?: string }>}
   */
  async embedText(text) {
    if (typeof text !== "string" || !text.trim()) {
      return { success: false, error: "Input text must be a non-empty string." };
    }

    const res = await this._request("/ai/embed", "POST", { text: text.trim() });
    if (res.success && Array.isArray(res.data?.embedding)) {
      return {
        success: true,
        embedding: res.data.embedding,
        dimension: res.data.dimension || res.data.embedding.length
      };
    }

    return {
      success: false,
      error: res.error || "failed_to_generate_embedding",
      status: res.status,
      isTimeout: Boolean(res.isTimeout)
    };
  }

  /**
   * Generates 384-dimensional dense embeddings for a batch of strings.
   * POST /ai/embed
   * @param {Array<string>} texts
   * @returns {Promise<{ success: boolean, embeddings?: number[][], dimension?: number, count?: number, error?: string, isTimeout?: boolean }>}
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return { success: false, error: "Input texts must be a non-empty array of strings." };
    }

    const cleaned = texts.map((t) => (typeof t === "string" ? t.trim() : ""));
    if (cleaned.some((t) => !t)) {
      return { success: false, error: "Batch items must be non-empty strings." };
    }

    const res = await this._request("/ai/embed", "POST", { texts: cleaned });
    if (res.success && Array.isArray(res.data?.embeddings)) {
      return {
        success: true,
        embeddings: res.data.embeddings,
        dimension: res.data.dimension || 384,
        count: res.data.count || res.data.embeddings.length
      };
    }

    return {
      success: false,
      error: res.error || "failed_to_generate_batch_embeddings",
      status: res.status,
      isTimeout: Boolean(res.isTimeout)
    };
  }

  /**
   * Indexes a batch of clauses into a document-scoped vector collection.
   * POST /ai/vectors/index
   * @param {string} documentId
   * @param {Array<{ clause_id: string, text: string, category?: string, section?: string }>} clauses
   * @returns {Promise<{ success: boolean, documentId?: string, indexedCount?: number, error?: string, isTimeout?: boolean }>}
   */
  async indexClauses(documentId, clauses) {
    if (typeof documentId !== "string" || !documentId.trim()) {
      return { success: false, error: "documentId must be a non-empty string." };
    }
    if (!Array.isArray(clauses) || clauses.length === 0) {
      return { success: false, error: "clauses must be a non-empty array." };
    }
    if (clauses.length > 1000) {
      return {
        success: false,
        error: "Document clause count exceeds the maximum limit of 1,000 clauses for Q&A analysis."
      };
    }

    const docId = documentId.trim();
    const formattedClauses = clauses.map((c, idx) => ({
      clause_id: String(c.clause_id || c.clauseId || `c_${idx}`).trim(),
      text: String(c.text || c.rawText || "").trim(),
      category: String(c.category || c.categoryId || "general").trim(),
      section: String(c.section || c.title || "").trim()
    }));

    const CHUNK_SIZE = 400;
    let totalIndexed = 0;

    for (let i = 0; i < formattedClauses.length; i += CHUNK_SIZE) {
      const chunk = formattedClauses.slice(i, i + CHUNK_SIZE);
      const payload = {
        document_id: docId,
        clauses: chunk
      };

      const res = await this._request("/ai/vectors/index", "POST", payload);
      if (!res.success || res.data?.status !== "success") {
        await this.deleteDocumentVectors(docId).catch(() => {});
        return {
          success: false,
          error: res.error || "failed_to_index_vectors",
          status: res.status,
          isTimeout: Boolean(res.isTimeout)
        };
      }
      totalIndexed += (res.data.indexed_count || chunk.length);
    }

    return {
      success: true,
      documentId: docId,
      indexedCount: totalIndexed
    };
  }

  /**
   * Performs semantic similarity retrieval against a document-scoped vector collection.
   * POST /ai/vectors/query
   * @param {string} documentId
   * @param {string} query
   * @param {number} [topK=3]
   * @returns {Promise<{ success: boolean, results?: Array<Object>, error?: string, isTimeout?: boolean }>}
   */
  async queryVectors(documentId, query, topK = 3) {
    if (typeof documentId !== "string" || !documentId.trim()) {
      return { success: false, error: "documentId must be a non-empty string." };
    }
    if (typeof query !== "string" || !query.trim()) {
      return { success: false, error: "query must be a non-empty string." };
    }

    const payload = {
      document_id: documentId.trim(),
      query: query.trim(),
      top_k: Math.max(1, Math.min(50, Number(topK) || 3))
    };

    const res = await this._request("/ai/vectors/query", "POST", payload);
    if (res.success && Array.isArray(res.data?.results)) {
      return {
        success: true,
        results: res.data.results
      };
    }

    return {
      success: false,
      results: [],
      error: res.error || "failed_to_query_vectors",
      status: res.status,
      isTimeout: Boolean(res.isTimeout)
    };
  }

  /**
   * Explicitly deletes a document-scoped vector collection to guarantee zero retention.
   * DELETE /ai/vectors/{document_id}
   * @param {string} documentId
   * @returns {Promise<{ success: boolean, documentId?: string, deleted?: boolean, error?: string, isTimeout?: boolean }>}
   */
  async deleteDocumentVectors(documentId) {
    if (typeof documentId !== "string" || !documentId.trim()) {
      return { success: false, error: "documentId must be a non-empty string." };
    }

    const safeId = encodeURIComponent(documentId.trim());
    const res = await this._request(`/ai/vectors/${safeId}`, "DELETE");

    if (res.success) {
      return {
        success: true,
        documentId: res.data?.document_id || documentId,
        deleted: Boolean(res.data?.deleted)
      };
    }

    return {
      success: false,
      error: res.error || "failed_to_delete_vectors",
      status: res.status,
      isTimeout: Boolean(res.isTimeout)
    };
  }

  /**
   * Helper that executes a callback within a temporary document vector store session,
   * guaranteeing explicit cleanup in a finally block (zero retention).
   *
   * @param {string} documentId
   * @param {Array<Object>} clauses
   * @param {Function} callback - Async function receiving { indexedCount, queryVectors }
   * @returns {Promise<any>}
   */
  async withDocumentVectors(documentId, clauses, callback) {
    let indexResult = null;
    try {
      indexResult = await this.indexClauses(documentId, clauses);
      return await callback(indexResult);
    } finally {
      // Cleanup runs unconditionally to guarantee zero data retention
      await this.deleteDocumentVectors(documentId);
    }
  }

  /**
   * Computes cosine similarity between two normalized vectors.
   * @param {Array<number>} vecA
   * @param {Array<number>} vecB
   * @returns {number} Value in range [-1.0, 1.0]
   */
  computeCosineSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
      return 0.0;
    }

    let dot = 0.0;
    let normA = 0.0;
    let normB = 0.0;

    for (let i = 0; i < vecA.length; i++) {
      const a = Number(vecA[i]) || 0;
      const b = Number(vecB[i]) || 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0.0;

    const rawSim = dot / denominator;
    return Number(Math.max(-1.0, Math.min(1.0, rawSim)).toFixed(4));
  }

  /**
   * Compares two clause versions semantically using dense sentence embeddings.
   * @param {string} oldText
   * @param {string} newText
   * @returns {Promise<{ success: boolean, similarityScore?: number, available?: boolean, error?: string }>}
   */
  async compareClausesSemantic(oldText, newText) {
    const embedRes = await this.embedBatch([oldText, newText]);
    if (!embedRes.success || !embedRes.embeddings || embedRes.embeddings.length !== 2) {
      return {
        success: false,
        available: false,
        error: embedRes.error || "failed_to_embed_comparison_clauses"
      };
    }

    const similarity = this.computeCosineSimilarity(embedRes.embeddings[0], embedRes.embeddings[1]);
    return {
      success: true,
      available: true,
      similarityScore: similarity
    };
  }
  /**
   * Validates a generated Q&A answer against evidence clauses using DeBERTa-v3 NLI.
   * POST /ai/nli/validate
   *
   * @param {string} answer - The generated answer/hypothesis text
   * @param {Array<Object>} evidenceClauses - Array of evidence clauses [{ text, clauseId/clause_id }]
   * @param {Object} [options={}] - Optional request options (e.g. timeoutMs)
   * @returns {Promise<{
   *   success: boolean,
   *   available: boolean,
   *   isSupported?: boolean,
   *   status?: string,
   *   label?: string,
   *   scores?: { entailment: number, neutral: number, contradiction: number },
   *   bestClauseId?: string|null,
   *   evaluatedCount?: number,
   *   error?: string,
   *   isTimeout?: boolean
   * }>}
   */
  async validateNli(answer, evidenceClauses, options = {}) {
    if (typeof answer !== "string" || !answer.trim()) {
      return {
        success: false,
        available: false,
        error: "invalid_answer_input",
        status: "unavailable"
      };
    }

    if (!Array.isArray(evidenceClauses) || evidenceClauses.length === 0) {
      return {
        success: false,
        available: false,
        error: "invalid_evidence_input",
        status: "unavailable"
      };
    }

    const cleanedClauses = [];
    for (let i = 0; i < evidenceClauses.length; i++) {
      const c = evidenceClauses[i];
      const text = typeof c === "string" ? c.trim() : String(c?.text || c?.rawText || "").trim();
      if (!text) {
        return {
          success: false,
          available: false,
          error: "invalid_evidence_clause_text",
          status: "unavailable"
        };
      }
      cleanedClauses.push({
        text,
        clause_id: c?.clauseId || c?.clause_id ? String(c.clauseId || c.clause_id).trim() : null
      });
    }

    const payload = {
      answer: answer.trim(),
      evidence: cleanedClauses
    };

    const rawTimeout = options?.timeoutMs !== undefined ? options.timeoutMs : this.nliTimeoutMs;
    const timeout = PythonAiClient.parseTimeout(rawTimeout, this.nliTimeoutMs || DEFAULT_NLI_TIMEOUT_MS);
    const res = await this._request("/ai/nli/validate", "POST", payload, timeout);

    if (res.success && res.data && typeof res.data === "object") {
      const d = res.data;
      const validSupported = typeof d.is_supported === "boolean";
      const validStatus = typeof d.status === "string";
      const validScores = typeof d.scores === "object" && d.scores !== null &&
        typeof d.scores.entailment === "number" &&
        typeof d.scores.neutral === "number" &&
        typeof d.scores.contradiction === "number";

      if (validSupported && validStatus && validScores) {
        let clauseEvaluations = null;
        if (Array.isArray(d.clause_evaluations)) {
          clauseEvaluations = d.clause_evaluations.map((item) => ({
            clauseId: item?.clause_id ? String(item.clause_id) : null,
            label: String(item?.label || ""),
            scores: item?.scores && typeof item.scores === "object" ? {
              entailment: Number(item.scores.entailment) || 0,
              neutral: Number(item.scores.neutral) || 0,
              contradiction: Number(item.scores.contradiction) || 0
            } : null
          }));
        }

        let compositeEvaluation = null;
        if (d.composite_evaluation && typeof d.composite_evaluation === "object") {
          const compScores = d.composite_evaluation.scores;
          compositeEvaluation = {
            label: String(d.composite_evaluation.label || ""),
            scores: compScores && typeof compScores === "object" ? {
              entailment: Number(compScores.entailment) || 0,
              neutral: Number(compScores.neutral) || 0,
              contradiction: Number(compScores.contradiction) || 0
            } : null
          };
        }

        return {
          success: true,
          available: true,
          isSupported: d.is_supported,
          status: d.status,
          label: typeof d.label === "string" ? d.label : null,
          scores: {
            entailment: d.scores.entailment,
            neutral: d.scores.neutral,
            contradiction: d.scores.contradiction
          },
          bestClauseId: typeof d.best_clause_id === "string" ? d.best_clause_id : null,
          evaluatedCount: Number(d.evaluated_clauses_count) || cleanedClauses.length,
          clauseEvaluations,
          compositeEvaluation,
          reason: typeof d.reason === "string" ? d.reason : null
        };
      }

      this.recordFailure("malformed_nli_response");
      return {
        success: false,
        available: false,
        error: "malformed_nli_response",
        status: "unavailable"
      };
    }

    return {
      success: false,
      available: false,
      error: res.error || "nli_service_failed",
      isTimeout: Boolean(res.isTimeout),
      status: "unavailable"
    };
  }
}

// Export singleton instance configured for application runtime
export const aiClient = new PythonAiClient();
