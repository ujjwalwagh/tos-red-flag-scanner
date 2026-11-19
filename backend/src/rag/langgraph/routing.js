/**
 * LangGraph Conditional Routing Functions (Phase 8B.2).
 *
 * Implements deterministic routing decisions based on validation,
 * evidence sufficiency, grounding flags, and error states.
 */

/**
 * Determines the next node after input validation.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {string} Target node name
 */
export function routeAfterValidation(state) {
  if (state.error) {
    return "format_response";
  }
  return "prepare_context";
}

/**
 * Determines whether to proceed to answer generation or jump to final formatting.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {string} Target node name
 */
export function routeAfterContext(state) {
  if (state.error) {
    return "format_response";
  }
  return "generate_answer";
}

/**
 * Determines whether to run NLI verification or skip directly to final response.
 * Skips NLI whenever the answer is ungrounded or in an error state.
 *
 * @param {Object} state - Current QaGraphState
 * @returns {string} Target node name
 */
export function routeAfterGrounding(state) {
  if (state.error || !state.grounded) {
    return "format_response";
  }
  return "verify_nli";
}
