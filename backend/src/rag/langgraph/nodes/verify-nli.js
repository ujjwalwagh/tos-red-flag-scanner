/**
 * Node 5: Verify NLI (Phase 8B.2).
 *
 * Runs factual entailment verification using DeBERTa cross-encoder only when
 * an answer is grounded and supported by verified evidence.
 * Skips NLI on refusal/ungrounded answers to prevent misleading contradiction flags.
 */

/**
 * Creates the verifyNliNode with optional NLI client injection for testing.
 *
 * @param {Object} [options={}]
 * @param {Object|Function} [options.nliClient] - Optional NLI client or mock function
 * @returns {Function} LangGraph node function
 */
export function createVerifyNliNode(options = {}) {
  const customNli = options.nliClient || null;

  return async function verifyNliNode(state) {
    if (state.error) {
      return { status: "error" };
    }

    // Skip NLI on ungrounded/refusal answers (Phase 7G-D.6 invariant)
    if (!state.grounded) {
      return {
        nliValidation: {
          status: "uncertain",
          label: "neutral",
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: "insufficient_evidence_unanswered"
        },
        status: "verified"
      };
    }

    const evidence = Array.isArray(state.evidenceToValidate) ? state.evidenceToValidate : [];
    if (evidence.length === 0 || !state.answer) {
      return {
        nliValidation: {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: "no_evidence_supplied"
        },
        status: "verified"
      };
    }

    try {
      let nliRes = null;
      if (typeof customNli === "function") {
        nliRes = await customNli(state.answer, evidence);
      } else if (customNli && typeof customNli.validateNli === "function") {
        nliRes = await customNli.validateNli(state.answer, evidence);
      } else {
        // Fallback when no client is injected
        return {
          nliValidation: {
            status: "unavailable",
            label: null,
            scores: null,
            bestClauseId: null,
            clauseEvaluations: null,
            compositeEvaluation: null,
            reason: "nli_client_unavailable"
          },
          status: "verified"
        };
      }

      if (nliRes && (nliRes.available || nliRes.success)) {
        const val = nliRes.validation || nliRes;
        return {
          nliValidation: {
            status: val.status || (val.isSupported ? "supported" : "uncertain"),
            label: val.label || null,
            scores: val.scores || null,
            bestClauseId: val.bestClauseId || null,
            clauseEvaluations: val.clauseEvaluations || null,
            compositeEvaluation: val.compositeEvaluation || null,
            reason: val.reason || null
          },
          status: "verified"
        };
      }

      return {
        nliValidation: {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: nliRes?.error || "nli_service_unavailable"
        },
        status: "verified"
      };
    } catch (nliErr) {
      return {
        nliValidation: {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: nliErr?.message || "nli_validation_failed"
        },
        status: "verified"
      };
    }
  };
}
