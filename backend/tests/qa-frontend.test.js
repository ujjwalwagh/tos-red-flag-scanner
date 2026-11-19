import test from "node:test";
import assert from "node:assert/strict";

// Helper to create lightweight mock DOM elements for unit testing renderQaResult
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    files: [],
    disabled: false,
    _innerHTML: "",
    children: [],
    attributes: {},
    style: {},
    setAttribute(name, val) {
      el.attributes[name] = String(val);
    },
    getAttribute(name) {
      return el.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete el.attributes[name];
    },
    addEventListener() {},
    getContext() {
      return { fillRect() {}, clearRect() {} };
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node) {
          el.children.push(node);
        }
      }
    },
    appendChild(child) {
      if (child) {
        el.children.push(child);
      }
      return child;
    },
    querySelector(selector) {
      const results = el.querySelectorAll(selector);
      return results.length > 0 ? results[0] : null;
    },
    querySelectorAll(selector) {
      const matches = [];
      function walk(node) {
        for (const child of node.children) {
          if (typeof child !== "object" || !child) continue;
          if (selector.startsWith(".")) {
            const cls = selector.slice(1);
            if (child.classList.contains(cls)) {
              matches.push(child);
            }
          } else if (selector.startsWith("#")) {
            const id = selector.slice(1);
            if (child.id === id) {
              matches.push(child);
            }
          } else if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) {
            matches.push(child);
          }
          walk(child);
        }
      }
      walk(el);
      return matches;
    }
  };

  Object.defineProperty(el, "innerHTML", {
    get() {
      return el._innerHTML;
    },
    set(val) {
      el._innerHTML = val;
      if (val === "") {
        el.children = [];
      }
    }
  });

  el.classList = {
    add(...classes) {
      const cur = el.className ? el.className.split(/\s+/).filter(Boolean) : [];
      for (const c of classes) {
        if (!cur.includes(c)) cur.push(c);
      }
      el.className = cur.join(" ");
    },
    remove(...classes) {
      const cur = el.className ? el.className.split(/\s+/).filter(Boolean) : [];
      el.className = cur.filter((c) => !classes.includes(c)).join(" ");
    },
    contains(c) {
      const cur = el.className ? el.className.split(/\s+/).filter(Boolean) : [];
      return cur.includes(c);
    }
  };

  return el;
}

// Global DOM mocks before importing app.js
const mockResultsContainer = createMockElement("div");
mockResultsContainer.id = "qa-results";
mockResultsContainer.classList.add("hidden");

const mockStatusBox = createMockElement("div");
mockStatusBox.id = "qa-status";

const mockStatusText = createMockElement("p");
mockStatusText.id = "qa-status-text";

global.document = {
  querySelector(sel) {
    if (sel === "#qa-results") return mockResultsContainer;
    if (sel === "#qa-status") return mockStatusBox;
    if (sel === "#qa-status-text") return mockStatusText;
    return createMockElement("div");
  },
  querySelectorAll() {
    return [];
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  addEventListener() {}
};

global.window = {
  addEventListener() {},
  location: { reload() {} }
};

const { renderQaResult, formatSimilarityScore } = await import("../../frontend/public/app.js");
const { formatSimilarityScore: formatPopupSimilarityScore } = await import("../../extension/popup/popup.js");

// Reset helper
function resetContainer() {
  mockResultsContainer.children = [];
  mockResultsContainer.className = "qa-results-container hidden";
}

// =========================================================================
// Tests
// =========================================================================

test("renderQaResult: gracefully handles legacy payload without nliValidation", () => {
  resetContainer();
  const legacyQa = {
    answer: "You may cancel anytime from account settings.",
    grounded: true,
    confidence: 0.9,
    available: true,
    evidence: [
      { section: "Cancellation", text: "Users can cancel via settings.", similarityScore: 0.85 }
    ]
  };

  renderQaResult(legacyQa);

  // Result container is shown
  assert.equal(mockResultsContainer.classList.contains("hidden"), false);
  // Answer card is rendered
  const answerCard = mockResultsContainer.querySelector(".qa-answer-card");
  assert.ok(answerCard, "Answer card should be rendered");

  // Answer text is unchanged
  const answerText = mockResultsContainer.querySelector(".qa-answer-text");
  assert.equal(answerText.textContent, "You may cancel anytime from account settings.");

  // Gemini grounded badge is rendered
  const groundedBadge = mockResultsContainer.querySelector(".qa-grounded-badge");
  assert.ok(groundedBadge.textContent.includes("Grounded in your ToS"));

  // NLI section is NOT rendered
  const nliSection = mockResultsContainer.querySelector(".qa-nli-section");
  assert.equal(nliSection, null, "Legacy payload without nliValidation must not render NLI section");
});

test("renderQaResult: renders 'supported' status with scores and bestClauseId", () => {
  resetContainer();
  const supportedQa = {
    answer: "You can cancel your subscription at any time.",
    grounded: true,
    confidence: 0.95,
    available: true,
    nliValidation: {
      status: "supported",
      label: "entailment",
      scores: {
        entailment: 0.963,
        neutral: 0.024,
        contradiction: 0.013
      },
      bestClauseId: "clause_subscription_cancel_1",
      reason: null
    }
  };

  renderQaResult(supportedQa);

  const nliSection = mockResultsContainer.querySelector(".qa-nli-section");
  assert.ok(nliSection, "NLI section must be rendered");
  assert.ok(nliSection.classList.contains("qa-nli-status-supported"));

  // Model tag
  const modelTag = mockResultsContainer.querySelector(".qa-nli-model-tag");
  assert.equal(modelTag.textContent, "cross-encoder/nli-deberta-v3-base");

  // Status badge
  const badge = mockResultsContainer.querySelector(".qa-nli-badge-supported");
  assert.ok(badge, "Supported badge must exist");
  assert.ok(badge.textContent.includes("Supported by ToS evidence"));

  // Scores
  const entPill = mockResultsContainer.querySelector(".qa-nli-score-entailment");
  const neuPill = mockResultsContainer.querySelector(".qa-nli-score-neutral");
  const conPill = mockResultsContainer.querySelector(".qa-nli-score-contradiction");
  assert.ok(entPill, "Entailment score pill must exist");
  assert.equal(entPill.textContent, "Entailment: 96%");
  assert.equal(neuPill.textContent, "Neutral: 2%");
  assert.equal(conPill.textContent, "Contradiction: 1%");

  // Best clause ID
  const clauseId = mockResultsContainer.querySelector(".qa-nli-clause-id");
  assert.ok(clauseId, "Clause ID code must exist");
  assert.equal(clauseId.textContent, "clause_subscription_cancel_1");

  // Gemini answer text is unchanged
  const answerText = mockResultsContainer.querySelector(".qa-answer-text");
  assert.equal(answerText.textContent, "You can cancel your subscription at any time.");
});

test("renderQaResult: renders 'contradicted' status with scores", () => {
  resetContainer();
  const contradictedQa = {
    answer: "You will receive an automatic full cash refund on cancellation.",
    grounded: false,
    confidence: 0.2,
    available: true,
    nliValidation: {
      status: "contradicted",
      label: "contradiction",
      scores: {
        entailment: 0.05,
        neutral: 0.08,
        contradiction: 0.87
      },
      bestClauseId: "clause_no_refunds_3",
      reason: null
    }
  };

  renderQaResult(contradictedQa);

  const nliSection = mockResultsContainer.querySelector(".qa-nli-section");
  assert.ok(nliSection.classList.contains("qa-nli-status-contradicted"));

  const badge = mockResultsContainer.querySelector(".qa-nli-badge-contradicted");
  assert.ok(badge, "Contradicted badge must exist");
  assert.ok(badge.textContent.includes("Contradicted by ToS evidence"));

  const conPill = mockResultsContainer.querySelector(".qa-nli-score-contradiction");
  assert.equal(conPill.textContent, "Contradiction: 87%");
});

test("renderQaResult: renders 'uncertain' status", () => {
  resetContainer();
  const uncertainQa = {
    answer: "The terms do not explicitly address partial month prorated credits.",
    grounded: false,
    confidence: 0.5,
    available: true,
    nliValidation: {
      status: "uncertain",
      label: "neutral",
      scores: {
        entailment: 0.2,
        neutral: 0.68,
        contradiction: 0.12
      },
      bestClauseId: null,
      reason: null
    }
  };

  renderQaResult(uncertainQa);

  const nliSection = mockResultsContainer.querySelector(".qa-nli-section");
  assert.ok(nliSection.classList.contains("qa-nli-status-uncertain"));

  const badge = mockResultsContainer.querySelector(".qa-nli-badge-uncertain");
  assert.ok(badge, "Uncertain badge must exist");
  assert.ok(badge.textContent.includes("Uncertain"));

  // Best clause ID was null, so no clause element
  const clauseId = mockResultsContainer.querySelector(".qa-nli-clause-id");
  assert.equal(clauseId, null, "Should not render clause ID when null");
});

test("renderQaResult: renders 'unavailable' status with concise explanation and NO fabricated scores", () => {
  resetContainer();
  const unavailableQa = {
    answer: "Unable to generate an AI answer.",
    grounded: false,
    confidence: 0,
    available: false,
    nliValidation: {
      status: "unavailable",
      label: null,
      scores: null,
      bestClauseId: null,
      reason: "nli_service_unavailable"
    }
  };

  renderQaResult(unavailableQa);

  const nliSection = mockResultsContainer.querySelector(".qa-nli-section");
  assert.ok(nliSection.classList.contains("qa-nli-status-unavailable"));

  const badge = mockResultsContainer.querySelector(".qa-nli-badge-unavailable");
  assert.ok(badge, "Unavailable badge must exist");
  assert.equal(badge.textContent, "Validation unavailable");

  // Reason paragraph
  const reasonP = mockResultsContainer.querySelector(".qa-nli-reason");
  assert.ok(reasonP, "Reason paragraph must exist");
  assert.equal(reasonP.textContent, "NLI validation service is temporarily offline.");

  // NEVER fabricate scores or clause IDs
  const scoresPills = mockResultsContainer.querySelectorAll(".qa-nli-score-pill");
  assert.equal(scoresPills.length, 0, "No score pills should ever be rendered for unavailable status");
  const clauseId = mockResultsContainer.querySelector(".qa-nli-clause-id");
  assert.equal(clauseId, null, "No clause ID should be rendered when null");
});

test("renderQaResult: unavailable status handles various reason codes cleanly", () => {
  const reasons = [
    { code: "no_evidence_supplied", expected: "No supporting clauses were available to validate against." },
    { code: "answer_generation_failed", expected: "Answer generation failed; validation could not be performed." },
    { code: "nli_client_unavailable", expected: "NLI validation service is temporarily offline." },
    { code: "nli_validation_failed", expected: "NLI validation encountered an unexpected processing error." },
    { code: "custom_fallback_reason", expected: "custom_fallback_reason" }
  ];

  for (const { code, expected } of reasons) {
    resetContainer();
    renderQaResult({
      answer: "Sample answer",
      grounded: false,
      available: true,
      nliValidation: {
        status: "unavailable",
        reason: code
      }
    });

    const reasonP = mockResultsContainer.querySelector(".qa-nli-reason");
    assert.equal(reasonP.textContent, expected);
  }
});

test("renderQaResult: does not render scores when scores object has missing/invalid values", () => {
  resetContainer();
  const malformedScoresQa = {
    answer: "Sample answer",
    grounded: true,
    available: true,
    nliValidation: {
      status: "supported",
      scores: {
        entailment: "invalid_not_number",
        neutral: null,
        contradiction: NaN
      },
      bestClauseId: "clause_1"
    }
  };

  renderQaResult(malformedScoresQa);

  const scorePills = mockResultsContainer.querySelectorAll(".qa-nli-score-pill");
  assert.equal(scorePills.length, 0, "Must not render score pills when scores are non-numeric or NaN");

  // But bestClauseId should still render
  const clauseId = mockResultsContainer.querySelector(".qa-nli-clause-id");
  assert.ok(clauseId);
  assert.equal(clauseId.textContent, "clause_1");
});

test("renderQaResult: preserves distinction between Gemini grounded field and NLI verification", () => {
  resetContainer();
  // Case: Gemini claims ungrounded (false), but DeBERTa confirms supported
  const divergentQa = {
    answer: "You must give 30 days notice.",
    grounded: false,
    confidence: 0.1,
    available: true,
    nliValidation: {
      status: "supported",
      label: "entailment",
      scores: { entailment: 0.91, neutral: 0.06, contradiction: 0.03 },
      bestClauseId: "clause_notice_period"
    }
  };

  renderQaResult(divergentQa);

  // Gemini grounded badge reflects false
  const groundedBadge = mockResultsContainer.querySelector(".qa-grounded-badge");
  assert.ok(groundedBadge.classList.contains("qa-grounded-false"));
  assert.ok(groundedBadge.textContent.includes("does not provide enough information"));

  // NLI badge reflects supported independently
  const nliBadge = mockResultsContainer.querySelector(".qa-nli-badge-supported");
  assert.ok(nliBadge);
  assert.ok(nliBadge.textContent.includes("Supported by ToS evidence"));
});

test("renderQaResult: strictly XSS-safe textContent for answer, reason, and bestClauseId", () => {
  resetContainer();
  const xssPayload = {
    answer: "<script>alert('xss-answer')</script><b>Injected</b>",
    grounded: true,
    available: true,
    nliValidation: {
      status: "unavailable",
      bestClauseId: "<img src=x onerror=alert('xss-clause')>",
      reason: "<iframe src='evil.com'></iframe>"
    }
  };

  renderQaResult(xssPayload);

  const answerP = mockResultsContainer.querySelector(".qa-answer-text");
  assert.equal(answerP.textContent, "<script>alert('xss-answer')</script><b>Injected</b>");

  const reasonP = mockResultsContainer.querySelector(".qa-nli-reason");
  assert.equal(reasonP.textContent, "<iframe src='evil.com'></iframe>");
});

// =========================================================================
// Phase 7G-D.8 Evidence Similarity Score Reliability Tests
// =========================================================================

test("Phase 7G-D.8: formatSimilarityScore converts 0.72 to 72% and 0.666 to approximately 67%", () => {
  // 1. 0.72 displays as 72%
  assert.equal(formatSimilarityScore({ similarityScore: 0.72 }), "Similarity: 72%");
  assert.equal(formatPopupSimilarityScore({ similarityScore: 0.72 }), "Similarity: 72%");

  // 2. 0.666 displays as approximately 67%
  assert.equal(formatSimilarityScore({ similarityScore: 0.666 }), "Similarity: 67%");
  assert.equal(formatPopupSimilarityScore({ similarityScore: 0.666 }), "Similarity: 67%");
});

test("Phase 7G-D.8: formatSimilarityScore supports all similarity field name variants", () => {
  // similarityScore
  assert.equal(formatSimilarityScore({ similarityScore: 0.85 }), "Similarity: 85%");
  assert.equal(formatPopupSimilarityScore({ similarityScore: 0.85 }), "Similarity: 85%");

  // similarity
  assert.equal(formatSimilarityScore({ similarity: 0.85 }), "Similarity: 85%");
  assert.equal(formatPopupSimilarityScore({ similarity: 0.85 }), "Similarity: 85%");

  // similarity_score
  assert.equal(formatSimilarityScore({ similarity_score: 0.85 }), "Similarity: 85%");
  assert.equal(formatPopupSimilarityScore({ similarity_score: 0.85 }), "Similarity: 85%");

  // Precedence order: similarityScore > similarity_score > similarity
  assert.equal(formatSimilarityScore({ similarityScore: 0.90, similarity: 0.40 }), "Similarity: 90%");
  assert.equal(formatPopupSimilarityScore({ similarityScore: 0.90, similarity: 0.40 }), "Similarity: 90%");
});

test("Phase 7G-D.8: formatSimilarityScore displays genuine zero as 0%", () => {
  // A genuine zero score from orthogonal vector calculation must show 0%
  assert.equal(formatSimilarityScore({ similarityScore: 0 }), "Similarity: 0%");
  assert.equal(formatPopupSimilarityScore({ similarityScore: 0 }), "Similarity: 0%");
  assert.equal(formatSimilarityScore({ similarity: 0 }), "Similarity: 0%");
  assert.equal(formatPopupSimilarityScore({ similarity_score: 0 }), "Similarity: 0%");
});

test("Phase 7G-D.8: formatSimilarityScore displays 'Similarity unavailable' for missing or invalid scores", () => {
  // Missing or null
  assert.equal(formatSimilarityScore({}), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({}), "Similarity unavailable");
  assert.equal(formatSimilarityScore({ similarityScore: null }), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({ similarityScore: null }), "Similarity unavailable");
  assert.equal(formatSimilarityScore({ similarityScore: undefined }), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({ similarityScore: undefined }), "Similarity unavailable");
  assert.equal(formatSimilarityScore(null), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore(null), "Similarity unavailable");

  // Non-numeric or non-finite values
  assert.equal(formatSimilarityScore({ similarityScore: NaN }), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({ similarityScore: NaN }), "Similarity unavailable");
  assert.equal(formatSimilarityScore({ similarityScore: Infinity }), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({ similarityScore: Infinity }), "Similarity unavailable");
  assert.equal(formatSimilarityScore({ similarityScore: "not-a-number" }), "Similarity unavailable");
  assert.equal(formatPopupSimilarityScore({ similarityScore: "not-a-number" }), "Similarity unavailable");
});

test("Phase 7G-D.8: renderQaResult correctly renders similarity badges across evidence list", () => {
  resetContainer();
  const testQa = {
    answer: "You can cancel your subscription in account settings.",
    grounded: true,
    confidence: 0.95,
    available: true,
    nliValidation: {
      status: "supported",
      label: "entailment",
      scores: { entailment: 0.94, neutral: 0.04, contradiction: 0.02 },
      bestClauseId: "clause_cancel"
    },
    evidence: [
      { clauseId: "clause_cancel", section: "Cancellation", text: "You may cancel anytime.", similarityScore: 0.72 },
      { clauseId: "clause_refund", section: "Billing", text: "Refunds upon request.", similarity: 0.666 },
      { clauseId: "clause_zero", section: "Zero Score", text: "Orthogonal clause.", similarity_score: 0 },
      { clauseId: "clause_fallback", section: "Keyword Match", text: "Clause without score." }
    ]
  };

  renderQaResult(testQa);

  const evidenceScores = mockResultsContainer.querySelectorAll(".qa-evidence-score");
  assert.equal(evidenceScores.length, 4, "Must render exactly 4 evidence score badges");

  // Verify each badge
  assert.equal(evidenceScores[0].textContent, "Similarity: 72%");
  assert.equal(evidenceScores[1].textContent, "Similarity: 67%");
  assert.equal(evidenceScores[2].textContent, "Similarity: 0%");
  assert.equal(evidenceScores[3].textContent, "Similarity unavailable");

  // Verify NLI status badge remains supported / entailment
  const nliBadge = mockResultsContainer.querySelector(".qa-nli-badge-supported");
  assert.ok(nliBadge);
  assert.ok(nliBadge.textContent.includes("Supported"));

  // Verify best evidence clause remains clause_cancel
  const bestClause = mockResultsContainer.querySelector(".qa-nli-clause-id");
  assert.ok(bestClause);
  assert.equal(bestClause.textContent, "clause_cancel");
});
