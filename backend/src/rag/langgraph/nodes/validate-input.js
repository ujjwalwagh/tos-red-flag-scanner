/**
 * Node 1: Validate Input (Phase 8B.2).
 *
 * Validates request parameters, trims question, bounds clause count (<= 1000),
 * and standardizes document metadata before any downstream processing.
 */

import crypto from "node:crypto";

/**
 * Validates and sanitizes Q&A input parameters.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {Partial<Object>} State updates
 */
export async function validateInputNode(state) {
  const requestId = state.requestId || `qa_${crypto.randomUUID()}`;

  const rawQ = state.rawQuestion || state.question;
  if (typeof rawQ !== "string" || !rawQ.trim()) {
    return {
      requestId,
      status: "error",
      error: "A valid question is required.",
      hasSufficientEvidence: false
    };
  }

  const question = rawQ.trim();
  if (question.length < 3) {
    return {
      requestId,
      question,
      status: "error",
      error: "Question must be at least 3 characters long.",
      hasSufficientEvidence: false
    };
  }
  if (question.length > 500) {
    return {
      requestId,
      question,
      status: "error",
      error: "Question must not exceed 500 characters.",
      hasSufficientEvidence: false
    };
  }

  let clauses = Array.isArray(state.clauses) ? state.clauses : [];
  if (clauses.length === 0 && typeof state.policyText === "string" && state.policyText.trim()) {
    // Basic single-clause fallback if raw policyText was supplied without pre-segmented clauses
    clauses = [{
      clauseId: "clause_1",
      text: state.policyText.trim().slice(0, 100000),
      section: "Document Content"
    }];
  }

  if (clauses.length === 0) {
    return {
      requestId,
      question,
      status: "error",
      error: "Either non-empty clauses array or policyText must be provided.",
      hasSufficientEvidence: false
    };
  }

  // Bound clauses to prevent memory exhaustion (max 1,000 clauses)
  const boundedClauses = clauses.slice(0, 1000).map((c, idx) => ({
    clauseId: String(c.clauseId || c.clause_id || `clause_${idx + 1}`).trim(),
    text: typeof c === "string" ? c.trim() : String(c.text || c.rawText || "").trim(),
    section: String(c.section || c.title || "").trim()
  })).filter((c) => c.text.length > 0);

  if (boundedClauses.length === 0) {
    return {
      requestId,
      question,
      status: "error",
      error: "No valid clauses could be extracted from the provided document context.",
      hasSufficientEvidence: false
    };
  }

  const docLabel = (typeof state.documentLabel === "string" && state.documentLabel.trim())
    ? state.documentLabel.trim()
    : (state.documentType === "PRIVACY" ? "Privacy Policy" : "Terms of Service");

  return {
    requestId,
    question,
    clauses: boundedClauses,
    documentLabel: docLabel,
    documentType: state.documentType || "TERMS",
    status: "validated",
    error: null
  };
}
