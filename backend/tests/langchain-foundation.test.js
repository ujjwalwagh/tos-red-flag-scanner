/**
 * Phase 8B.1 — LangChain Foundation Tests.
 *
 * Verifies prompt template creation, evidence formatting, Zod structured output validation,
 * invalid payload rejection, secure model adapter configuration, and zero regression to existing Q&A.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createQaPromptTemplate,
  buildQaPromptVariables,
  formatEvidence,
  QA_SYSTEM_PROMPT,
  QA_HUMAN_PROMPT
} from "../src/rag/langchain/prompt-templates.js";
import {
  qaAnswerSchema,
  exampleStructuredSchema,
  validateQaAnswer,
  validateStructuredOutput
} from "../src/rag/langchain/output-schemas.js";
import {
  createLangChainGoogleModel,
  getModelConfigurationInfo,
  isGeminiConfigured,
  createStructuredQaModel
} from "../src/rag/langchain/model-adapter.js";
import { buildQaPrompt } from "../src/ai/providers/gemini-provider.js";
import { qaDocumentController } from "../src/api/controllers/analyze.controller.js";

// ---------------------------------------------------------------------------
// 1. Prompt Template Creation and Variable Handling
// ---------------------------------------------------------------------------

test("LangChain: formatEvidence formats structured clause objects with section names", () => {
  const evidence = [
    { clauseId: "c_1", section: "Cancellation", text: "You may cancel your subscription at any time." },
    { clauseId: "c_2", title: "Refunds", text: "Fees are strictly non-refundable." }
  ];

  const formatted = formatEvidence(evidence, "Terms of Service");
  assert.ok(formatted.includes("[Clause ID: c_1] [Section: Cancellation]"));
  assert.ok(formatted.includes("You may cancel your subscription at any time."));
  assert.ok(formatted.includes("[Clause ID: c_2] [Section: Refunds]"));
  assert.ok(formatted.includes("Fees are strictly non-refundable."));
});

test("LangChain: formatEvidence returns fallback text when evidence is empty or missing", () => {
  assert.equal(formatEvidence([]), "No relevant Terms of Service clauses were found in the document.");
  assert.equal(formatEvidence(null, "Privacy Policy"), "No relevant Privacy Policy clauses were found in the document.");
  assert.equal(formatEvidence([{ text: "   " }]), "No relevant Terms of Service clauses were found in the document.");
});

test("LangChain: buildQaPromptVariables constructs full variable dictionary", () => {
  const vars = buildQaPromptVariables({
    question: "Can I get a refund?",
    retrievedEvidence: [{ clauseId: "c_10", text: "No refunds will be provided." }],
    documentLabel: "Refund Policy"
  });

  assert.equal(vars.documentLabel, "Refund Policy");
  assert.equal(vars.documentLabelUpper, "REFUND POLICY");
  assert.equal(vars.question, "Can I get a refund?");
  assert.ok(vars.formattedEvidence.includes("[Clause ID: c_10]"));
  assert.ok(vars.formattedEvidence.includes("No refunds will be provided."));
});

test("LangChain: createQaPromptTemplate formats ChatPromptTemplate into System and Human messages", async () => {
  const template = createQaPromptTemplate();
  assert.ok(template);
  assert.equal(template.promptMessages.length, 2);

  const vars = buildQaPromptVariables({
    question: "How do I delete my account?",
    retrievedEvidence: [{ clauseId: "del_1", section: "Account Deletion", text: "Submit a request to privacy@example.com." }],
    documentLabel: "Terms of Service"
  });

  const formattedMessages = await template.formatMessages(vars);
  assert.equal(formattedMessages.length, 2);

  const [systemMsg, humanMsg] = formattedMessages;
  assert.equal(systemMsg._getType(), "system");
  assert.ok(systemMsg.content.includes("objective legal document question-answering assistant"));
  assert.ok(systemMsg.content.includes("ONLY the provided Terms of Service evidence clauses"));

  assert.equal(humanMsg._getType(), "human");
  assert.ok(humanMsg.content.includes("How do I delete my account?"));
  assert.ok(humanMsg.content.includes("[Clause ID: del_1] [Section: Account Deletion]"));
});

// ---------------------------------------------------------------------------
// 2. Zod Structured Output Schema Validation
// ---------------------------------------------------------------------------

test("LangChain: qaAnswerSchema accepts a valid, fully supported Q&A answer", () => {
  const validPayload = {
    answer: "You may cancel your subscription anytime via account settings.",
    grounded: true,
    confidence: 0.92,
    relevantClauseIds: ["clause_1", "clause_2"]
  };

  const parseResult = qaAnswerSchema.safeParse(validPayload);
  assert.ok(parseResult.success);
  assert.equal(parseResult.data.answer, validPayload.answer);
  assert.equal(parseResult.data.grounded, true);
  assert.equal(parseResult.data.confidence, 0.92);
  assert.deepEqual(parseResult.data.relevantClauseIds, ["clause_1", "clause_2"]);
});

test("LangChain: qaAnswerSchema accepts a valid ungrounded refusal response", () => {
  const refusalPayload = {
    answer: "The provided Terms of Service evidence does not contain information regarding arbitration.",
    grounded: false,
    confidence: 0.0,
    relevantClauseIds: []
  };

  const validation = validateQaAnswer(refusalPayload);
  assert.ok(validation.success);
  assert.equal(validation.data.grounded, false);
  assert.deepEqual(validation.data.relevantClauseIds, []);
});

test("LangChain: exampleStructuredSchema validates test structured objects", () => {
  const sample = {
    summary: "Standard unilateral change clause without mandatory prior notice.",
    isCompliant: false,
    riskScore: 7.5
  };

  const res = validateStructuredOutput(exampleStructuredSchema, sample);
  assert.ok(res.success);
  assert.equal(res.data.riskScore, 7.5);
  assert.equal(res.data.isCompliant, false);
});

// ---------------------------------------------------------------------------
// 3. Invalid Structured Output Rejection
// ---------------------------------------------------------------------------

test("LangChain: qaAnswerSchema rejects missing answer field", () => {
  const invalid = {
    grounded: true,
    confidence: 0.8,
    relevantClauseIds: ["c1"]
  };

  const res = validateQaAnswer(invalid);
  assert.equal(res.success, false);
  assert.ok(res.errors.some((err) => err.includes("answer")));
});

test("LangChain: qaAnswerSchema rejects empty answer string", () => {
  const invalid = {
    answer: "",
    grounded: true,
    confidence: 0.8,
    relevantClauseIds: ["c1"]
  };

  const res = validateQaAnswer(invalid);
  assert.equal(res.success, false);
  assert.ok(res.errors.some((err) => err.includes("answer")));
});

test("LangChain: qaAnswerSchema rejects invalid confidence boundaries (< 0 or > 1)", () => {
  const negativeConf = {
    answer: "Valid text",
    grounded: true,
    confidence: -0.1,
    relevantClauseIds: []
  };
  assert.equal(validateQaAnswer(negativeConf).success, false);

  const excessiveConf = {
    answer: "Valid text",
    grounded: true,
    confidence: 1.05,
    relevantClauseIds: []
  };
  assert.equal(validateQaAnswer(excessiveConf).success, false);
});

test("LangChain: qaAnswerSchema rejects non-boolean grounded status", () => {
  const invalid = {
    answer: "Valid answer",
    grounded: "yes",
    confidence: 0.5,
    relevantClauseIds: []
  };

  const res = validateQaAnswer(invalid);
  assert.equal(res.success, false);
  assert.ok(res.errors.some((err) => err.includes("grounded")));
});

// ---------------------------------------------------------------------------
// 4. Model Adapter Configuration Without Exposing API Keys
// ---------------------------------------------------------------------------

test("LangChain: createLangChainGoogleModel initializes without throwing or leaking keys", () => {
  const fakeSecret = "AIzaSySecretTestKey123456";
  const model = createLangChainGoogleModel({
    model: "gemini-2.5-pro",
    apiKey: fakeSecret,
    temperature: 0.2,
    maxOutputTokens: 600
  });

  assert.ok(model);
  assert.equal(model.model, "gemini-2.5-pro");

  // Inspect configuration safely via helper
  const info = getModelConfigurationInfo(model, { apiKey: fakeSecret });
  assert.equal(info.provider, "google");
  assert.equal(info.model, "gemini-2.5-pro");
  assert.equal(info.temperature, 0.2);
  assert.equal(info.maxOutputTokens, 600);
  assert.equal(info.hasApiKey, true);

  // CRITICAL SECURITY CHECK: Ensure secret key string is NOT present in returned metadata
  const stringified = JSON.stringify(info);
  assert.equal(stringified.includes(fakeSecret), false, "Secret key must not appear in diagnostic info");
});

test("LangChain: isGeminiConfigured accurately detects key availability without returning key", () => {
  assert.equal(isGeminiConfigured({ apiKey: "" }), false);
  assert.equal(isGeminiConfigured({ apiKey: "   " }), false);
  assert.equal(isGeminiConfigured({ apiKey: "AIzaValidFakeKey" }), true);
});

test("LangChain: createStructuredQaModel attaches structured output runnable without live API call", () => {
  const structuredRunnable = createStructuredQaModel({
    apiKey: "dummy-key-for-unit-test"
  });

  assert.ok(structuredRunnable);
  assert.equal(typeof structuredRunnable.invoke, "function");
});

// ---------------------------------------------------------------------------
// 5. Existing Q&A Behavior Remains Untouched
// ---------------------------------------------------------------------------

test("Existing Q&A: buildQaPrompt from gemini-provider.js remains intact and identical", () => {
  const prompt = buildQaPrompt({
    question: "Can I terminate my account?",
    retrievedEvidence: [{ clauseId: "term_1", text: "Either party may terminate at will." }],
    documentLabel: "User Agreement"
  });

  assert.ok(prompt.includes("You are analyzing User Agreement clauses to answer a user question."));
  assert.ok(prompt.includes("[Clause ID: term_1]:"));
  assert.ok(prompt.includes("Can I terminate my account?"));
  assert.ok(prompt.includes('"relevantClauseIds": ["clause_1"]'));
});

test("Existing Q&A: qaDocumentController maintains input validation contract", async () => {
  let errorCaught = null;
  const mockReq = { body: { question: "hi" } }; // too short (< 3 chars)
  const mockRes = {};
  const mockNext = (err) => { errorCaught = err; };

  await qaDocumentController(mockReq, mockRes, mockNext);

  assert.ok(errorCaught);
  assert.equal(errorCaught.statusCode, 400);
  assert.ok(errorCaught.message.includes("Question must be at least 3 characters long"));
});
