/**
 * Node 2: Prepare Context & Evidence (Phase 8B.2).
 *
 * Retrieves relevant clauses for the question using vector/keyword retrieval,
 * expands hits with sibling clauses and exception triggers (expandEvidenceWithExceptions),
 * and assesses whether sufficient evidence exists for answering.
 */

import { expandEvidenceWithExceptions } from "../../../api/controllers/analyze.controller.js";

/**
 * Fallback lexical retrieval scoring when vector service is absent or in test mode.
 *
 * @param {string} question
 * @param {Array<Object>} clauses
 * @returns {Array<Object>}
 */
export function defaultLexicalRetriever(question, clauses) {
  if (!Array.isArray(clauses) || clauses.length === 0) return [];

  const terms = question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) return clauses.slice(0, 5);

  const scored = clauses.map((c) => {
    const textLower = String(c.text || "").toLowerCase();
    const secLower = String(c.section || "").toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (textLower.includes(term)) score += 2;
      if (secLower.includes(term)) score += 3;
    }
    return { clause: c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.clause);
}

/**
 * Prepares evidence context for downstream answering.
 *
 * @param {Object} state - Current QaGraphState
 * @param {Object} [options={}]
 * @param {Function} [options.retriever] - Optional async retrieval function: (question, clauses) => Promise<Array>
 * @returns {Promise<Partial<Object>>} State updates
 */
export function createPrepareContextNode(options = {}) {
  const customRetriever = options.retriever || null;

  return async function prepareContextNode(state) {
    if (state.error || !state.question || !Array.isArray(state.clauses) || state.clauses.length === 0) {
      return {
        retrievedEvidence: [],
        hasSufficientEvidence: false,
        status: state.error ? "error" : "context_prepared"
      };
    }

    let stage1Hits = [];
    let evidenceSource = "keyword";

    if (typeof customRetriever === "function") {
      try {
        stage1Hits = await customRetriever(state.question, state.clauses);
        evidenceSource = "custom";
      } catch (err) {
        stage1Hits = defaultLexicalRetriever(state.question, state.clauses);
        evidenceSource = "keyword_fallback";
      }
    } else {
      stage1Hits = defaultLexicalRetriever(state.question, state.clauses);
    }

    // Expand Stage 1 hits with sibling clauses and exceptions (capped at 10)
    const expanded = expandEvidenceWithExceptions(stage1Hits, state.clauses, state.question);
    const hasSufficient = Array.isArray(expanded) && expanded.length > 0;

    return {
      retrievedEvidence: expanded,
      hasSufficientEvidence: hasSufficient,
      evidenceSource,
      status: "context_prepared"
    };
  };
}
