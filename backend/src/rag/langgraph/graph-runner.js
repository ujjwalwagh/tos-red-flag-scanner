/**
 * LangGraph Execution Runner for TOS Red Flag Scanner Q&A (Phase 8B.3).
 *
 * Connects the ephemeral LangGraph state machine to the existing Python AI client
 * (vector storage & DeBERTa NLI) and Gemini AI provider without duplicate network calls.
 */

import { buildQaGraph } from "./graph-builder.js";
import { normalizeSimilarityScore } from "../../api/controllers/analyze.controller.js";

/**
 * Executes a Q&A request through the LangGraph state machine.
 *
 * @param {Object} params
 * @param {string} params.question - Validated user question
 * @param {Array<Object>} params.clauses - Validated, bounded document clauses
 * @param {string} [params.policyText] - Optional fallback policy text
 * @param {string} [params.documentType="TERMS"] - Document type
 * @param {string} [params.documentLabel="Terms of Service"] - Document label
 * @param {boolean} [params.isPartial=false] - Partial analysis flag
 * @param {Object} [params.client] - AI client instance (withDocumentVectors, validateNli)
 * @param {Object} [params.provider] - AI provider instance (answerQuestion)
 * @param {string} [params.qaSessionId] - Ephemeral session identifier for ChromaDB zero-retention
 * @param {string} [params.requestId] - Unique request ID for auditing
 * @returns {Promise<Object>} Final response matching the existing API contract
 */
export async function executeLangGraphQa(params) {
  const {
    question,
    clauses,
    policyText,
    documentType = "TERMS",
    documentLabel = "Terms of Service",
    isPartial = false,
    client,
    provider,
    qaSessionId,
    requestId
  } = params;

  let vectorRetrievalCalled = false;
  let retrievedEvidence = [];
  let geminiCalled = false;
  let geminiResult = null;
  let nliCalled = false;
  let nliResult = null;

  // Custom clause retriever integrating existing withDocumentVectors & queryVectors
  const vectorRetriever = async (q, boundedClauses) => {
    vectorRetrievalCalled = true;
    let retrieved = [];
    if (client && typeof client.withDocumentVectors === "function" && qaSessionId) {
      try {
        await client.withDocumentVectors(qaSessionId, boundedClauses, async (indexRes) => {
          if (indexRes?.success) {
            try {
              const queryRes = await client.queryVectors(qaSessionId, q, 8);
              if (queryRes?.success && Array.isArray(queryRes.results) && queryRes.results.length > 0) {
                retrieved = queryRes.results.map((r, idx) => {
                  const sim = normalizeSimilarityScore(r);
                  const item = {
                    clauseId: String(r.clause_id || r.clauseId || `c_${idx}`),
                    text: String(r.text || r.rawText || "").trim(),
                    section: String(r.section || r.title || "").trim()
                  };
                  if (sim !== null) {
                    item.similarityScore = sim;
                    item.similarity = sim;
                    item.similarity_score = sim;
                  }
                  return item;
                });
              }
            } catch {
              retrieved = [];
            }
          }
        });
      } catch {
        retrieved = [];
      }
    }
    retrievedEvidence = retrieved;
    return retrieved;
  };

  // Custom generator integrating existing provider.answerQuestion
  const answerGenerator = async (vars, state) => {
    geminiCalled = true;
    if (provider && typeof provider.answerQuestion === "function") {
      const res = await provider.answerQuestion({
        question: vars.question,
        retrievedEvidence: state.retrievedEvidence,
        documentLabel: state.documentLabel
      });
      geminiResult = res;
      if (res?.available && res?.data) {
        return res.data;
      }
      return {
        answer: `Unable to generate an AI answer. Please review the provided ${state.documentLabel} evidence directly.`,
        grounded: false,
        confidence: 0,
        relevantClauseIds: []
      };
    }
    geminiResult = { available: false, reason: "provider_unavailable" };
    return {
      answer: "AI provider is unavailable.",
      grounded: false,
      confidence: 0,
      relevantClauseIds: []
    };
  };

  // Custom NLI client integrating existing client.validateNli
  const nliValidator = async (answer, evidence) => {
    nliCalled = true;
    if (client && typeof client.validateNli === "function") {
      const res = await client.validateNli(answer, evidence);
      nliResult = res;
      return res;
    }
    return { available: false, error: "nli_client_unavailable" };
  };

  const graph = buildQaGraph({
    retriever: vectorRetriever,
    generator: answerGenerator,
    nliClient: nliValidator
  });

  try {
    const output = await graph.invoke({
      requestId,
      question,
      clauses,
      policyText,
      documentType,
      documentLabel,
      isPartial
    });

    if (output && output.finalResponse) {
      return output.finalResponse;
    }
    throw new Error("graph_empty_response");
  } catch (graphErr) {
    // If Gemini was already invoked, we MUST NOT re-throw to procedural fallback,
    // because that would invoke Gemini a second time!
    if (geminiCalled) {
      const data = geminiResult?.data || {};
      const answer = data?.answer || (geminiResult?.available === false
        ? `Unable to generate an AI answer. Please review the provided ${documentLabel} evidence directly.`
        : "No answer provided.");
      const grounded = Boolean(data?.grounded);
      const confidence = typeof data?.confidence === "number" ? data.confidence : 0.0;

      let nliValidation = {
        status: "unavailable",
        label: null,
        scores: null,
        bestClauseId: null,
        clauseEvaluations: null,
        compositeEvaluation: null,
        reason: "graph_post_generation_fallback"
      };

      if (!grounded) {
        nliValidation = {
          status: "uncertain",
          label: "neutral",
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: "insufficient_evidence_unanswered"
        };
      } else if (nliResult && nliResult.validation) {
        nliValidation = nliResult.validation;
      }

      return {
        success: true,
        qa: {
          question,
          answer,
          evidence: Array.isArray(retrievedEvidence) ? retrievedEvidence : [],
          grounded,
          confidence,
          available: geminiResult ? geminiResult.available !== false : false,
          reason: geminiResult?.reason || graphErr?.message || null,
          nliValidation,
          documentLabel
        }
      };
    }

    // If Gemini was not called yet, re-throw so procedural pipeline can execute (Gemini called at most once)
    throw graphErr;
  }
}
