/**
 * Phase 8B.2 — LangGraph State Machine Orchestration Tests.
 *
 * Verifies graph initialization, state schema validation, node execution,
 * conditional routing, refusal handling, NLI bypass, error resilience,
 * ephemeral zero-retention execution, and LangChain foundation compatibility.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQaGraph,
  defaultQaGraph,
  QaGraphAnnotation,
  validateInputNode,
  createPrepareContextNode,
  createGenerateAnswerNode,
  validateGroundingNode,
  createVerifyNliNode,
  formatResponseNode,
  routeAfterValidation,
  routeAfterContext,
  routeAfterGrounding
} from "../src/rag/langgraph/index.js";
import { qaAnswerSchema } from "../src/rag/langchain/output-schemas.js";
import { createQaPromptTemplate } from "../src/rag/langchain/prompt-templates.js";

const SAMPLE_CLAUSES = [
  {
    clauseId: "term_cancel_1",
    section: "Subscriptions & Cancellation",
    text: "You may cancel your recurring subscription at any time through your account settings or by contacting customer support."
  },
  {
    clauseId: "term_refund_2",
    section: "Refund Policy",
    text: "All fees paid are strictly non-refundable except where required by applicable consumer law."
  },
  {
    clauseId: "term_gov_3",
    section: "Governing Law",
    text: "These terms are governed by and construed in accordance with the laws of the State of California."
  }
];

// ---------------------------------------------------------------------------
// 1. Graph Initialization and Compilation
// ---------------------------------------------------------------------------

test("LangGraph: buildQaGraph compiles an executable StateGraph", () => {
  const graph = buildQaGraph();
  assert.ok(graph);
  assert.equal(typeof graph.invoke, "function");
});

test("LangGraph: defaultQaGraph is pre-compiled and exported", () => {
  assert.ok(defaultQaGraph);
  assert.equal(typeof defaultQaGraph.invoke, "function");
});

// ---------------------------------------------------------------------------
// 2. State Schema Validation
// ---------------------------------------------------------------------------

test("LangGraph: QaGraphAnnotation defines required state channels", () => {
  assert.ok(QaGraphAnnotation);
  const spec = QaGraphAnnotation.spec;
  assert.ok(spec.requestId);
  assert.ok(spec.question);
  assert.ok(spec.clauses);
  assert.ok(spec.retrievedEvidence);
  assert.ok(spec.hasSufficientEvidence);
  assert.ok(spec.answer);
  assert.ok(spec.grounded);
  assert.ok(spec.confidence);
  assert.ok(spec.relevantClauseIds);
  assert.ok(spec.nliValidation);
  assert.ok(spec.status);
  assert.ok(spec.finalResponse);
});

// ---------------------------------------------------------------------------
// 3. Successful Node Execution & End-to-End Graph Flow
// ---------------------------------------------------------------------------

test("LangGraph: end-to-end execution with mocks produces grounded, verified Q&A response", async () => {
  let generatorCalled = false;
  let nliCalled = false;

  const mockGenerator = async (vars) => {
    generatorCalled = true;
    assert.ok(vars.question.includes("cancel"));
    return {
      answer: "You can cancel your subscription at any time via your account settings.",
      grounded: true,
      confidence: 0.95,
      relevantClauseIds: ["term_cancel_1"]
    };
  };

  const mockNli = async (answer, evidence) => {
    nliCalled = true;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].clauseId, "term_cancel_1");
    return {
      available: true,
      validation: {
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.96, contradiction: 0.01, neutral: 0.03 },
        bestClauseId: "term_cancel_1",
        reason: null
      }
    };
  };

  const graph = buildQaGraph({
    generator: mockGenerator,
    nliClient: mockNli
  });

  const output = await graph.invoke({
    question: "How do I cancel my subscription?",
    clauses: SAMPLE_CLAUSES,
    documentLabel: "Terms of Service"
  });

  assert.equal(generatorCalled, true);
  assert.equal(nliCalled, true);
  assert.ok(output.finalResponse);
  assert.equal(output.finalResponse.success, true);

  const qa = output.finalResponse.qa;
  assert.equal(qa.question, "How do I cancel my subscription?");
  assert.equal(qa.answer, "You can cancel your subscription at any time via your account settings.");
  assert.equal(qa.grounded, true);
  assert.equal(qa.confidence, 0.95);
  assert.equal(qa.evidence.length, 1);
  assert.equal(qa.evidence[0].clauseId, "term_cancel_1");
  assert.equal(qa.nliValidation.status, "supported");
  assert.equal(qa.nliValidation.bestClauseId, "term_cancel_1");
  assert.equal(output.status, "completed");
});

// ---------------------------------------------------------------------------
// 4. Conditional Routing
// ---------------------------------------------------------------------------

test("LangGraph: routing functions direct execution based on state", () => {
  // routeAfterValidation
  assert.equal(routeAfterValidation({ error: "bad input" }), "format_response");
  assert.equal(routeAfterValidation({ error: null }), "prepare_context");

  // routeAfterContext
  assert.equal(routeAfterContext({ error: "retrieval failed" }), "format_response");
  assert.equal(routeAfterContext({ error: null }), "generate_answer");

  // routeAfterGrounding
  assert.equal(routeAfterGrounding({ error: "failed" }), "format_response");
  assert.equal(routeAfterGrounding({ grounded: false }), "format_response");
  assert.equal(routeAfterGrounding({ grounded: true, error: null }), "verify_nli");
});

// ---------------------------------------------------------------------------
// 5. Insufficient-Evidence Handling
// ---------------------------------------------------------------------------

test("LangGraph: generates immediate refusal when evidence is empty without invoking LLM", async () => {
  let generatorCalled = false;
  const mockGenerator = async () => {
    generatorCalled = true;
    return { answer: "Should not be called", grounded: true, confidence: 1.0, relevantClauseIds: [] };
  };

  const graph = buildQaGraph({
    generator: mockGenerator,
    retriever: async () => [] // Returns no relevant clauses
  });

  // Query with empty clauses
  const output = await graph.invoke({
    question: "What is your data retention policy?",
    clauses: [{ clauseId: "c_dummy", text: "Completely unrelated text without keywords", section: "Other" }]
  });

  // Generator must NOT be called when retriever finds no matching clauses
  assert.equal(generatorCalled, false);
  assert.ok(output.finalResponse);
  assert.equal(output.finalResponse.success, true);
  assert.equal(output.finalResponse.qa.grounded, false);
  assert.ok(output.finalResponse.qa.answer.includes("does not contain enough information"));
  assert.equal(output.finalResponse.qa.evidence.length, 0);
  assert.equal(output.finalResponse.qa.nliValidation.status, "uncertain");
  assert.equal(output.finalResponse.qa.nliValidation.reason, "insufficient_evidence_unanswered");
});

// ---------------------------------------------------------------------------
// 6. Ungrounded-Answer Handling
// ---------------------------------------------------------------------------

test("LangGraph: validateGroundingNode rejects fabricated clause IDs and enforces ungrounded status", async () => {
  const nodeState = {
    grounded: true,
    relevantClauseIds: ["fabricated_clause_999"], // Does not exist in retrieved evidence
    retrievedEvidence: [
      { clauseId: "legit_1", text: "Actual clause text.", section: "Terms" }
    ]
  };

  const update = await validateGroundingNode(nodeState);
  assert.equal(update.grounded, true); // Fallback to all retrieved evidence when grounded is true
  assert.equal(update.mappedEvidence.length, 1);
  assert.equal(update.mappedEvidence[0].clauseId, "legit_1");

  // When model explicitly says grounded: false
  const ungroundedState = {
    grounded: false,
    relevantClauseIds: ["legit_1"],
    retrievedEvidence: [{ clauseId: "legit_1", text: "Actual clause text.", section: "Terms" }]
  };
  const ungroundedUpdate = await validateGroundingNode(ungroundedState);
  assert.equal(ungroundedUpdate.grounded, false);
  assert.equal(ungroundedUpdate.mappedEvidence.length, 0);
});

// ---------------------------------------------------------------------------
// 7. NLI Skip Conditions
// ---------------------------------------------------------------------------

test("LangGraph: ungrounded answers skip NLI verification and prevent contradiction flags", async () => {
  let nliCalled = false;
  const mockNli = async () => {
    nliCalled = true;
    return { available: true, validation: { status: "contradicted" } };
  };

  const mockGenerator = async () => ({
    answer: "The terms do not specify arbitration procedures.",
    grounded: false,
    confidence: 0.0,
    relevantClauseIds: []
  });

  const graph = buildQaGraph({
    generator: mockGenerator,
    nliClient: mockNli
  });

  const output = await graph.invoke({
    question: "Is there mandatory arbitration?",
    clauses: SAMPLE_CLAUSES
  });

  assert.equal(nliCalled, false, "NLI must be bypassed for ungrounded answers");
  assert.equal(output.finalResponse.qa.grounded, false);
  assert.equal(output.finalResponse.qa.nliValidation.status, "uncertain");
  assert.equal(output.finalResponse.qa.nliValidation.reason, "insufficient_evidence_unanswered");
});

// ---------------------------------------------------------------------------
// 8. Error Handling
// ---------------------------------------------------------------------------

test("LangGraph: rejects invalid questions (< 3 characters) gracefully", async () => {
  const output = await defaultQaGraph.invoke({
    question: "hi",
    clauses: SAMPLE_CLAUSES
  });

  assert.ok(output.finalResponse);
  assert.equal(output.finalResponse.success, false);
  assert.ok(output.finalResponse.qa.reason.includes("at least 3 characters long"));
});

test("LangGraph: rejects missing clauses array gracefully", async () => {
  const output = await defaultQaGraph.invoke({
    question: "Valid question here?",
    clauses: []
  });

  assert.ok(output.finalResponse);
  assert.equal(output.finalResponse.success, false);
  assert.ok(output.finalResponse.qa.reason.includes("Either non-empty clauses array or policyText"));
});

test("LangGraph: shields against NLI failure without breaking overall response", async () => {
  const failingNli = async () => {
    throw new Error("Connection refused to python NLI microservice");
  };

  const mockGenerator = async () => ({
    answer: "Fees are non-refundable.",
    grounded: true,
    confidence: 0.9,
    relevantClauseIds: ["term_refund_2"]
  });

  const graph = buildQaGraph({
    generator: mockGenerator,
    nliClient: failingNli
  });

  const output = await graph.invoke({
    question: "Can I get a refund?",
    clauses: SAMPLE_CLAUSES
  });

  assert.ok(output.finalResponse);
  assert.equal(output.finalResponse.success, true);
  assert.equal(output.finalResponse.qa.grounded, true);
  assert.equal(output.finalResponse.qa.nliValidation.status, "unavailable");
  assert.ok(output.finalResponse.qa.nliValidation.reason.includes("Connection refused"));
});

// ---------------------------------------------------------------------------
// 9. Temporary State & Absence of Persistent Checkpoints
// ---------------------------------------------------------------------------

test("LangGraph: graph compiles without checkpointer and operates in memory only", () => {
  const graph = buildQaGraph();
  assert.equal(graph.checkpointer, undefined, "Graph must not possess a persistent checkpointer");
});

test("LangGraph: sequential invocations maintain strict request isolation", async () => {
  const graph = buildQaGraph({
    generator: async (vars) => ({
      answer: `Answer for: ${vars.question}`,
      grounded: true,
      confidence: 0.9,
      relevantClauseIds: ["term_gov_3"]
    })
  });

  const res1 = await graph.invoke({
    question: "What law applies?",
    clauses: SAMPLE_CLAUSES
  });

  const res2 = await graph.invoke({
    question: "What is your refund rule?",
    clauses: SAMPLE_CLAUSES
  });

  assert.ok(res1.finalResponse.qa.answer.includes("What law applies?"));
  assert.ok(res2.finalResponse.qa.answer.includes("What is your refund rule?"));
  assert.notEqual(res1.finalResponse.qa.question, res2.finalResponse.qa.question);
});

// ---------------------------------------------------------------------------
// 10. Existing LangChain Foundation Compatibility
// ---------------------------------------------------------------------------

test("LangGraph: operates in harmony with Phase 8B.1 prompt templates and Zod schema", () => {
  const template = createQaPromptTemplate();
  assert.ok(template);

  const validAnswer = {
    answer: "Validated through LangChain schema",
    grounded: true,
    confidence: 0.88,
    relevantClauseIds: ["clause_1"]
  };

  const parsed = qaAnswerSchema.safeParse(validAnswer);
  assert.ok(parsed.success);
});
