/**
 * Node 3: Generate Grounded Answer (Phase 8B.2).
 *
 * Invokes the structured Gemini model via LangChain or supplied generator.
 * If evidence is insufficient, generates an immediate refusal without calling the LLM.
 */

import { buildQaPromptVariables, createQaPromptTemplate } from "../../langchain/prompt-templates.js";
import { createStructuredQaModel } from "../../langchain/model-adapter.js";
import { validateQaAnswer } from "../../langchain/output-schemas.js";

/**
 * Creates the generateAnswerNode with optional model injection for testing.
 *
 * @param {Object} [options={}]
 * @param {Object|Function} [options.generator] - Custom generator or runnable mock
 * @returns {Function} LangGraph node function
 */
export function createGenerateAnswerNode(options = {}) {
  const customGenerator = options.generator || null;

  return async function generateAnswerNode(state) {
    if (state.error) {
      return { status: "error" };
    }

    const docLabel = state.documentLabel || "Terms of Service";

    // Immediate refusal path if evidence is insufficient
    if (!state.hasSufficientEvidence || !Array.isArray(state.retrievedEvidence) || state.retrievedEvidence.length === 0) {
      return {
        answer: `The provided ${docLabel} evidence does not contain enough information to answer this question.`,
        grounded: false,
        confidence: 0.0,
        relevantClauseIds: [],
        status: "answered"
      };
    }

    const promptVars = buildQaPromptVariables({
      question: state.question,
      retrievedEvidence: state.retrievedEvidence,
      documentLabel: docLabel
    });

    let rawResult = null;

    try {
      if (typeof customGenerator === "function") {
        rawResult = await customGenerator(promptVars, state);
      } else if (customGenerator && typeof customGenerator.invoke === "function") {
        const promptTemplate = createQaPromptTemplate();
        const formattedMessages = await promptTemplate.formatMessages(promptVars);
        rawResult = await customGenerator.invoke(formattedMessages);
      } else {
        const model = createStructuredQaModel(options.modelOptions || {});
        const promptTemplate = createQaPromptTemplate();
        const formattedMessages = await promptTemplate.formatMessages(promptVars);
        rawResult = await model.invoke(formattedMessages);
      }
    } catch (err) {
      return {
        answer: `Unable to generate an answer at this time due to model unavailability.`,
        grounded: false,
        confidence: 0.0,
        relevantClauseIds: [],
        status: "error",
        error: err?.message || "model_generation_failed"
      };
    }

    const validated = validateQaAnswer(rawResult);
    if (!validated.success) {
      return {
        answer: typeof rawResult?.answer === "string" ? rawResult.answer : "Invalid response format received from model.",
        grounded: false,
        confidence: 0.0,
        relevantClauseIds: [],
        status: "answered_invalid"
      };
    }

    return {
      answer: validated.data.answer,
      grounded: validated.data.grounded,
      confidence: validated.data.confidence,
      relevantClauseIds: validated.data.relevantClauseIds,
      status: "answered"
    };
  };
}
