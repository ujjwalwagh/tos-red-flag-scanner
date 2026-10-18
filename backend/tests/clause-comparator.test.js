import test from "node:test";
import assert from "node:assert/strict";

import {
  compareClauses,
  extractDurations,
  extractCurrencies,
  extractBillingFrequencies,
  analyzeClauseDifferences
} from "../src/analysis/semantic/clause-comparator.js";

// =========================================================================
// Focused Verification of Improved Layered Clause Comparator (Phase 9.5D)
// =========================================================================

test("A. Exact identical clause returns NONE magnitude and NEUTRAL risk delta", async () => {
  const clause = "You may use our service solely for personal, non-commercial purposes in compliance with these terms.";
  const result = await compareClauses({
    oldClauseText: clause,
    newClauseText: clause
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "NONE");
  assert.equal(result.userRiskDelta, "NEUTRAL");
  assert.equal(result.similarityScore, 1.0);
});

test("B. Pure paraphrase with synonymous legal terminology returns MINOR and NEUTRAL", async () => {
  const oldText = "You represent and warrant that you own or have obtained all necessary licenses to publish your submissions.";
  const newText = "You represent and confirm that you possess all necessary rights and licenses to publish your submitted materials.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "MINOR");
  assert.equal(result.userRiskDelta, "NEUTRAL");
});

test("C. Numerical deadline shift: 3 days -> 7 days notice returns MODERATE and INCREASED_RISK", async () => {
  const oldText = "You may cancel your monthly subscription up to 3 days prior to the scheduled renewal billing date.";
  const newText = "You may cancel your monthly subscription up to 7 days prior to the scheduled renewal billing date.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "MODERATE");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("D. Monetary liability cap reduction: $1,000 -> $50 returns SIGNIFICANT and INCREASED_RISK", async () => {
  const oldText = "Our aggregate liability for all claims shall not exceed one thousand dollars ($1,000.00).";
  const newText = "Our aggregate liability for all claims shall not exceed fifty dollars ($50.00).";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("E. Modal verb & channel shift: 'may cancel online' -> 'must telephone support' returns SIGNIFICANT and INCREASED_RISK", async () => {
  const oldText = "Users may easily cancel recurring memberships online at any time via dashboard settings.";
  const newText = "To cancel your subscription, you must telephone our customer service center on business days.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("F. Billing interval conversion: monthly -> annual lock-in returns SIGNIFICANT and INCREASED_RISK", async () => {
  const oldText = "Subscriptions are billed on a flexible monthly basis and may be canceled each month.";
  const newText = "Subscriptions are billed on an upfront annual basis and auto-renew automatically every 12 months with non-refundable billing.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("G. Cancellation/opt-out window shortened: 60 days -> 14 days returns SIGNIFICANT and INCREASED_RISK", async () => {
  const oldText = "You may opt out of this arbitration agreement by notifying us in writing within 60 days of opening your account.";
  const newText = "You may opt out of this arbitration agreement by notifying us in writing within 14 days of opening your account.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("H. Cancellation/opt-out window extended or opt-out added returns DECREASED_RISK", async () => {
  const oldText = "Arbitration under this section is mandatory and strictly binding on all registered users without exception.";
  const newText = "You may opt out of this arbitration provision by emailing optout@company.com within 30 days of creating your account.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "MODERATE");
  assert.equal(result.userRiskDelta, "DECREASED_RISK");
});

test("I. Risk keyword disappears but restrictive meaning remains: does NOT falsely report DECREASED_RISK", async () => {
  const oldText = "You can easily cancel your recurring subscription online at any time by clicking cancel in your account settings.";
  const newText = "To cancel your subscription, you must telephone our customer service center between 9am and 5pm Eastern time on business days.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.notEqual(result.userRiskDelta, "DECREASED_RISK");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
});

test("J. Genuine critical arbitration addition returns CRITICAL and INCREASED_RISK", async () => {
  const oldText = "All disputes will be resolved through standard judicial proceedings in a competent civil court.";
  const newText = "You agree that all disputes must be resolved solely through confidential, individual binding arbitration.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "CRITICAL");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("K. Genuine critical data-sharing addition returns CRITICAL and INCREASED_RISK", async () => {
  const oldText = "We use your personal data solely to provide and operate the core cloud application.";
  const newText = "We may sell, license, or transfer your personal profile data and browsing telemetry to commercial data brokers.";

  const result = await compareClauses({
    oldClauseText: oldText,
    newClauseText: newText
  });

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "CRITICAL");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
});

test("L. Python embedding service unavailable: gracefully falls back without crashing", async () => {
  const mockFailingAiClient = {
    enabled: true,
    compareClausesSemantic: async () => {
      throw new Error("Connection refused (ECONNREFUSED)");
    }
  };

  const oldText = "We give you 30 days notice before updating these terms.";
  const newText = "We may modify these terms at any time in our sole discretion without notice.";

  const result = await compareClauses(
    { oldClauseText: oldText, newClauseText: newText },
    { aiClient: mockFailingAiClient }
  );

  assert.equal(result.available, true);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
  assert.ok(result.lexicalMetrics);
});

test("M. Lexical fallback returns valid structured output with jaccard metrics", async () => {
  const oldText = "Basic text version one.";
  const newText = "Basic text version two.";

  const result = await compareClauses(
    { oldClauseText: oldText, newClauseText: newText },
    { provider: { name: "null", apiKey: null } }
  );

  assert.equal(result.available, false);
  assert.equal(result.method, "lexical_fallback");
  assert.ok(typeof result.similarityScore === "number");
  assert.ok(result.lexicalMetrics);
  assert.ok(result.oldClauseEvidence);
  assert.ok(result.newClauseEvidence);
});

test("Entity Extractors: correctly parse durations, currencies, and billing intervals", () => {
  const dur = extractDurations("Please give 30 days or 2 weeks advance notice.");
  assert.equal(dur.length, 2);
  assert.equal(dur[0].days, 30);
  assert.equal(dur[1].days, 14);

  const curr = extractCurrencies("Capped at $1,000.00 or $50 maximum.");
  assert.equal(curr.length, 2);
  assert.equal(curr[0].val, 1000);
  assert.equal(curr[1].val, 50);

  const freq = extractBillingFrequencies("Switch from monthly billing to annual subscription.");
  assert.equal(freq.isMonthly, true);
  assert.equal(freq.isAnnual, true);
});
