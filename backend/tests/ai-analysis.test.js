/**
 * Phase 4 AI Analysis Tests — TOS Red Flag Scanner
 *
 * All external AI provider calls are replaced with in-process mock providers.
 * No live API keys or network connections are required to run this suite.
 *
 * Test inventory (18 tests)
 * ─────────────────────────
 *  Response schema
 *   1.  validateAiClauseAnalysis accepts a fully valid AI response
 *   2.  validateAiClauseAnalysis rejects response missing plainEnglish
 *   3.  validateAiClauseAnalysis rejects response missing whyItMatters
 *   4.  validateAiClauseAnalysis rejects non-object input
 *   5.  validateAiClauseAnalysis normalises unrecognised severity to INFO
 *   6.  validateAiClauseAnalysis clamps confidence to [0, 1]
 *   7.  safeParseAiJson parses clean JSON
 *   8.  safeParseAiJson strips markdown fences before parsing
 *   9.  safeParseAiJson returns null for completely malformed input
 *
 *  AiAnalysisService — successful paths
 *  10. valid AI response returns a structured finding with all required fields
 *  11. AI detects semantic category from clause context
 *  12. plain-English explanation is included in AI finding
 *  13. why-it-matters explanation is included in AI finding
 *
 *  AiAnalysisService — failure / fallback paths
 *  14. provider unavailable returns available:false without throwing
 *  15. missing API key (NullProvider) returns available:false
 *  16. provider throws unexpectedly — service returns available:false
 *
 *  combineFindings — combination logic
 *  17. rule-only finding is preserved when AI is unavailable
 *  18. AI-only finding is added when no rule matched that segment
 *  19. rule and AI findings for same segment+category merge correctly
 *  20. AI failure leaves Phase 3 rule findings fully intact (pipeline-level)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateAiClauseAnalysis, safeParseAiJson } from "../src/ai/response-schema.js";
import { AiAnalysisService } from "../src/ai/ai-service.js";
import { NullProvider } from "../src/ai/providers/null-provider.js";
import { AnalysisPipeline } from "../src/architecture/pipeline/analysis-pipeline.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Builds a minimal mock provider with configurable behaviour. */
function mockProvider(behavior) {
  return {
    name: "mock",
    async analyzeClause(ctx) {
      return behavior(ctx);
    }
  };
}

/** Minimal valid AI response object. */
const VALID_AI_RESPONSE = {
  categoryId: "AUTO_RENEWAL",
  category: "Subscriptions & Billing",
  title: "Automatic Subscription Renewal",
  severity: "HIGH",
  semanticAssessment: "The clause mandates automatic subscription continuation.",
  plainEnglish: "Your plan renews automatically each billing period.",
  whyItMatters: "You may be charged without expecting it if you forget to cancel.",
  confidence: 0.91
};

/** Minimal clause segment structure. */
function makeSegment(overrides = {}) {
  return {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Your subscription will automatically renew unless cancelled before the billing date.",
    ...overrides
  };
}

/** Minimal Phase 3 rule finding structure. */
function makeRuleFinding(overrides = {}) {
  return {
    findingId: "FINDING_RULE_AUTO_RENEWAL_P1_S0_abc12345",
    ruleId: "RULE_AUTO_RENEWAL",
    categoryId: "AUTO_RENEWAL",
    category: "Subscriptions & Billing",
    title: "Automatic Subscription Renewal",
    severity: "HIGH",
    confidence: 0.93,
    explanation: "Subscription auto-renews.",
    evidence: "Your subscription will automatically renew.",
    pageNumber: 1,
    segmentIndex: 0,
    detectionMethod: "rule_based",
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1–9  Response schema tests
// ─────────────────────────────────────────────────────────────────────────────

test("validateAiClauseAnalysis accepts a fully valid AI response", () => {
  const result = validateAiClauseAnalysis(VALID_AI_RESPONSE);
  assert.equal(result.valid, true, "should be valid");
  assert.equal(result.analysis.categoryId, "AUTO_RENEWAL");
  assert.equal(result.analysis.severity, "HIGH");
  assert.equal(result.analysis.confidence, 0.91);
  assert.ok(result.analysis.plainEnglish, "plainEnglish should be present");
  assert.ok(result.analysis.whyItMatters, "whyItMatters should be present");
  assert.ok(result.analysis.title, "title should be present");
  assert.ok(result.analysis.semanticAssessment !== undefined, "semanticAssessment should be present");
});

test("validateAiClauseAnalysis rejects response missing plainEnglish", () => {
  const raw = { ...VALID_AI_RESPONSE, plainEnglish: "" };
  const result = validateAiClauseAnalysis(raw);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_plain_english");
});

test("validateAiClauseAnalysis rejects response missing whyItMatters", () => {
  const raw = { ...VALID_AI_RESPONSE, whyItMatters: undefined };
  const result = validateAiClauseAnalysis(raw);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_why_it_matters");
});

test("validateAiClauseAnalysis rejects non-object input", () => {
  assert.equal(validateAiClauseAnalysis(null).valid, false);
  assert.equal(validateAiClauseAnalysis("string").valid, false);
  assert.equal(validateAiClauseAnalysis([]).valid, false);
  assert.equal(validateAiClauseAnalysis(42).valid, false);
});

test("validateAiClauseAnalysis normalises unrecognised severity to INFO", () => {
  const raw = { ...VALID_AI_RESPONSE, severity: "CRITICAL" };
  const result = validateAiClauseAnalysis(raw);
  assert.equal(result.valid, true);
  assert.equal(result.analysis.severity, "INFO");
});

test("validateAiClauseAnalysis clamps confidence to [0, 1]", () => {
  const tooHigh = validateAiClauseAnalysis({ ...VALID_AI_RESPONSE, confidence: 5.0 });
  assert.equal(tooHigh.valid, true);
  assert.equal(tooHigh.analysis.confidence, 1.0);

  const tooLow = validateAiClauseAnalysis({ ...VALID_AI_RESPONSE, confidence: -2.5 });
  assert.equal(tooLow.valid, true);
  assert.equal(tooLow.analysis.confidence, 0.0);

  const nan = validateAiClauseAnalysis({ ...VALID_AI_RESPONSE, confidence: "not-a-number" });
  assert.equal(nan.valid, true);
  assert.equal(nan.analysis.confidence, 0.5); // default
});

test("safeParseAiJson parses clean JSON", () => {
  const result = safeParseAiJson(JSON.stringify(VALID_AI_RESPONSE));
  assert.deepEqual(result, VALID_AI_RESPONSE);
});

test("safeParseAiJson strips markdown fences before parsing", () => {
  const fenced = "```json\n" + JSON.stringify(VALID_AI_RESPONSE) + "\n```";
  const result = safeParseAiJson(fenced);
  assert.deepEqual(result, VALID_AI_RESPONSE);

  const fencedNoLang = "```\n" + JSON.stringify(VALID_AI_RESPONSE) + "\n```";
  const result2 = safeParseAiJson(fencedNoLang);
  assert.deepEqual(result2, VALID_AI_RESPONSE);
});

test("safeParseAiJson returns null for completely malformed input", () => {
  assert.equal(safeParseAiJson("this is not json at all"), null);
  assert.equal(safeParseAiJson(""), null);
  assert.equal(safeParseAiJson(null), null);
  assert.equal(safeParseAiJson(undefined), null);
  assert.equal(safeParseAiJson("{ broken json: ["), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10–13  AiAnalysisService — successful paths
// ─────────────────────────────────────────────────────────────────────────────

test("valid AI response returns a structured finding with all required fields", async () => {
  const provider = mockProvider(() => ({ available: true, data: VALID_AI_RESPONSE }));
  const service = new AiAnalysisService({ provider });
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.available, true);
  assert.equal(result.findings.length, 1);
  const f = result.findings[0];
  assert.ok(f.findingId, "findingId required");
  assert.equal(f.categoryId, "AUTO_RENEWAL");
  assert.equal(f.severity, "HIGH");
  assert.ok(f.plainEnglish, "plainEnglish required");
  assert.ok(f.whyItMatters, "whyItMatters required");
  assert.ok(f.evidence, "evidence required");
  assert.equal(typeof f.confidence, "number");
  assert.equal(f.aiDetected, true);
  assert.equal(f.detectionMethod, "ai_semantic"); // no rule match passed
  assert.equal(f.pageNumber, 1);
  assert.equal(f.segmentIndex, 0);
});

test("AI detects semantic category from clause context", async () => {
  // Clause does NOT use the exact phrase "automatic renewal" — semantic detection
  const segment = makeSegment({
    text: "Your membership shall continue for successive billing periods unless cancelled before the applicable renewal date."
  });
  const aiResponse = {
    ...VALID_AI_RESPONSE,
    categoryId: "AUTO_RENEWAL",
    plainEnglish: "Your membership renews every billing period automatically.",
    whyItMatters: "You will keep being charged unless you cancel."
  };
  const provider = mockProvider(() => ({ available: true, data: aiResponse }));
  const service = new AiAnalysisService({ provider });
  const result = await service.analyzeSegments([segment], []);

  assert.equal(result.available, true);
  assert.equal(result.findings[0].categoryId, "AUTO_RENEWAL");
});

test("plain-English explanation is included in AI finding", async () => {
  const provider = mockProvider(() => ({ available: true, data: VALID_AI_RESPONSE }));
  const service = new AiAnalysisService({ provider });
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.findings[0].plainEnglish, VALID_AI_RESPONSE.plainEnglish);
});

test("why-it-matters explanation is included in AI finding", async () => {
  const provider = mockProvider(() => ({ available: true, data: VALID_AI_RESPONSE }));
  const service = new AiAnalysisService({ provider });
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.findings[0].whyItMatters, VALID_AI_RESPONSE.whyItMatters);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14–16  AiAnalysisService — failure / fallback paths
// ─────────────────────────────────────────────────────────────────────────────

test("provider unavailable returns available:false without throwing", async () => {
  const provider = mockProvider(() => ({ available: false, reason: "timeout" }));
  const service = new AiAnalysisService({ provider });
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.available, false);
  assert.equal(result.reason, "timeout");
  assert.deepEqual(result.findings, []);
  assert.equal(result.segmentsAnalyzed, 0);
});

test("missing API key (NullProvider) returns available:false without network calls", async () => {
  const service = new AiAnalysisService({ provider: new NullProvider() });
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.available, false);
  assert.equal(result.reason, "no_api_key_configured");
  assert.deepEqual(result.findings, []);
});

test("provider throws unexpectedly — service returns available:false", async () => {
  const provider = mockProvider(() => {
    throw new Error("Simulated unexpected provider crash");
  });
  const service = new AiAnalysisService({ provider });
  // Must NOT throw; must return a controlled failure result
  const result = await service.analyzeSegments([makeSegment()], []);

  assert.equal(result.available, false);
  assert.equal(result.reason, "provider_exception");
  assert.deepEqual(result.findings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 17–20  combineFindings — combination logic
// ─────────────────────────────────────────────────────────────────────────────

test("rule-only finding is preserved when AI findings are empty", () => {
  const ruleFindings = [makeRuleFinding()];
  const combined = AiAnalysisService.combineFindings(ruleFindings, []);

  assert.equal(combined.length, 1);
  assert.equal(combined[0].ruleDetected, true);
  assert.equal(combined[0].aiDetected, false);
  assert.equal(combined[0].aiEnhancement, null);
  assert.equal(combined[0].detectionMethod, "rule_based");
  // Original Phase 3 fields must be intact
  assert.equal(combined[0].ruleId, "RULE_AUTO_RENEWAL");
  assert.equal(combined[0].severity, "HIGH");
});

test("AI-only finding is added when no rule matched that segment", () => {
  const aiFinding = {
    findingId: "FINDING_AI_INDEMNIFICATION_P1_S2_xxxxxxxx",
    ruleId: null,
    categoryId: "INDEMNIFICATION",
    category: "Liability & Warranties",
    title: "Broad Indemnification",
    severity: "HIGH",
    confidence: 0.87,
    explanation: "You must defend the company.",
    plainEnglish: "You pay their legal bills.",
    whyItMatters: "You could owe substantial legal fees.",
    semanticAssessment: "Broad user indemnification obligation.",
    evidence: "You agree to indemnify and hold harmless the company.",
    pageNumber: 1,
    segmentIndex: 2, // different segment — no rule match exists
    detectionMethod: "ai_semantic",
    ruleDetected: false,
    aiDetected: true,
    aiEnhancement: null
  };

  const combined = AiAnalysisService.combineFindings([], [aiFinding]);

  assert.equal(combined.length, 1);
  assert.equal(combined[0].ruleDetected, false);
  assert.equal(combined[0].aiDetected, true);
  assert.equal(combined[0].detectionMethod, "ai_semantic");
  assert.equal(combined[0].categoryId, "INDEMNIFICATION");
});

test("rule and AI findings for same segment + category are merged with AI enhancement", () => {
  const ruleFinding = makeRuleFinding(); // segmentIndex: 0, categoryId: AUTO_RENEWAL

  // AI finding targets the same segment AND category
  const aiFinding = {
    findingId: "FINDING_AI_AUTO_RENEWAL_P1_S0_yyyyyyyy",
    ruleId: null,
    categoryId: "AUTO_RENEWAL",
    category: "Subscriptions & Billing",
    title: "Automatic Subscription Renewal",
    severity: "HIGH",
    confidence: 0.91,
    explanation: VALID_AI_RESPONSE.whyItMatters,
    plainEnglish: VALID_AI_RESPONSE.plainEnglish,
    whyItMatters: VALID_AI_RESPONSE.whyItMatters,
    semanticAssessment: VALID_AI_RESPONSE.semanticAssessment,
    evidence: "Your subscription will automatically renew.",
    pageNumber: 1,
    segmentIndex: 0,
    detectionMethod: "rule_and_ai",
    ruleDetected: true,
    aiDetected: true,
    aiEnhancement: null
  };

  const combined = AiAnalysisService.combineFindings([ruleFinding], [aiFinding]);

  // Should be ONE merged finding, not two
  assert.equal(combined.length, 1);
  assert.equal(combined[0].ruleDetected, true);
  assert.equal(combined[0].aiDetected, true);
  assert.equal(combined[0].detectionMethod, "rule_and_ai");
  // AI enhancement fields should be present
  assert.ok(combined[0].aiEnhancement, "aiEnhancement should be set");
  assert.equal(combined[0].aiEnhancement.plainEnglish, VALID_AI_RESPONSE.plainEnglish);
  assert.equal(combined[0].aiEnhancement.aiConfidence, 0.91);
  // Original Phase 3 identity fields must be preserved
  assert.equal(combined[0].ruleId, "RULE_AUTO_RENEWAL");
  assert.equal(combined[0].findingId, ruleFinding.findingId);
});

test("AI failure leaves Phase 3 rule findings fully intact in the pipeline", async () => {
  // Inject a service that always fails into the pipeline via _aiService option
  const failingService = {
    async analyzeSegments() {
      throw new Error("Simulated AI service crash");
    }
  };

  const pipeline = new AnalysisPipeline({ _aiService: failingService });

  const segment = makeSegment({
    text: "You agree to binding mandatory arbitration under AAA rules. You waive the right to a jury trial."
  });
  const doc = {
    metadata: { filename: "test.txt", pageCount: 1, wordCount: 20 },
    pages: [{ pageNumber: 1, rawText: segment.text, normalizedText: segment.text }],
    segments: [segment],
    normalizedText: segment.text,
    rawText: segment.text
  };

  const result = await pipeline.run(doc);

  // AI failed → summary must reflect that
  assert.equal(result.summary.aiAnalysis.available, false);
  assert.equal(result.summary.aiAnalysis.reason, "ai_exception");

  // Phase 3 rule findings must still be present
  assert.ok(result.findings.length > 0, "Phase 3 findings must survive AI failure");
  // Every finding must be marked ruleDetected: true (no AI findings were merged)
  for (const f of result.findings) {
    assert.equal(f.ruleDetected, true);
    assert.equal(f.aiDetected, false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9.4.2B RAG Pipeline Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

test("RAG: vector indexing is called during RAG-enabled analysis", async () => {
  let indexCalled = false;
  let indexedDocId = null;
  let indexedClauses = null;
  let deleteCalled = false;

  const mockClient = {
    isCircuitClosed: () => true,
    async indexClauses(docId, clauses) {
      indexCalled = true;
      indexedDocId = docId;
      indexedClauses = clauses;
      return { success: true, documentId: docId, indexedCount: clauses.length };
    },
    async queryVectors(docId, query, topK) {
      return { success: true, results: [{ clause_id: "c_1", text: "related evidence" }] };
    },
    async deleteDocumentVectors(docId) {
      deleteCalled = true;
      return { success: true, documentId: docId, deleted: true };
    },
    async withDocumentVectors(docId, clauses, callback) {
      try {
        const idxRes = await this.indexClauses(docId, clauses);
        return await callback(idxRes);
      } finally {
        await this.deleteDocumentVectors(docId);
      }
    }
  };

  const provider = mockProvider(() => ({ available: true, data: VALID_AI_RESPONSE }));
  const service = new AiAnalysisService({ provider, aiClient: mockClient, enableRag: true });

  const segments = [
    makeSegment({ text: "Clause 1: All disputes shall be resolved through binding arbitration in accordance with AAA rules." }),
    makeSegment({ segmentIndex: 1, text: "Clause 2: You waive all rights to a trial by jury or to participate in a class action." })
  ];

  const result = await service.analyzeSegments(segments, [], "doc_test_123");

  assert.equal(result.available, true);
  assert.equal(indexCalled, true);
  assert.equal(indexedDocId, "doc_test_123");
  assert.equal(indexedClauses.length, 2);
  assert.equal(deleteCalled, true);
});

test("RAG: vector query is called for selected AI segments and retrievedEvidence reaches provider", async () => {
  const queriedSegments = [];
  let receivedEvidenceInContext = null;

  const mockEvidence = [
    { clause_id: "seg_1", text: "Related arbitration details and fees." }
  ];

  const mockClient = {
    isCircuitClosed: () => true,
    async indexClauses(docId, clauses) {
      return { success: true, indexedCount: clauses.length };
    },
    async queryVectors(docId, query, topK) {
      queriedSegments.push({ docId, query, topK });
      return { success: true, results: mockEvidence };
    },
    async deleteDocumentVectors(docId) {
      return { success: true, deleted: true };
    },
    async withDocumentVectors(docId, clauses, callback) {
      try {
        const idxRes = await this.indexClauses(docId, clauses);
        return await callback(idxRes);
      } finally {
        await this.deleteDocumentVectors(docId);
      }
    }
  };

  const provider = mockProvider((ctx) => {
    receivedEvidenceInContext = ctx.retrievedEvidence;
    return { available: true, data: VALID_AI_RESPONSE };
  });

  const service = new AiAnalysisService({ provider, aiClient: mockClient, enableRag: true });
  const segment = makeSegment({
    text: "You agree that any dispute will be resolved exclusively through final and binding arbitration."
  });

  const result = await service.analyzeSegments([segment], [], "doc_rag_test");

  assert.equal(result.available, true);
  assert.equal(queriedSegments.length, 1);
  assert.equal(queriedSegments[0].docId, "doc_rag_test");
  assert.equal(queriedSegments[0].topK, 3);
  assert.deepEqual(receivedEvidenceInContext, mockEvidence);
});

test("RAG: zero-retention withDocumentVectors cleanup is preserved even if analysis throws or provider fails", async () => {
  let deleteCalled = false;

  const mockClient = {
    isCircuitClosed: () => true,
    async indexClauses(docId, clauses) {
      return { success: true, indexedCount: clauses.length };
    },
    async queryVectors() {
      return { success: true, results: [] };
    },
    async deleteDocumentVectors(docId) {
      deleteCalled = true;
      return { success: true, deleted: true };
    },
    async withDocumentVectors(docId, clauses, callback) {
      try {
        const idxRes = await this.indexClauses(docId, clauses);
        return await callback(idxRes);
      } finally {
        await this.deleteDocumentVectors(docId);
      }
    }
  };

  const provider = mockProvider(() => {
    throw new Error("Provider explosion during analysis");
  });

  const service = new AiAnalysisService({ provider, aiClient: mockClient, enableRag: true });
  const segment = makeSegment({
    text: "You waive any right to bring a lawsuit or participate in a class action."
  });

  const result = await service.analyzeSegments([segment], [], "doc_cleanup_test");

  assert.equal(result.available, false);
  assert.equal(result.reason, "provider_exception");
  assert.equal(deleteCalled, true, "Vector cleanup MUST run unconditionally on error");
});

test("RAG: vector indexing failure falls back gracefully to unaugmented AI analysis", async () => {
  let queriesAttempted = 0;
  let receivedEvidenceInContext = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async indexClauses() {
      return { success: false, error: "python_indexing_timeout" };
    },
    async queryVectors() {
      queriesAttempted++;
      return { success: false, results: [] };
    },
    async deleteDocumentVectors() {
      return { success: true };
    },
    async withDocumentVectors(docId, clauses, callback) {
      try {
        const idxRes = await this.indexClauses(docId, clauses);
        return await callback(idxRes);
      } finally {
        await this.deleteDocumentVectors(docId);
      }
    }
  };

  const provider = mockProvider((ctx) => {
    receivedEvidenceInContext = ctx.retrievedEvidence;
    return { available: true, data: VALID_AI_RESPONSE };
  });

  const service = new AiAnalysisService({ provider, aiClient: mockClient, enableRag: true });
  const segment = makeSegment({
    text: "Subscription continues indefinitely until terminated by you in accordance with these terms."
  });

  const result = await service.analyzeSegments([segment], []);

  assert.equal(result.available, true);
  assert.equal(queriesAttempted, 0, "Query vectors should not be called if indexing failed");
  assert.deepEqual(receivedEvidenceInContext, []);
  assert.equal(result.findings.length, 1);
});

test("RAG: vector query failure falls back gracefully with retrievedEvidence empty array", async () => {
  let receivedEvidenceInContext = null;

  const mockClient = {
    isCircuitClosed: () => true,
    async indexClauses(docId, clauses) {
      return { success: true, indexedCount: clauses.length };
    },
    async queryVectors() {
      throw new Error("Simulated query socket hang up");
    },
    async deleteDocumentVectors() {
      return { success: true };
    },
    async withDocumentVectors(docId, clauses, callback) {
      try {
        const idxRes = await this.indexClauses(docId, clauses);
        return await callback(idxRes);
      } finally {
        await this.deleteDocumentVectors(docId);
      }
    }
  };

  const provider = mockProvider((ctx) => {
    receivedEvidenceInContext = ctx.retrievedEvidence;
    return { available: true, data: VALID_AI_RESPONSE };
  });

  const service = new AiAnalysisService({ provider, aiClient: mockClient, enableRag: true });
  const segment = makeSegment({
    text: "We may modify these terms at any time by posting the revised version on our website."
  });

  const result = await service.analyzeSegments([segment], []);

  assert.equal(result.available, true);
  assert.deepEqual(receivedEvidenceInContext, []);
  assert.equal(result.findings.length, 1);
});

test("RAG: pipeline preserves rule findings when Python AI service is completely unavailable", async () => {
  const disabledClient = {
    isCircuitClosed: () => false,
    async indexClauses() {
      return { success: false, available: false, error: "python_ai_service_disabled" };
    },
    async queryVectors() {
      return { success: false, results: [] };
    },
    async deleteDocumentVectors() {
      return { success: false };
    },
    async withDocumentVectors(docId, clauses, callback) {
      return await callback({ success: false });
    }
  };

  const service = new AiAnalysisService({
    provider: new NullProvider(),
    aiClient: disabledClient,
    enableRag: true
  });

  const pipeline = new AnalysisPipeline({ _aiService: service });
  const segment = makeSegment({
    text: "You agree to binding arbitration. All claims must be resolved individually without jury trial."
  });
  const doc = {
    metadata: { filename: "rag_fallback_test.txt", pageCount: 1, wordCount: 20 },
    pages: [{ pageNumber: 1, rawText: segment.text, normalizedText: segment.text }],
    segments: [segment],
    normalizedText: segment.text,
    rawText: segment.text
  };

  const result = await pipeline.run(doc);

  assert.equal(result.summary.aiAnalysis.available, false);
  assert.ok(result.findings.length > 0, "Phase 3 rule findings must remain intact");
  assert.equal(result.findings[0].ruleDetected, true);
  assert.equal(result.findings[0].aiDetected, false);
});
