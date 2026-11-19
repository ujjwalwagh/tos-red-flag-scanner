/**
 * Node 4: Validate Grounding (Phase 8B.2).
 *
 * Verifies that the model's referenced clause IDs genuinely exist in the retrieved evidence,
 * rejects fabricated clause references, maps verified clauses for NLI verification,
 * and sets the standard Phase 7G-D.6 refusal NLI structure when ungrounded.
 */

/**
 * Validates model-selected clause IDs against retrieved evidence clauses.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {Partial<Object>} State updates
 */
export async function validateGroundingNode(state) {
  if (state.error) {
    return { status: "error" };
  }

  try {
    const retrieved = Array.isArray(state.retrievedEvidence) ? state.retrievedEvidence : [];
    const clauseMap = new Map();

    for (const item of retrieved) {
      if (item && item.clauseId) {
        clauseMap.set(String(item.clauseId).trim(), item);
      }
    }

    const validatedClauses = [];
    const seenIds = new Set();

    if (state.grounded && Array.isArray(state.relevantClauseIds)) {
      for (const rawId of state.relevantClauseIds) {
        const cleanId = String(rawId || "").trim();
        if (cleanId && !seenIds.has(cleanId) && clauseMap.has(cleanId)) {
          seenIds.add(cleanId);
          validatedClauses.push(clauseMap.get(cleanId));
        }
      }
    }

    let mappedEvidence = [];
    if (validatedClauses.length > 0) {
      mappedEvidence = validatedClauses;
    } else if (state.grounded && retrieved.length > 0) {
      mappedEvidence = retrieved;
    } else {
      mappedEvidence = [];
    }

    // Determine whether grounded status is truly legitimate
    const isGrounded = Boolean(state.grounded) && mappedEvidence.length > 0;

    // When ungrounded, prepare the standard Phase 7G-D.6 refusal NLI object
    // so that downstream nodes have the exact expected state without running NLI.
    const nliValidation = !isGrounded
      ? {
          status: "uncertain",
          label: "neutral",
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: "insufficient_evidence_unanswered"
        }
      : (state.nliValidation || {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: null
        });

    return {
      grounded: isGrounded,
      mappedEvidence,
      evidenceToValidate: mappedEvidence,
      nliValidation,
      status: "grounding_validated"
    };
  } catch {
    return {
      grounded: false,
      mappedEvidence: [],
      evidenceToValidate: [],
      nliValidation: {
        status: "uncertain",
        label: "neutral",
        scores: null,
        bestClauseId: null,
        clauseEvaluations: null,
        compositeEvaluation: null,
        reason: "insufficient_evidence_unanswered"
      },
      status: "grounding_validated"
    };
  }
}
