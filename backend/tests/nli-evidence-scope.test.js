/**
 * Phase 7G-B.4 — NLI Evidence Scope Correction Tests.
 *
 * Verifies:
 * 1. Gemini-selected supporting clauses are preferred over all retrieved clauses.
 * 2. Irrelevant retrieved clauses do not introduce false contradictions.
 * 3. Invalid mappedEvidence references are rejected.
 * 4. Missing mappedEvidence falls back to retrievedEvidence.
 * 5. Empty mappedEvidence falls back correctly.
 * 6. No valid evidence results in unavailable NLI rather than fabricated scores.
 * 7. Existing contradicted and uncertain results remain correctly classified when genuine conflicting evidence is supplied.
 * 8. Existing Q&A functionality remains compatible.
 * 9. Existing Terms and Privacy document separation remains intact.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

const SAMPLE_TERMS_CLAUSES = [
  {
    clauseId: "c_term_203",
    text: "You may terminate your account at any time by following the instructions on our website or going to Account Settings.",
    section: "Termination"
  },
  {
    clauseId: "c_term_204",
    text: "Upon termination of your account, you will lose access to all repositories and data associated with the account.",
    section: "Termination Effects"
  },
  {
    clauseId: "c_term_205",
    text: "GitHub does not provide refunds for partial months of service upon early termination.",
    section: "Billing"
  }
];

const SAMPLE_PRIVACY_CLAUSES = [
  {
    clauseId: "c_priv_101",
    text: "We collect personal data that you provide directly to us when registering an account.",
    section: "Information Collection"
  },
  {
    clauseId: "c_priv_102",
    text: "We never sell your personal data or user repository content to third-party advertisers.",
    section: "Data Sharing"
  }
];

// 1. Gemini-selected supporting clauses are preferred over all retrieved clauses
test("1. Gemini-selected supporting clauses are preferred over all retrieved clauses for NLI", async () => {
  let passedEvidenceToNli = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: SAMPLE_TERMS_CLAUSES.map((c) => ({
          clause_id: c.clauseId,
          text: c.text,
          section: c.section
        }))
      };
    },
    async validateNli(answer, evidence) {
      passedEvidenceToNli = evidence;
      return {
        success: true,
        available: true,
        isSupported: true,
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.99, neutral: 0.01, contradiction: 0.0 },
        bestClauseId: "c_term_203"
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "You may terminate your account at any time via Account Settings.",
          grounded: true,
          confidence: 0.95,
          relevantClauseIds: ["c_term_203"]
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I terminate my account?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify NLI received ONLY the Gemini-selected supporting clause, not all 3
    assert.ok(Array.isArray(passedEvidenceToNli));
    assert.equal(passedEvidenceToNli.length, 1);
    assert.equal(passedEvidenceToNli[0].clauseId, "c_term_203");
    assert.equal(passedEvidenceToNli[0].text, SAMPLE_TERMS_CLAUSES[0].text);

    // Verify NLI validation returned supported
    assert.equal(data.qa.nliValidation.status, "supported");
    assert.equal(data.qa.nliValidation.bestClauseId, "c_term_203");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 2. Irrelevant retrieved clauses do not introduce false contradictions
test("2. Irrelevant retrieved clauses do not introduce false contradictions", async () => {
  let passedEvidenceCount = 0;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: SAMPLE_TERMS_CLAUSES.map((c) => ({
          clause_id: c.clauseId,
          text: c.text,
          section: c.section
        }))
      };
    },
    async validateNli(answer, evidence) {
      passedEvidenceCount = evidence.length;
      // If all 3 were passed (including termination effects and billing),
      // a multi-clause conflict would have produced "uncertain".
      // With only c_term_203 passed, entailment is clean:
      const onlySupporting = evidence.length === 1 && evidence[0].clauseId === "c_term_203";
      return {
        success: true,
        available: true,
        isSupported: onlySupporting,
        status: onlySupporting ? "supported" : "uncertain",
        label: onlySupporting ? "entailment" : "neutral",
        scores: { entailment: 0.99, neutral: 0.01, contradiction: 0.0 },
        bestClauseId: "c_term_203"
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "You can close your account at any time in Account Settings.",
          grounded: true,
          confidence: 0.9,
          relevantClauseIds: ["c_term_203"]
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I terminate my account?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(passedEvidenceCount, 1);
    assert.equal(data.qa.nliValidation.status, "supported");
    assert.equal(data.qa.nliValidation.label, "entailment");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 3. Invalid mappedEvidence references are rejected
test("3. Invalid or fabricated mappedEvidence references are rejected and fall back safely", async () => {
  let passedEvidenceToNli = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: SAMPLE_TERMS_CLAUSES.map((c) => ({
          clause_id: c.clauseId,
          text: c.text,
          section: c.section
        }))
      };
    },
    async validateNli(answer, evidence) {
      passedEvidenceToNli = evidence;
      return {
        success: true,
        available: true,
        status: "uncertain",
        label: "neutral",
        scores: { entailment: 0.4, neutral: 0.5, contradiction: 0.1 }
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "Some answer.",
          grounded: true,
          confidence: 0.8,
          // Fabricated IDs that do not exist in retrieved evidence
          relevantClauseIds: ["hallucinated_clause_999", "", null, 42]
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What are the rules?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Because fabricated IDs were rejected, fallback to valid retrieved clauses occurred
    assert.ok(Array.isArray(passedEvidenceToNli));
    assert.equal(passedEvidenceToNli.length, 3);
    assert.ok(!passedEvidenceToNli.some((c) => c.clauseId === "hallucinated_clause_999"));
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 4. Missing mappedEvidence falls back to retrievedEvidence
test("4. Missing mappedEvidence falls back to retrievedEvidence", async () => {
  let passedEvidenceToNli = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: [{ clause_id: "c_term_203", text: SAMPLE_TERMS_CLAUSES[0].text, section: "Termination" }]
      };
    },
    async validateNli(answer, evidence) {
      passedEvidenceToNli = evidence;
      return {
        success: true,
        available: true,
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.9, neutral: 0.1, contradiction: 0.0 }
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "Account termination is supported.",
          grounded: true,
          confidence: 0.8
          // relevantClauseIds omitted entirely
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "How to terminate?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(passedEvidenceToNli));
    assert.equal(passedEvidenceToNli.length, 1);
    assert.equal(passedEvidenceToNli[0].clauseId, "c_term_203");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 5. Empty mappedEvidence falls back correctly
test("5. Empty mappedEvidence falls back correctly to retrieved evidence", async () => {
  let passedEvidenceToNli = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: [{ clause_id: "c_term_203", text: SAMPLE_TERMS_CLAUSES[0].text, section: "Termination" }]
      };
    },
    async validateNli(answer, evidence) {
      passedEvidenceToNli = evidence;
      return {
        success: true,
        available: true,
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.88, neutral: 0.12, contradiction: 0.0 }
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "You can terminate anytime.",
          grounded: true,
          confidence: 0.85,
          relevantClauseIds: [] // explicit empty array
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I terminate?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(passedEvidenceToNli));
    assert.equal(passedEvidenceToNli.length, 1);
    assert.equal(passedEvidenceToNli[0].clauseId, "c_term_203");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 6. No valid evidence results in unavailable NLI rather than fabricated scores
test("6. No valid evidence results in unavailable NLI rather than fabricated scores", async () => {
  let nliCalled = false;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() { return { success: true, results: [] }; },
    async validateNli() {
      nliCalled = true;
      return { success: true };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "The provided document does not contain information to answer this question.",
          grounded: false,
          confidence: 0.0,
          relevantClauseIds: []
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    // Submit with empty text or clause context that produces no retrieved evidence
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What is your refund policy?",
        clauses: [{ clauseId: "c_empty", text: "Arbitration rules only.", section: "Disputes" }]
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.qa.grounded, false);
    // NLI should never fabricate scores when no valid supporting evidence is present (Phase 7G-D.6 explicit uncertain)
    assert.ok(
      data.qa.nliValidation.status === "unavailable" || data.qa.nliValidation.status === "uncertain",
      "NLI status must be unavailable or uncertain for ungrounded answer"
    );
    assert.equal(data.qa.nliValidation.scores, null);
    assert.equal(data.qa.nliValidation.bestClauseId, null);
    assert.equal(data.qa.nliValidation.clauseEvaluations, null);
    assert.equal(data.qa.nliValidation.compositeEvaluation, null);
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 7. Existing contradicted and uncertain results remain correctly classified when genuine conflicting evidence is supplied
test("7. Existing contradicted and uncertain results remain correctly classified when genuine conflicting evidence is supplied", async () => {
  // Case A: Genuine contradiction
  const mockClientA = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: [{ clause_id: "c_term_205", text: SAMPLE_TERMS_CLAUSES[2].text, section: "Billing" }]
      };
    },
    async validateNli(answer, evidence) {
      assert.equal(evidence[0].clauseId, "c_term_205");
      return {
        success: true,
        available: true,
        isSupported: false,
        status: "contradicted",
        label: "contradiction",
        scores: { entailment: 0.02, neutral: 0.08, contradiction: 0.90 },
        bestClauseId: "c_term_205"
      };
    }
  };

  const mockProviderA = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "Full refunds are always provided upon request.",
          grounded: true,
          confidence: 0.8,
          relevantClauseIds: ["c_term_205"]
        }
      };
    }
  };

  app.locals.aiClient = mockClientA;
  app.locals.aiProvider = mockProviderA;

  try {
    const resA = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I get a refund?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(resA.status, 200);
    const dataA = await resA.json();
    assert.equal(dataA.qa.nliValidation.status, "contradicted");
    assert.equal(dataA.qa.nliValidation.label, "contradiction");
    assert.equal(dataA.qa.nliValidation.scores.contradiction, 0.90);
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }

  // Case B: Genuine conflict between multiple supporting clauses -> uncertain
  const mockClientB = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: [
          { clause_id: "c_term_203", text: SAMPLE_TERMS_CLAUSES[0].text, section: "Termination" },
          { clause_id: "c_term_204", text: SAMPLE_TERMS_CLAUSES[1].text, section: "Termination Effects" }
        ]
      };
    },
    async validateNli(answer, evidence) {
      // Both clauses genuinely cited
      assert.equal(evidence.length, 2);
      return {
        success: true,
        available: true,
        isSupported: false,
        status: "uncertain",
        label: "neutral",
        scores: { entailment: 0.55, neutral: 0.15, contradiction: 0.30 },
        bestClauseId: "c_term_203",
        reason: "conflicting_evidence"
      };
    }
  };

  const mockProviderB = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "You can terminate, but data is immediately destroyed.",
          grounded: true,
          confidence: 0.85,
          relevantClauseIds: ["c_term_203", "c_term_204"]
        }
      };
    }
  };

  app.locals.aiClient = mockClientB;
  app.locals.aiProvider = mockProviderB;

  try {
    const resB = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What happens when I terminate?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(resB.status, 200);
    const dataB = await resB.json();
    assert.equal(dataB.qa.nliValidation.status, "uncertain");
    assert.equal(dataB.qa.nliValidation.label, "neutral");
    assert.equal(dataB.qa.nliValidation.reason, "conflicting_evidence");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 8. Existing Q&A functionality remains compatible
test("8. Existing Q&A functionality remains compatible with complete envelope", async () => {
  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() {
      return {
        success: true,
        results: [{ clause_id: "c_term_203", text: SAMPLE_TERMS_CLAUSES[0].text, section: "Termination" }]
      };
    },
    async validateNli() {
      return {
        success: true,
        available: true,
        isSupported: true,
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.97, neutral: 0.03, contradiction: 0.0 },
        bestClauseId: "c_term_203"
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion() {
      return {
        available: true,
        data: {
          answer: "You may terminate your account at any time.",
          grounded: true,
          confidence: 0.95,
          relevantClauseIds: ["c_term_203"]
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    const res = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I terminate my account?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.qa);
    assert.equal(typeof data.qa.question, "string");
    assert.equal(typeof data.qa.answer, "string");
    assert.ok(Array.isArray(data.qa.evidence));
    assert.equal(data.qa.evidence.length, 1);
    assert.equal(data.qa.evidence[0].clauseId, "c_term_203");
    assert.equal(typeof data.qa.grounded, "boolean");
    assert.equal(typeof data.qa.confidence, "number");
    assert.equal(data.qa.available, true);
    assert.ok(data.qa.nliValidation);
    assert.equal(data.qa.nliValidation.status, "supported");
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});

// 9. Existing Terms and Privacy document separation remains intact
test("9. Existing Terms and Privacy document separation remains intact without evidence cross-leakage", async () => {
  let termsEvidencePassed = null;
  let privacyEvidencePassed = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async withDocumentVectors(id, clauses, fn) { return await fn({ success: true }); },
    async queryVectors() { return { success: true, results: [] }; },
    async validateNli(answer, evidence) {
      if (evidence[0]?.clauseId.startsWith("c_term")) {
        termsEvidencePassed = evidence;
      } else if (evidence[0]?.clauseId.startsWith("c_priv")) {
        privacyEvidencePassed = evidence;
      }
      return {
        success: true,
        available: true,
        isSupported: true,
        status: "supported",
        label: "entailment",
        scores: { entailment: 0.95, neutral: 0.05, contradiction: 0.0 },
        bestClauseId: evidence[0]?.clauseId
      };
    }
  };

  const mockProvider = {
    name: "mock-gemini",
    async answerQuestion(ctx) {
      const isPrivacy = ctx.retrievedEvidence.some((e) => e.clauseId.startsWith("c_priv"));
      return {
        available: true,
        data: {
          answer: isPrivacy ? "We never sell your personal data." : "You can terminate anytime.",
          grounded: true,
          confidence: 0.9,
          relevantClauseIds: isPrivacy ? ["c_priv_102"] : ["c_term_203"]
        }
      };
    }
  };

  app.locals.aiClient = mockClient;
  app.locals.aiProvider = mockProvider;

  try {
    // Query 1: Terms of Service
    const resTerms = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Can I terminate?",
        clauses: SAMPLE_TERMS_CLAUSES
      })
    });
    assert.equal(resTerms.status, 200);
    const dataTerms = await resTerms.json();
    assert.equal(dataTerms.qa.evidence[0].clauseId, "c_term_203");
    assert.equal(termsEvidencePassed[0].clauseId, "c_term_203");

    // Query 2: Privacy Policy
    const resPrivacy = await fetch(`${baseUrl}/api/analyze/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Do you sell my data?",
        clauses: SAMPLE_PRIVACY_CLAUSES
      })
    });
    assert.equal(resPrivacy.status, 200);
    const dataPrivacy = await resPrivacy.json();
    assert.equal(dataPrivacy.qa.evidence[0].clauseId, "c_priv_102");
    assert.equal(privacyEvidencePassed[0].clauseId, "c_priv_102");

    // Verify zero cross-contamination
    assert.ok(!termsEvidencePassed.some((c) => c.clauseId.startsWith("c_priv")));
    assert.ok(!privacyEvidencePassed.some((c) => c.clauseId.startsWith("c_term")));
  } finally {
    app.locals.aiClient = null;
    app.locals.aiProvider = null;
  }
});
