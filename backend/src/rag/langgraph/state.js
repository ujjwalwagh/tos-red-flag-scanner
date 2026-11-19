/**
 * LangGraph State Definition for TOS Red Flag Scanner Q&A Pipeline (Phase 8B.2).
 *
 * Defines the request-scoped, in-memory state annotation schema for LangGraph.
 * Strictly ephemeral: no database persistence, no disk storage, no API keys stored in state.
 */

import { Annotation } from "@langchain/langgraph";

/**
 * Reducer that replaces the existing value with the incoming update,
 * or keeps current value if update is undefined.
 */
function replaceReducer(current, update) {
  return update !== undefined ? update : current;
}

/**
 * LangGraph state schema for Q&A orchestration.
 */
export const QaGraphAnnotation = Annotation.Root({
  // Request metadata (ephemeral)
  requestId: Annotation({ reducer: replaceReducer, default: () => "" }),
  documentType: Annotation({ reducer: replaceReducer, default: () => "TERMS" }),
  documentLabel: Annotation({ reducer: replaceReducer, default: () => "Terms of Service" }),
  isPartial: Annotation({ reducer: replaceReducer, default: () => false }),

  // User input
  question: Annotation({ reducer: replaceReducer, default: () => "" }),
  rawQuestion: Annotation({ reducer: replaceReducer, default: () => "" }),
  clauses: Annotation({ reducer: replaceReducer, default: () => [] }),
  policyText: Annotation({ reducer: replaceReducer, default: () => "" }),

  // Evidence context
  retrievedEvidence: Annotation({ reducer: replaceReducer, default: () => [] }),
  hasSufficientEvidence: Annotation({ reducer: replaceReducer, default: () => false }),
  evidenceSource: Annotation({ reducer: replaceReducer, default: () => "none" }), // "vector" | "keyword" | "none"

  // Generated response & validation
  answer: Annotation({ reducer: replaceReducer, default: () => "" }),
  grounded: Annotation({ reducer: replaceReducer, default: () => false }),
  confidence: Annotation({ reducer: replaceReducer, default: () => 0.0 }),
  relevantClauseIds: Annotation({ reducer: replaceReducer, default: () => [] }),
  mappedEvidence: Annotation({ reducer: replaceReducer, default: () => [] }),
  evidenceToValidate: Annotation({ reducer: replaceReducer, default: () => [] }),

  // NLI verification
  nliValidation: Annotation({
    reducer: replaceReducer,
    default: () => ({
      status: "unavailable",
      label: null,
      scores: null,
      bestClauseId: null,
      clauseEvaluations: null,
      compositeEvaluation: null,
      reason: null
    })
  }),

  // Graph execution status & error shielding
  status: Annotation({ reducer: replaceReducer, default: () => "initialized" }),
  error: Annotation({ reducer: replaceReducer, default: () => null }),

  // Final response envelope matching existing API contract
  finalResponse: Annotation({ reducer: replaceReducer, default: () => null })
});
