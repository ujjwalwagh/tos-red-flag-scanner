/**
 * LangGraph StateGraph Builder for TOS Red Flag Scanner Q&A Pipeline (Phase 8B.2).
 *
 * Constructs and compiles the directed state machine for Q&A orchestration.
 * Enforces zero-retention ephemeral execution (no persistent checkpoints, no disk storage).
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { QaGraphAnnotation } from "./state.js";
import { validateInputNode } from "./nodes/validate-input.js";
import { createPrepareContextNode } from "./nodes/prepare-context.js";
import { createGenerateAnswerNode } from "./nodes/generate-answer.js";
import { validateGroundingNode } from "./nodes/validate-grounding.js";
import { createVerifyNliNode } from "./nodes/verify-nli.js";
import { formatResponseNode } from "./nodes/format-response.js";
import {
  routeAfterValidation,
  routeAfterContext,
  routeAfterGrounding
} from "./routing.js";

/**
 * Builds and compiles the LangGraph Q&A state machine.
 *
 * @param {Object} [options={}]
 * @param {Function} [options.retriever] - Optional clause retrieval function
 * @param {Function|Object} [options.generator] - Optional answer generator / mock
 * @param {Function|Object} [options.nliClient] - Optional NLI client / mock
 * @param {Object} [options.modelOptions] - Options passed to ChatGoogle model adapter
 * @returns {import("@langchain/langgraph").CompiledStateGraph} Compiled ephemeral graph
 */
export function buildQaGraph(options = {}) {
  const workflow = new StateGraph(QaGraphAnnotation)
    // 1. Input Validation Node
    .addNode("validate_input", validateInputNode)

    // 2. Evidence Context Preparation Node
    .addNode("prepare_context", createPrepareContextNode(options))

    // 3. Grounded Answer Generation Node
    .addNode("generate_answer", createGenerateAnswerNode(options))

    // 4. Grounding & Clause Mapping Validation Node
    .addNode("validate_grounding", validateGroundingNode)

    // 5. Factual NLI Verification Node
    .addNode("verify_nli", createVerifyNliNode(options))

    // 6. Final API Response Formatter Node
    .addNode("format_response", formatResponseNode)

    // Edge from START to input validation
    .addEdge(START, "validate_input")

    // Conditional edge after validation (skips to response if input invalid)
    .addConditionalEdges("validate_input", routeAfterValidation)

    // Conditional edge after context preparation (routes to answer or error response)
    .addConditionalEdges("prepare_context", routeAfterContext)

    // Answer generation connects to grounding validation
    .addEdge("generate_answer", "validate_grounding")

    // Conditional edge after grounding (runs NLI only if grounded; skips NLI on refusal/ungrounded)
    .addConditionalEdges("validate_grounding", routeAfterGrounding)

    // NLI verification connects to final response formatting
    .addEdge("verify_nli", "format_response")

    // Final response connects to END
    .addEdge("format_response", END);

  // CRITICAL PRIVACY REQUIREMENT:
  // Compile strictly without a checkpointer (no MongoDBSaver, SqliteSaver, or MemorySaver).
  // Graph state exists exclusively in process RAM for the lifetime of invoke() and is garbage collected.
  return workflow.compile();
}

/**
 * Pre-compiled default Q&A graph instance ready for stateless invocation.
 */
export const defaultQaGraph = buildQaGraph();
