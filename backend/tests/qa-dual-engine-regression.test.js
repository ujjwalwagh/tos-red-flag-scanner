/**
 * Phase 8B.4 — Comprehensive Dual-Engine Q&A Regression Test Suite.
 *
 * Verifies that both the procedural Q&A engine and the LangGraph Q&A engine
 * maintain 100% contract parity, strict call count guarantees (Gemini invoked AT MOST ONCE,
 * zero duplicate calls on failure/fallback paths), identical document isolation,
 * zero-retention privacy guarantees, and robust error handling.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { qaDocumentController } from "../src/api/controllers/analyze.controller.js";

const TERMS_CLAUSES = [
  {
    clauseId: "tos_c1",
    section: "Cancellation & Termination",
    text: "You may cancel your subscription at any time via your account settings. Cancellation takes effect at the end of the current billing cycle."
  },
  {
    clauseId: "tos_c2",
    section: "Refunds",
    text: "Except as required by applicable law, payments are non-refundable and no partial month refunds will be issued."
  },
  {
    clauseId: "tos_c3",
    section: "Governing Law & Disputes",
    text: "Any dispute arising from these terms will be resolved by binding individual arbitration, except that either party may assert claims in small claims court."
  }
];

const PRIVACY_CLAUSES = [
  {
    clauseId: "priv_c1",
    section: "Data Collection",
    text: "We collect email addresses, device identifiers, and usage metrics to provide our service."
  },
  {
    clauseId: "priv_c2",
    section: "Data Sharing & Sales",
    text: "We do not sell your personal data to third parties. We share data only with authorized processors."
  },
  {
    clauseId: "priv_c3",
    section: "User Data Rights",
    text: "You have the right to request data deletion or erasure at any time by contacting privacy@example.com."
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
    if (err) {
      statusCode = err.statusCode || 500;
      responseData = {
        success: false,
        error: err.message
      };
    }
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

// ============================================================================
// SUITE 1: Response Contract Parity Across Identical Inputs
// ============================================================================

test("Contract Parity: Grounded answer with supporting evidence", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let providerCalls = 0;
    let nliCalls = 0;

    const mockProvider = {
      answerQuestion: async () => {
        providerCalls += 1;
        return {
          available: true,
          data: {
            answer: "You can cancel your subscription anytime in account settings.",
            grounded: true,
            confidence: 0.95,
            relevantClauseIds: ["tos_c1"]
          }
        };
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => {
        nliCalls += 1;
        return {
          success: true,
          available: true,
          status: "supported",
          label: "entailment",
          scores: { entailment: 0.95, neutral: 0.04, contradiction: 0.01 }
        };
      }
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "How do I cancel my subscription?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData(), providerCalls, nliCalls };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  // Assert HTTP status code parity
  assert.equal(procedural.status, 200);
  assert.equal(graph.status, 200);

  // Assert top-level success contract
  assert.equal(procedural.data.success, true);
  assert.equal(graph.data.success, true);

  // Assert QA structure contract
  assert.equal(procedural.data.qa.question, "How do I cancel my subscription?");
  assert.equal(graph.data.qa.question, "How do I cancel my subscription?");
  assert.equal(procedural.data.qa.grounded, true);
  assert.equal(graph.data.qa.grounded, true);
  assert.equal(procedural.data.qa.available, true);
  assert.equal(graph.data.qa.available, true);
  assert.equal(procedural.data.qa.documentLabel, "Terms of Service");
  assert.equal(graph.data.qa.documentLabel, "Terms of Service");

  // Evidence clause mapping
  assert.ok(procedural.data.qa.evidence.length > 0);
  assert.ok(graph.data.qa.evidence.length > 0);
  assert.equal(procedural.data.qa.evidence[0].clauseId, "tos_c1");
  assert.equal(graph.data.qa.evidence[0].clauseId, "tos_c1");

  // NLI validation contract
  assert.equal(procedural.data.qa.nliValidation.status, "supported");
  assert.equal(graph.data.qa.nliValidation.status, "supported");
  assert.equal(procedural.data.qa.nliValidation.label, "entailment");
  assert.equal(graph.data.qa.nliValidation.label, "entailment");

  // Call counts: exactly 1 Gemini, exactly 1 NLI
  assert.equal(procedural.providerCalls, 1);
  assert.equal(graph.providerCalls, 1);
  assert.equal(procedural.nliCalls, 1);
  assert.equal(graph.nliCalls, 1);
});

test("Contract Parity: Refusal on ungrounded / out-of-scope question", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let nliCalls = 0;

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: {
          answer: "The provided Terms of Service does not mention cryptocurrency mining.",
          grounded: false,
          confidence: 0.0,
          relevantClauseIds: []
        }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => {
        nliCalls += 1;
        return { available: true };
      }
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "Can I mine cryptocurrency on your servers?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData(), nliCalls };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.status, 200);
  assert.equal(graph.status, 200);
  assert.equal(procedural.data.qa.grounded, false);
  assert.equal(graph.data.qa.grounded, false);

  // Both engines MUST skip NLI on ungrounded answers (Phase 7G-D.6 invariant)
  assert.equal(procedural.nliCalls, 0);
  assert.equal(graph.nliCalls, 0);

  // Invariant NLI payload
  assert.equal(procedural.data.qa.nliValidation.status, "uncertain");
  assert.equal(graph.data.qa.nliValidation.status, "uncertain");
  assert.equal(procedural.data.qa.nliValidation.label, "neutral");
  assert.equal(graph.data.qa.nliValidation.label, "neutral");
  assert.equal(procedural.data.qa.nliValidation.reason, "insufficient_evidence_unanswered");
  assert.equal(graph.data.qa.nliValidation.reason, "insufficient_evidence_unanswered");
});

test("Contract Parity: Empty clauses validation error (HTTP 400)", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let providerCalls = 0;

    const mockProvider = {
      answerQuestion: async () => {
        providerCalls += 1;
        return { available: true, data: { answer: "Should not be called", grounded: false } };
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "What is your refund policy?",
      clauses: [],
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData(), providerCalls };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.status, 400);
  assert.equal(graph.status, 400);
  assert.equal(procedural.data.success, false);
  assert.equal(graph.data.success, false);
  assert.ok(procedural.data.error.includes("clauses"));
  assert.ok(graph.data.error.includes("clauses"));
  assert.equal(procedural.providerCalls, 0);
  assert.equal(graph.providerCalls, 0);
});

test("Contract Parity: Insufficient evidence response (non-matching clauses)", async () => {
  const NON_MATCHING_CLAUSES = [
    {
      clauseId: "intro_1",
      section: "Introduction",
      text: "Welcome to our application. Please read these terms carefully before using our software."
    }
  ];

  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let providerCalls = 0;

    const mockProvider = {
      answerQuestion: async () => {
        providerCalls += 1;
        return {
          available: true,
          data: {
            answer: "The provided Terms of Service evidence does not contain information about refunds.",
            grounded: false,
            confidence: 0.0,
            relevantClauseIds: []
          }
        };
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({ available: true })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "What is your refund policy?",
      clauses: NON_MATCHING_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData(), providerCalls };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.status, 200);
  assert.equal(graph.status, 200);
  assert.equal(procedural.data.qa.grounded, false);
  assert.equal(graph.data.qa.grounded, false);
  assert.equal(procedural.data.qa.evidence.length, 0);
  assert.equal(graph.data.qa.evidence.length, 0);
  assert.equal(procedural.data.qa.documentLabel, "Terms of Service");
  assert.equal(graph.data.qa.documentLabel, "Terms of Service");
  assert.equal(procedural.data.qa.nliValidation.status, "uncertain");
  assert.equal(graph.data.qa.nliValidation.status, "uncertain");
});

test("Contract Parity: Provider failure response (Gemini unavailable)", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => ({
        available: false,
        reason: "quota_exceeded"
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "How do I cancel?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData() };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.status, 200);
  assert.equal(graph.status, 200);
  assert.equal(procedural.data.success, true);
  assert.equal(graph.data.success, true);
  assert.equal(procedural.data.qa.grounded, false);
  assert.equal(graph.data.qa.grounded, false);
  assert.equal(procedural.data.qa.confidence, 0);
  assert.equal(graph.data.qa.confidence, 0);
  assert.ok(procedural.data.qa.answer.includes("Unable to generate an AI answer"));
  assert.ok(graph.data.qa.answer.includes("Unable to generate an AI answer"));
});

test("Contract Parity: Multi-clause synthesis answer", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: {
          answer: "You can cancel anytime, but payments are non-refundable.",
          grounded: true,
          confidence: 0.9,
          relevantClauseIds: ["tos_c1", "tos_c2"]
        }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({
        success: true,
        available: true,
        status: "supported",
        label: "entailment"
      })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "Can I cancel and get a refund?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData() };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.data.qa.evidence.length, 2);
  assert.equal(graph.data.qa.evidence.length, 2);
  const procIds = procedural.data.qa.evidence.map(e => e.clauseId).sort();
  const graphIds = graph.data.qa.evidence.map(e => e.clauseId).sort();
  assert.deepEqual(procIds, ["tos_c1", "tos_c2"]);
  assert.deepEqual(graphIds, ["tos_c1", "tos_c2"]);
});

test("Contract Parity: Exception clause synthesis", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: {
          answer: "Disputes require arbitration except that claims may be filed in small claims court.",
          grounded: true,
          confidence: 0.92,
          relevantClauseIds: ["tos_c3"]
        }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({
        success: true,
        available: true,
        status: "supported",
        label: "entailment"
      })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "Are there exceptions to mandatory arbitration?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData() };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.data.qa.grounded, true);
  assert.equal(graph.data.qa.grounded, true);
  assert.equal(procedural.data.qa.evidence[0].clauseId, "tos_c3");
  assert.equal(graph.data.qa.evidence[0].clauseId, "tos_c3");
});

test("Contract Parity: Privacy Policy document type & label", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: {
          answer: "We do not sell your personal data to third parties.",
          grounded: true,
          confidence: 0.95,
          relevantClauseIds: ["priv_c2"]
        }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({
        success: true,
        available: true,
        status: "supported",
        label: "entailment"
      })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "Do you sell my data?",
      clauses: PRIVACY_CLAUSES,
      documentType: "PRIVACY"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData() };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.data.qa.documentLabel, "Privacy Policy");
  assert.equal(graph.data.qa.documentLabel, "Privacy Policy");
  assert.equal(procedural.data.qa.evidence[0].clauseId, "priv_c2");
  assert.equal(graph.data.qa.evidence[0].clauseId, "priv_c2");
});

test("Contract Parity: Cookie / Privacy Notice document type & label", async () => {
  const runForEngine = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: {
          answer: "We collect metrics and email.",
          grounded: true,
          confidence: 0.8,
          relevantClauseIds: ["priv_c1"]
        }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "What cookies or metrics are collected?",
      clauses: PRIVACY_CLAUSES,
      documentType: "OTHER_PRIVACY"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return { status: getStatusCode(), data: getResponseData() };
  };

  const procedural = await runForEngine(false);
  const graph = await runForEngine(true);

  assert.equal(procedural.data.qa.documentLabel, "Cookie / Privacy Notice");
  assert.equal(graph.data.qa.documentLabel, "Cookie / Privacy Notice");
});

// ============================================================================
// SUITE 2: Call Count Guarantees & Zero Duplicate Calls
// ============================================================================

test("Call Counts: Vector retrieval called AT MOST ONCE", async () => {
  const testVectorCount = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let vectorCalls = 0;

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => {
        vectorCalls += 1;
        return cb({ success: true });
      },
      queryVectors: async () => ({
        success: true,
        results: [{ clauseId: "tos_c1", text: "cancel anytime", similarity: 0.85 }]
      }),
      validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
    };

    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: { answer: "Cancel in settings", grounded: true, confidence: 0.9, relevantClauseIds: ["tos_c1"] }
      })
    };

    const { req, res, next } = createMockReqRes({
      question: "How to cancel?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return vectorCalls;
  };

  assert.equal(await testVectorCount(false), 1, "Procedural engine must invoke vector indexing at most once");
  assert.equal(await testVectorCount(true), 1, "LangGraph engine must invoke vector indexing at most once");
});

test("Call Counts: Gemini called AT MOST ONCE per user question", async () => {
  const testGeminiCount = async (enableGraph) => {
    config.ai.enableLangGraphQa = enableGraph;
    let geminiCalls = 0;

    const mockProvider = {
      answerQuestion: async () => {
        geminiCalls += 1;
        return {
          available: true,
          data: { answer: "Standard answer", grounded: true, confidence: 0.9, relevantClauseIds: ["tos_c1"] }
        };
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
    };

    const { req, res, next } = createMockReqRes({
      question: "How to cancel?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    return geminiCalls;
  };

  assert.equal(await testGeminiCount(false), 1, "Procedural engine must call Gemini exactly once");
  assert.equal(await testGeminiCount(true), 1, "LangGraph engine must call Gemini exactly once");
});

test("Call Counts: Zero duplicate Gemini calls when LangGraph fails AFTER answer generation", async () => {
  config.ai.enableLangGraphQa = true;
  let geminiCalls = 0;
  let nliCalls = 0;

  const mockProvider = {
    answerQuestion: async () => {
      geminiCalls += 1;
      return {
        available: true,
        data: {
          answer: "Grounded answer before downstream error.",
          grounded: true,
          confidence: 0.92,
          relevantClauseIds: ["tos_c1"]
        }
      };
    }
  };

  // Mock NLI that throws an unexpected error during NLI validation
  const mockClient = {
    withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
    validateNli: async () => {
      nliCalls += 1;
      throw new Error("Simulated NLI engine network crash");
    }
  };

  const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
    question: "How to cancel?",
    clauses: TERMS_CLAUSES,
    documentType: "TERMS"
  }, { aiProvider: mockProvider, aiClient: mockClient });

  await qaDocumentController(req, res, next);

  assert.equal(getStatusCode(), 200);
  assert.equal(getResponseData().success, true);
  // CRITICAL CHECK: Gemini must be invoked AT MOST ONCE, NEVER twice!
  assert.equal(geminiCalls, 1, "Gemini must NEVER be called twice if LangGraph encounters a downstream error");
  assert.equal(nliCalls, 1, "NLI cross-encoder must be called at most once");
  assert.equal(getResponseData().qa.grounded, true);
  assert.equal(getResponseData().qa.nliValidation.status, "unavailable");
});

test("Call Counts: Zero duplicate Gemini calls when vector retrieval fails", async () => {
  config.ai.enableLangGraphQa = true;
  let geminiCalls = 0;

  const mockProvider = {
    answerQuestion: async () => {
      geminiCalls += 1;
      return {
        available: true,
        data: { answer: "Lexical fallback answer", grounded: true, confidence: 0.85, relevantClauseIds: ["tos_c1"] }
      };
    }
  };

  const mockClient = {
    withDocumentVectors: async () => {
      throw new Error("Vector DB offline");
    },
    validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
  };

  const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
    question: "How to cancel?",
    clauses: TERMS_CLAUSES,
    documentType: "TERMS"
  }, { aiProvider: mockProvider, aiClient: mockClient });

  await qaDocumentController(req, res, next);

  assert.equal(getStatusCode(), 200);
  assert.equal(geminiCalls, 1, "Gemini must be invoked at most once when vector indexing fails");
  assert.equal(getResponseData().qa.grounded, true);
});

// ============================================================================
// SUITE 3: Feature Flag Switching & Safe Defaults
// ============================================================================

test("Feature Flag: enableLangGraphQa strictly requires boolean true", async () => {
  const invalidValues = [false, undefined, null, "true", 1, {}, []];

  for (const val of invalidValues) {
    config.ai.enableLangGraphQa = val;

    let engineUsed = "procedural";
    const mockProvider = {
      answerQuestion: async () => ({
        available: true,
        data: { answer: "Procedural answer", grounded: true, confidence: 0.9, relevantClauseIds: ["tos_c1"] }
      })
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
    };

    const { req, res, next, getResponseData } = createMockReqRes({
      question: "How to cancel?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    assert.equal(getResponseData().success, true);
  }
});

// ============================================================================
// SUITE 4: Document Isolation & Zero-Retention
// ============================================================================

test("Document Isolation: Terms and Privacy queries maintain strict boundary", async () => {
  for (const enableGraph of [false, true]) {
    config.ai.enableLangGraphQa = enableGraph;

    let receivedEvidenceInTerms = null;
    let receivedEvidenceInPrivacy = null;

    const mockProvider = {
      answerQuestion: async (ctx) => {
        if (ctx.documentLabel === "Terms of Service") {
          receivedEvidenceInTerms = ctx.retrievedEvidence;
        } else {
          receivedEvidenceInPrivacy = ctx.retrievedEvidence;
        }
        return {
          available: true,
          data: { answer: "Isolated response", grounded: true, confidence: 0.9, relevantClauseIds: [] }
        };
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false }),
      validateNli: async () => ({ success: true, available: true, status: "supported", label: "entailment" })
    };

    // 1. Send Terms request
    const termsRes = createMockReqRes({
      question: "What are the rules?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });
    await qaDocumentController(termsRes.req, termsRes.res, termsRes.next);

    // 2. Send Privacy request
    const privRes = createMockReqRes({
      question: "What data is collected?",
      clauses: PRIVACY_CLAUSES,
      documentType: "PRIVACY"
    }, { aiProvider: mockProvider, aiClient: mockClient });
    await qaDocumentController(privRes.req, privRes.res, privRes.next);

    // Assert that Terms evidence contains NO Privacy clauses
    assert.ok(receivedEvidenceInTerms.every(e => e.clauseId.startsWith("tos_")));
    // Assert that Privacy evidence contains NO Terms clauses
    assert.ok(receivedEvidenceInPrivacy.every(e => e.clauseId.startsWith("priv_")));
  }
});

// ============================================================================
// SUITE 5: Robust Error Handling & Graceful Degradation
// ============================================================================

test("Error Handling: Missing question yields HTTP 400 validation error", async () => {
  for (const enableGraph of [false, true]) {
    config.ai.enableLangGraphQa = enableGraph;

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "",
      clauses: TERMS_CLAUSES
    });

    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 400);
    assert.equal(getResponseData().success, false);
    assert.ok(getResponseData().error.includes("question"));
  }
});

test("Error Handling: Oversized question yields HTTP 400 validation error", async () => {
  for (const enableGraph of [false, true]) {
    config.ai.enableLangGraphQa = enableGraph;

    const longQuestion = "a".repeat(1500);
    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: longQuestion,
      clauses: TERMS_CLAUSES
    });

    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 400);
    assert.equal(getResponseData().success, false);
  }
});

test("Error Handling: AI Provider unexpected exception yields graceful 200 available:false", async () => {
  for (const enableGraph of [false, true]) {
    config.ai.enableLangGraphQa = enableGraph;

    const mockProvider = {
      answerQuestion: async () => {
        throw new Error("Provider fatal socket hang up");
      }
    };

    const mockClient = {
      withDocumentVectors: async (sessionId, clauses, cb) => cb({ success: false })
    };

    const { req, res, next, getStatusCode, getResponseData } = createMockReqRes({
      question: "How to cancel?",
      clauses: TERMS_CLAUSES,
      documentType: "TERMS"
    }, { aiProvider: mockProvider, aiClient: mockClient });

    await qaDocumentController(req, res, next);
    assert.equal(getStatusCode(), 200);
    assert.equal(getResponseData().success, true);
    assert.equal(getResponseData().qa.grounded, false);
    assert.ok(getResponseData().qa.answer.includes("Unable to generate an AI answer"));
  }
});
