/**
 * Node 6: Format Response (Phase 8B.2).
 *
 * Formats the final Q&A output object matching the exact existing
 * JSON response contract expected by the Chrome extension and frontend.
 */

/**
 * Formats final Q&A response payload.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {Partial<Object>} State updates with finalResponse
 */
export async function formatResponseNode(state) {
  try {
    const isSuccess = !state.error;
    const answerText = state.answer
      ? String(state.answer).trim()
      : (state.error ? String(state.error) : "No answer provided.");

    const responsePayload = {
      success: isSuccess,
      qa: {
        question: state.question || state.rawQuestion || "",
        answer: answerText,
        evidence: Array.isArray(state.mappedEvidence) ? state.mappedEvidence : [],
        grounded: Boolean(state.grounded),
        confidence: typeof state.confidence === "number" ? state.confidence : 0.0,
        available: true,
        reason: state.error || null,
        nliValidation: state.nliValidation || {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: null
        },
        documentLabel: state.documentLabel || "Terms of Service"
      }
    };

    return {
      finalResponse: responsePayload,
      status: isSuccess ? "completed" : "error_completed"
    };
  } catch (err) {
    return {
      finalResponse: {
        success: true,
        qa: {
          question: state.question || "",
          answer: state.answer || "No answer provided.",
          evidence: Array.isArray(state.mappedEvidence) ? state.mappedEvidence : [],
          grounded: Boolean(state.grounded),
          confidence: typeof state.confidence === "number" ? state.confidence : 0.0,
          available: true,
          reason: err?.message || "formatting_recovered",
          nliValidation: state.nliValidation || {
            status: "unavailable",
            label: null,
            scores: null,
            bestClauseId: null,
            clauseEvaluations: null,
            compositeEvaluation: null,
            reason: "formatting_recovered"
          },
          documentLabel: state.documentLabel || "Terms of Service"
        }
      },
      status: "error_completed"
    };
  }
}
