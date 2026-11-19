/**
 * Phase 8B.3 — Q&A Dual-Engine Controller Integration Tests.
 *
 * Verifies feature flag defaults, engine switching, non-breaking fallback,
 * call count guarantees (zero duplicate Gemini/NLI calls), API contract parity,
 * grounding handling, document isolation, and zero persistent state.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { qaDocumentController } from "../src/api/controllers/analyze.controller.js";

const SAMPLE_CLAUSES = [
  {
    clauseId: "c_cancel_1",
    section: "Subscriptions",
    text: "You can cancel your recurring plan anytime in account settings."
  },
  {
    clauseId: "c_refund_2",
    section: "Refunds",
    text: "All payments are non-refundable."
  }
];

function createMockReqRes(body = {}, locals = {}) {
  const req = {
    body,
    app: {
      locals
    }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  let nextCalledWith = null;
  const next = (err) => {
    nextCalledWith = err;
  };

  return {
    req,
    res,
    next,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
    getNextError: () => nextCalledWith
  };
}

// ---------------------------------------------------------------------------
// 1. Feature Flag Defaults to False
// ---------------------------------------------------------------------------

test("Dual-Engine: feature flag enableLangGraphQa defaults to false", () => {
  assert.equal(typeof config.ai.enableLangGraphQa, "boolean");
  assert.equal(config.ai.enableLangGraphQa, false, "LangGraph must not be enabled by default");
});

// ---------------------------------------------------------------------------
// 2. Existing Engine Runs When Flag is False
// ---------------------------------------------------------------------------

test("Dual-Engine: existing procedural engine runs when enableLangGraphQa is false", async () => {
  const originalFlag = config.ai.enableLangGraphQa;
  config.ai.enableLangGraphQa = false;

  let providerCalled = false;
  const mockProvider = {
    answerQuestion: async (ctx) => {
      providerCalled = true;
      return {
        available: true,
        data: {
          answer: "Procedural engine answer: cancel anytime.",
          grounded: true,
          confidence: 0.9,
          relevantClauseIds: ["c_cancel_1"]
        }
      };
    }
  };

  const mockClient = {
    withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
    validateNli: async () => ({
      available: true,
      validation: { status: "supported", label: "entailment", scores: { entailment: 0.9, contradiction: 0.05, neutral: 0.05 } }
    })
  };

  const { req, res, next, getStatusCode, getResponseData } = createMockReqRes(
    { question: "How do I cancel?", clauses: SAMPLE_CLAUSES, documentType: "TERMS" },
    { aiProvider: mockProvider, aiClient: mockClient }
  );

  try {
    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 200);
    assert.equal(providerCalled, true);
    const data = getResponseData();
    assert.ok(data.success);
    assert.ok(data.qa.answer.includes("Procedural engine answer"));
    assert.equal(data.qa.grounded, true);
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 3. LangGraph Runs When Flag is True
// ---------------------------------------------------------------------------

test("Dual-Engine: LangGraph state machine handles request when enableLangGraphQa is true", async () => {
  const originalFlag = config.ai.enableLangGraphQa;
  config.ai.enableLangGraphQa = true;

  let providerCalls = 0;
  const mockProvider = {
    answerQuestion: async (ctx) => {
      providerCalls++;
      return {
        available: true,
        data: {
          answer: "LangGraph engine answer: cancel anytime.",
          grounded: true,
          confidence: 0.92,
          relevantClauseIds: ["c_cancel_1"]
        }
      };
    }
  };

  let nliCalls = 0;
  const mockClient = {
    withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
    validateNli: async () => {
      nliCalls++;
      return {
        available: true,
        validation: { status: "supported", label: "entailment", scores: { entailment: 0.92, contradiction: 0.04, neutral: 0.04 } }
      };
    }
  };

  const { req, res, next, getStatusCode, getResponseData } = createMockReqRes(
    { question: "How do I cancel?", clauses: SAMPLE_CLAUSES, documentType: "TERMS" },
    { aiProvider: mockProvider, aiClient: mockClient }
  );

  try {
    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 200);
    assert.equal(providerCalls, 1, "Gemini must be called exactly once via LangGraph");
    assert.equal(nliCalls, 1, "NLI must be called exactly once via LangGraph");

    const data = getResponseData();
    assert.ok(data.success);
    assert.ok(data.qa.answer.includes("LangGraph engine answer"));
    assert.equal(data.qa.grounded, true);
    assert.equal(data.qa.nliValidation.status, "supported");
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 4. Existing Fallback Works When Graph Execution Fails
// ---------------------------------------------------------------------------

test("Dual-Engine: falls back seamlessly to procedural engine if LangGraph throws", async () => {
  const originalFlag = config.ai.enableLangGraphQa;
  config.ai.enableLangGraphQa = true;

  let callCount = 0;
  const mockProvider = {
    answerQuestion: async (ctx) => {
      callCount++;
      return {
        available: true,
        data: {
          answer: "Fallback engine recovered answer.",
          grounded: true,
          confidence: 0.85,
          relevantClauseIds: ["c_cancel_1"]
        }
      };
    }
  };

  // Create client that triggers a failure during LangGraph invocation
  let throwOnFirst = true;
  const mockClient = {
    withDocumentVectors: async (sessionId, clauses, cb) => {
      if (throwOnFirst) {
        throwOnFirst = false;
        throw new Error("Simulated LangGraph internal failure");
      }
      return cb({ success: false });
    },
    validateNli: async () => ({
      available: true,
      validation: { status: "supported", label: "entailment", scores: { entailment: 0.85, contradiction: 0.05, neutral: 0.1 } }
    })
  };

  const { req, res, next, getStatusCode, getResponseData } = createMockReqRes(
    { question: "Can I cancel?", clauses: SAMPLE_CLAUSES, documentType: "TERMS" },
    { aiProvider: mockProvider, aiClient: mockClient }
  );

  try {
    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 200);
    const data = getResponseData();
    assert.ok(data.success);
    assert.ok(data.qa.answer.includes("Fallback engine recovered answer"));
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 5. No Duplicate Gemini Calls
// ---------------------------------------------------------------------------

test("Dual-Engine: Gemini model is called exactly once per request across both engines", async () => {
  const originalFlag = config.ai.enableLangGraphQa;

  for (const flagValue of [false, true]) {
    config.ai.enableLangGraphQa = flagValue;
    let geminiCalls = 0;

    const mockProvider = {
      answerQuestion: async () => {
        geminiCalls++;
        return {
          available: true,
          data: { answer: "Test answer", grounded: true, confidence: 0.9, relevantClauseIds: ["c_cancel_1"] }
        };
      }
    };

    const mockClient = {
      withDocumentVectors: async (s, c, cb) => cb({ success: false }),
      validateNli: async () => ({ available: true, validation: { status: "supported" } })
    };

    const { req, res, next } = createMockReqRes(
      { question: "Can I cancel?", clauses: SAMPLE_CLAUSES },
      { aiProvider: mockProvider, aiClient: mockClient }
    );

    await qaDocumentController(req, res, next);
    assert.equal(geminiCalls, 1, `Gemini calls must be 1 when enableLangGraphQa=${flagValue}`);
  }

  config.ai.enableLangGraphQa = originalFlag;
});

// ---------------------------------------------------------------------------
// 6. No Duplicate NLI Calls & NLI Bypassed on Ungrounded
// ---------------------------------------------------------------------------

test("Dual-Engine: NLI is called at most once, and skipped when ungrounded", async () => {
  const originalFlag = config.ai.enableLangGraphQa;
  config.ai.enableLangGraphQa = true;

  let nliCalls = 0;
  const mockProvider = {
    answerQuestion: async () => ({
      available: true,
      data: { answer: "Refusal: not mentioned in terms.", grounded: false, confidence: 0.0, relevantClauseIds: [] }
    })
  };

  const mockClient = {
    withDocumentVectors: async (s, c, cb) => cb({ success: false }),
    validateNli: async () => {
      nliCalls++;
      return { available: true };
    }
  };

  const { req, res, next, getResponseData } = createMockReqRes(
    { question: "What is the arbitration clause?", clauses: SAMPLE_CLAUSES },
    { aiProvider: mockProvider, aiClient: mockClient }
  );

  try {
    await qaDocumentController(req, res, next);
    assert.equal(nliCalls, 0, "NLI must be bypassed when answer is ungrounded");
    const data = getResponseData();
    assert.equal(data.qa.grounded, false);
    assert.equal(data.qa.nliValidation.status, "uncertain");
    assert.equal(data.qa.nliValidation.reason, "insufficient_evidence_unanswered");
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 7. API Response Contract Remains Compatible
// ---------------------------------------------------------------------------

test("Dual-Engine: API response contract parity between procedural and LangGraph engines", async () => {
  const originalFlag = config.ai.enableLangGraphQa;

  const runWithFlag = async (flag) => {
    config.ai.enableLangGraphQa = flag;
    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: { answer: "Plan cancel policy.", grounded: true, confidence: 0.9, relevantClauseIds: ["c_cancel_1"] }
      })
    };
    const mockClient = {
      withDocumentVectors: async (s, c, cb) => cb({ success: false }),
      validateNli: async () => ({ available: true, validation: { status: "supported", bestClauseId: "c_cancel_1" } })
    };
    const { req, res, next, getResponseData } = createMockReqRes(
      { question: "Can I cancel?", clauses: SAMPLE_CLAUSES, documentType: "TERMS", documentLabel: "Terms of Service" },
      { aiProvider: mockProvider, aiClient: mockClient }
    );
    await qaDocumentController(req, res, next);
    return getResponseData();
  };

  try {
    const proceduralResp = await runWithFlag(false);
    const langGraphResp = await runWithFlag(true);

    // Verify root keys
    assert.equal(proceduralResp.success, langGraphResp.success);
    assert.deepEqual(Object.keys(proceduralResp).sort(), Object.keys(langGraphResp).sort());

    // Verify qa payload keys
    const procQaKeys = Object.keys(proceduralResp.qa).sort();
    const graphQaKeys = Object.keys(langGraphResp.qa).sort();
    assert.deepEqual(procQaKeys, graphQaKeys);

    // Verify key fields
    assert.equal(typeof langGraphResp.qa.question, "string");
    assert.equal(typeof langGraphResp.qa.answer, "string");
    assert.equal(typeof langGraphResp.qa.grounded, "boolean");
    assert.equal(typeof langGraphResp.qa.confidence, "number");
    assert.equal(Array.isArray(langGraphResp.qa.evidence), true);
    assert.equal(typeof langGraphResp.qa.nliValidation, "object");
    assert.equal(langGraphResp.qa.documentLabel, "Terms of Service");
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 8. Terms and Privacy Policy Document Isolation
// ---------------------------------------------------------------------------

test("Dual-Engine: preserves Terms and Privacy Policy document isolation and labeling", async () => {
  const originalFlag = config.ai.enableLangGraphQa;
  config.ai.enableLangGraphQa = true;

  const mockProvider = {
    answerQuestion: async (ctx) => ({
      available: true,
      data: { answer: `Answer for ${ctx.documentLabel}`, grounded: true, confidence: 0.9, relevantClauseIds: ["c1"] }
    })
  };
  const mockClient = {
    withDocumentVectors: async (s, c, cb) => cb({ success: false }),
    validateNli: async () => ({ available: true, validation: { status: "supported" } })
  };

  try {
    // Privacy request
    const privacyRes = createMockReqRes(
      { question: "Do you share data?", clauses: [{ clauseId: "c1", section: "Privacy", text: "We do not sell personal data." }], documentType: "PRIVACY" },
      { aiProvider: mockProvider, aiClient: mockClient }
    );
    await qaDocumentController(privacyRes.req, privacyRes.res, privacyRes.next);
    assert.equal(privacyRes.getResponseData().qa.documentLabel, "Privacy Policy");

    // Terms request
    const termsRes = createMockReqRes(
      { question: "How do I cancel?", clauses: [{ clauseId: "c1", section: "Billing", text: "Cancel anytime." }], documentType: "TERMS" },
      { aiProvider: mockProvider, aiClient: mockClient }
    );
    await qaDocumentController(termsRes.req, termsRes.res, termsRes.next);
    assert.equal(termsRes.getResponseData().qa.documentLabel, "Terms of Service");
  } finally {
    config.ai.enableLangGraphQa = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// 9. Input Validation Error Handling
// ---------------------------------------------------------------------------

test("Dual-Engine: input validation contracts are enforced before engine selection", async () => {
  // Question too short (< 3 chars)
  const shortQ = createMockReqRes({ question: "no", clauses: SAMPLE_CLAUSES });
  await qaDocumentController(shortQ.req, shortQ.res, shortQ.next);
  assert.ok(shortQ.getNextError());
  assert.equal(shortQ.getNextError().statusCode, 400);

  // Missing clauses and policyText
  const noContext = createMockReqRes({ question: "Valid question here?" });
  await qaDocumentController(noContext.req, noContext.res, noContext.next);
  assert.ok(noContext.getNextError());
  assert.equal(noContext.getNextError().statusCode, 400);
});
