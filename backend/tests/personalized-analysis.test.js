import test from "node:test";
import assert from "node:assert/strict";

import {
  RISK_CATEGORIES,
  getRiskCategory,
  normalizeCategoryId,
  getAllRiskCategories
} from "../src/analysis/risk-categories.js";

import {
  validateUserPreferences,
  getDefaultPreferences,
  getCategoryWeight,
  MIN_WEIGHT,
  MAX_WEIGHT
} from "../src/analysis/user-preferences.js";

import {
  calculateImpactMagnitude,
  generatePlainEnglishExplanation,
  IMPACT_LEVELS
} from "../src/analysis/impact-evaluator.js";

import {
  rankFindings,
  computePersonalizedSummary
} from "../src/analysis/personalized-ranker.js";

import { compareClauses } from "../src/analysis/semantic/clause-comparator.js";
import { app } from "../server.js";

// =========================================================================
// 1. Centralized Risk Categories Tests
// =========================================================================

test("normalizeCategoryId returns canonical ID for direct and alias matches", () => {
  assert.equal(normalizeCategoryId("ARBITRATION"), "ARBITRATION");
  assert.equal(normalizeCategoryId("arbitration"), "ARBITRATION");
  assert.equal(normalizeCategoryId("class_action"), "ARBITRATION");
  assert.equal(normalizeCategoryId("privacy"), "PRIVACY_DATA_SHARING");
  assert.equal(normalizeCategoryId("data_sharing"), "PRIVACY_DATA_SHARING");
  assert.equal(normalizeCategoryId("subscription"), "AUTO_RENEWAL");
  assert.equal(normalizeCategoryId("billing"), "AUTO_RENEWAL");
  assert.equal(normalizeCategoryId("ip"), "CONTENT_LICENSE");
  assert.equal(normalizeCategoryId("unknown_xyz"), "OTHER");
  assert.equal(normalizeCategoryId(null), "OTHER");
});

test("getRiskCategory returns complete metadata object with required fields", () => {
  const cat = getRiskCategory("privacy");
  assert.equal(cat.id, "PRIVACY_DATA_SHARING");
  assert.ok(cat.displayName);
  assert.ok(cat.description);
  assert.ok(typeof cat.defaultWeight === "number");
  assert.ok(cat.severityCharacteristics);
  assert.ok(cat.impactDomain);
  assert.ok(cat.whatToWatchFor);
});

test("getAllRiskCategories returns all defined categories as an array", () => {
  const all = getAllRiskCategories();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 14);
  const ids = all.map((c) => c.id);
  assert.ok(ids.includes("ARBITRATION"));
  assert.ok(ids.includes("PRIVACY_DATA_SHARING"));
  assert.ok(ids.includes("AUTO_RENEWAL"));
  assert.ok(ids.includes("USER_CONTENT_RIGHTS"));
});

// =========================================================================
// 2. User Concern Preferences & Validation Tests
// =========================================================================

test("getDefaultPreferences populates all categories with safe defaults", () => {
  const defaults = getDefaultPreferences();
  assert.ok(defaults.ARBITRATION >= 1 && defaults.ARBITRATION <= 5);
  assert.ok(defaults.PRIVACY_DATA_SHARING >= 1 && defaults.PRIVACY_DATA_SHARING <= 5);
  assert.equal(typeof defaults.OTHER, "number");
});

test("validateUserPreferences clamps weights between 1 and 5 and handles aliases", () => {
  const input = {
    privacy: 10,       // should clamp to 5
    arbitration: -2,    // should clamp to 1
    subscription: 4.2,  // should round to 4
    invalidKey: "abc"   // invalid weight, should ignore and use default
  };

  const prefs = validateUserPreferences(input);
  assert.equal(prefs.PRIVACY_DATA_SHARING, 5);
  assert.equal(prefs.ARBITRATION, 1);
  assert.equal(prefs.AUTO_RENEWAL, 4);
  // Unspecified categories retain their defaults
  assert.equal(prefs.DATA_RETENTION, RISK_CATEGORIES.DATA_RETENTION.defaultWeight);
});

test("validateUserPreferences safely falls back to defaults for invalid inputs", () => {
  assert.ok(validateUserPreferences(null).ARBITRATION > 0);
  assert.ok(validateUserPreferences("string").PRIVACY_DATA_SHARING > 0);
  assert.ok(validateUserPreferences([1, 2, 3]).AUTO_RENEWAL > 0);
});

test("getCategoryWeight extracts effective weight for category or alias", () => {
  const prefs = { ARBITRATION: 5, AUTO_RENEWAL: 2 };
  assert.equal(getCategoryWeight(prefs, "arbitration"), 5);
  assert.equal(getCategoryWeight(prefs, "subscription"), 2);
  // Fallback to category default when missing from preferences
  assert.equal(getCategoryWeight(prefs, "PRIVACY_DATA_SHARING"), RISK_CATEGORIES.PRIVACY_DATA_SHARING.defaultWeight);
});

// =========================================================================
// 3. Impact Evaluator & Plain-English Explanations
// =========================================================================

test("calculateImpactMagnitude computes Critical for high severity + high priority", () => {
  const highFinding = { severity: "HIGH", confidence: 0.95 };
  const magnitude = calculateImpactMagnitude(highFinding, 5);
  assert.equal(magnitude, IMPACT_LEVELS.CRITICAL);
});

test("calculateImpactMagnitude lowers impact when user concern is reduced", () => {
  const highFinding = { severity: "HIGH", confidence: 0.85 };
  // When user explicitly sets weight to 1 (minimal concern), impact drops from Critical/High to Low
  const magnitude = calculateImpactMagnitude(highFinding, 1);
  assert.equal(magnitude, IMPACT_LEVELS.LOW);

  // When weight is 2, it evaluates to Medium
  const magnitudeMed = calculateImpactMagnitude(highFinding, 2);
  assert.equal(magnitudeMed, IMPACT_LEVELS.MEDIUM);
});

test("calculateImpactMagnitude computes Low for low severity items", () => {
  const lowFinding = { severity: "LOW", confidence: 0.70 };
  const magnitude = calculateImpactMagnitude(lowFinding, 2);
  assert.equal(magnitude, IMPACT_LEVELS.LOW);
});

test("calculateImpactMagnitude: Optional Recurring Payment Feature with LOW severity evaluates to Low under default user preferences", () => {
  const optionalAutopayFinding = {
    title: "Optional Recurring Payment Feature",
    categoryId: "AUTO_RENEWAL",
    severity: "LOW",
    confidence: 0.93,
    evidence: "You may choose to set up recurring payments of Your bill payment account using Autopay."
  };

  // Under AUTO_RENEWAL category default weight (4)
  const defaultAutoRenewalWeight = 4;
  const impactDefault = calculateImpactMagnitude(optionalAutopayFinding, defaultAutoRenewalWeight);
  assert.equal(impactDefault, IMPACT_LEVELS.LOW, "Optional autopay must evaluate to Low impact under default weight (4)");

  // Under neutral default weight (3)
  const impactNeutral = calculateImpactMagnitude(optionalAutopayFinding, 3);
  assert.equal(impactNeutral, IMPACT_LEVELS.LOW, "Optional autopay must evaluate to Low impact under weight 3");

  // Under explicitly configured maximum user preference (weight 5), elevated to Medium but never Critical/High
  const impactMax = calculateImpactMagnitude(optionalAutopayFinding, 5);
  assert.equal(impactMax, IMPACT_LEVELS.MEDIUM, "Explicit max preference (5) elevates optional autopay to Medium, but must not falsely imply mandatory renewal (High/Critical)");
});

test("calculateImpactMagnitude: genuine automatic renewal retains High or Critical impact", () => {
  const genuineRenewalFinding = {
    title: "Automatic Subscription Renewal with Cancellation Restrictions",
    categoryId: "AUTO_RENEWAL",
    severity: "HIGH",
    confidence: 0.95,
    evidence: "Your subscription automatically renews unless you cancel at least 30 days prior to the renewal date."
  };

  // Under default weight 4: severity points 4 * 4 * (0.8 + 0.95*0.2 = 0.99) = 15.84 >= 11 (High)
  assert.equal(calculateImpactMagnitude(genuineRenewalFinding, 4), IMPACT_LEVELS.HIGH);

  // Under maximum weight 5: severity points 4 * 5 * 0.99 = 19.8 >= 16 (Critical)
  assert.equal(calculateImpactMagnitude(genuineRenewalFinding, 5), IMPACT_LEVELS.CRITICAL);
});

test("calculateImpactMagnitude: does not globally force all LOW-severity findings to Low impact", () => {
  // A standard LOW-severity finding with high confidence and weight 4
  const standardLowFinding = {
    title: "Unilateral Forum Selection",
    categoryId: "GOVERNING_LAW",
    severity: "LOW",
    confidence: 0.95
  };

  // Composite: 2 (LOW points) * 4 (weight) * 0.99 = 7.92 >= 6 (Medium)
  const magnitude = calculateImpactMagnitude(standardLowFinding, 4);
  assert.equal(magnitude, IMPACT_LEVELS.MEDIUM, "Standard LOW findings with high user weight still follow composite scoring scale");
});

test("generatePlainEnglishExplanation constructs transparent answers without altering evidence", () => {
  const finding = {
    categoryId: "ARBITRATION",
    title: "Mandatory Arbitration",
    evidence: "Any dispute shall be settled by binding arbitration in Delaware.",
    explanation: "This clause waives court access.",
    whyItMatters: "You cannot file a lawsuit in regular court."
  };

  const plain = generatePlainEnglishExplanation(finding);
  assert.ok(plain.summary);
  assert.ok(plain.whatItSays);
  assert.ok(plain.whyFlagged);
  assert.ok(plain.category.includes("Arbitration"));
  assert.ok(plain.whyItMatters);
  assert.ok(plain.whatToWatchFor);
  assert.equal(plain.originalEvidence, finding.evidence);
});

// =========================================================================
// 4. Personalized Risk Ranking Engine Tests
// =========================================================================

test("rankFindings reranks clauses dynamically based on differing user weights", () => {
  const sampleFindings = [
    {
      findingId: "F1",
      ruleId: "RULE_ARBITRATION",
      categoryId: "ARBITRATION",
      title: "Arbitration Requirement",
      severity: "HIGH",
      confidence: 0.90,
      evidence: "All claims must be submitted to binding arbitration.",
      explanation: "Waives court rights."
    },
    {
      findingId: "F2",
      ruleId: "RULE_DATA_SHARING",
      categoryId: "PRIVACY_DATA_SHARING",
      title: "Data Broker Sharing",
      severity: "HIGH",
      confidence: 0.90,
      evidence: "We share device telemetry with advertising affiliates.",
      explanation: "Shares private data."
    }
  ];

  // Case A: User prioritizes Arbitration (5) over Privacy (1)
  const rankedUserA = rankFindings(sampleFindings, {
    arbitration: 5,
    privacy: 1
  });

  assert.equal(rankedUserA[0].categoryId, "ARBITRATION");
  assert.equal(rankedUserA[0].rank, 1);
  assert.ok(rankedUserA[0].personalizedScore > rankedUserA[1].personalizedScore);
  assert.ok(rankedUserA[0].rankingReason.includes("Arbitration"));

  // Case B: User prioritizes Privacy (5) over Arbitration (1)
  const rankedUserB = rankFindings(sampleFindings, {
    arbitration: 1,
    privacy: 5
  });

  assert.equal(rankedUserB[0].categoryId, "PRIVACY_DATA_SHARING");
  assert.equal(rankedUserB[0].rank, 1);
  assert.ok(rankedUserB[0].personalizedScore > rankedUserB[1].personalizedScore);
  assert.ok(rankedUserB[0].rankingReason.includes("Data Sharing"));
});

test("rankFindings preserves all original Phase 3/4 finding fields", () => {
  const original = [
    {
      findingId: "ORIG_1",
      ruleId: "RULE_AUTO_RENEWAL",
      categoryId: "AUTO_RENEWAL",
      category: "Subscriptions & Billing",
      title: "Auto-Renewal Provision",
      severity: "MEDIUM",
      confidence: 0.88,
      evidence: "Your subscription renews automatically on month-to-month terms.",
      explanation: "Billed repeatedly until canceled.",
      pageNumber: 2,
      segmentIndex: 5,
      detectionMethod: "rule_based",
      ruleDetected: true,
      aiDetected: false
    }
  ];

  const ranked = rankFindings(original);
  assert.equal(ranked.length, 1);
  const item = ranked[0];

  // Original preserved
  assert.equal(item.findingId, "ORIG_1");
  assert.equal(item.ruleId, "RULE_AUTO_RENEWAL");
  assert.equal(item.pageNumber, 2);
  assert.equal(item.segmentIndex, 5);
  assert.equal(item.ruleDetected, true);
  assert.equal(item.aiDetected, false);

  // New Phase 5 properties added
  assert.equal(item.rank, 1);
  assert.ok(typeof item.personalizedScore === "number");
  assert.ok(item.impactMagnitude);
  assert.ok(item.rankingReason);
  assert.ok(item.plainEnglishExplanation);
});

test("computePersonalizedSummary calculates distribution, score and top categories", () => {
  const ranked = [
    { categoryDisplayName: "Arbitration", impactMagnitude: "Critical", personalizedScore: 92 },
    { categoryDisplayName: "Data Sharing", impactMagnitude: "High", personalizedScore: 78 },
    { categoryDisplayName: "Subscriptions", impactMagnitude: "Low", personalizedScore: 35 }
  ];

  const summary = computePersonalizedSummary(ranked);
  assert.equal(summary.totalRanked, 3);
  assert.equal(summary.impactDistribution.Critical, 1);
  assert.equal(summary.impactDistribution.High, 1);
  assert.equal(summary.impactDistribution.Low, 1);
  assert.ok(summary.averagePersonalizedScore > 60);
  assert.ok(summary.topConcernCategories.length > 0);
});

// =========================================================================
// 5. Semantic Change & Clause Comparison Tests
// =========================================================================

test("compareClauses detects identical clauses without making AI calls", async () => {
  const clause = "You agree to resolve all disputes solely through arbitration.";
  const result = await compareClauses({
    oldClauseText: clause,
    newClauseText: clause
  });

  assert.equal(result.available, true);
  assert.equal(result.method, "exact_match");
  assert.equal(result.similarityScore, 1.0);
  assert.equal(result.changeMagnitude, "NONE");
  assert.equal(result.userRiskDelta, "NEUTRAL");
});

test("compareClauses throws 400 for empty or missing inputs", async () => {
  await assert.rejects(
    () => compareClauses({ oldClauseText: "", newClauseText: "Some text" }),
    /Both 'oldClauseText' and 'newClauseText' must be provided/
  );
  await assert.rejects(
    () => compareClauses(null),
    /Both 'oldClauseText' and 'newClauseText' must be provided/
  );
});

test("compareClauses returns clean unavailable state with lexical fallback when no AI key", async () => {
  const oldText = "We may update these terms by posting a notice 30 days in advance.";
  const newText = "We reserve the right to modify these terms immediately without prior notice.";

  const result = await compareClauses(
    { oldClauseText: oldText, newClauseText: newText },
    { provider: { name: "null", apiKey: null } }
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "ai_provider_unavailable");
  assert.equal(result.method, "lexical_fallback");
  assert.ok(typeof result.similarityScore === "number");
  assert.ok(result.lexicalMetrics);
  assert.ok(result.oldClauseEvidence);
  assert.ok(result.newClauseEvidence);
});

test("compareClauses normalizes structured AI response when AI provider succeeds", async () => {
  const mockAiProvider = {
    name: "mock_ai",
    apiKey: "dummy_key",
    analyzeClause: async () => ({
      available: true,
      data: {
        similarityScore: 0.45,
        changeMagnitude: "SIGNIFICANT",
        impactDomain: "Dispute Resolution",
        summary: "The clause eliminated your right to a 30-day notice window.",
        detailedExplanation: "In the new version, terms can be changed immediately without notice.",
        userRiskDelta: "INCREASED_RISK",
        addedObligations: ["Immediate binding effect"],
        removedProtections: ["30-day prior notice commitment"]
      }
    })
  };

  const result = await compareClauses(
    {
      oldClauseText: "We give 30 days notice.",
      newClauseText: "We change terms instantly."
    },
    { provider: mockAiProvider }
  );

  assert.equal(result.available, true);
  assert.equal(result.method, "semantic_ai");
  assert.equal(result.similarityScore, 0.45);
  assert.equal(result.changeMagnitude, "SIGNIFICANT");
  assert.equal(result.userRiskDelta, "INCREASED_RISK");
  assert.ok(result.addedObligations.length > 0);
  assert.ok(result.removedProtections.length > 0);
});

// =========================================================================
// 6. HTTP API Endpoint Tests for Phase 5
// =========================================================================

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test("GET /api/analyze/categories returns list of all risk categories and default weights", async () => {
  const res = await fetch(`${baseUrl}/api/analyze/categories`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.categories));
  assert.ok(data.categories.length >= 14);

  const arbitrationCat = data.categories.find((c) => c.id === "ARBITRATION");
  assert.ok(arbitrationCat);
  assert.equal(arbitrationCat.defaultWeight, 5);
});

test("POST /api/analyze accepts userPreferences and returns personalized rankedFindings", async () => {
  const policyText = `
    1. Dispute Resolution and Mandatory Arbitration.
    You agree to resolve all controversies solely through private binding arbitration. You expressly waive any right to participate in a class action lawsuit.

    2. Automatic Billing Renewal.
    Subscriptions renew each month automatically unless canceled 48 hours before the end of the term.
  `;

  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      policyText,
      userPreferences: {
        subscription: 5,
        arbitration: 1
      }
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.analysis);

  // Both findings and rankedFindings are present
  assert.ok(Array.isArray(data.analysis.findings));
  assert.ok(Array.isArray(data.analysis.rankedFindings));
  assert.ok(data.analysis.rankedFindings.length > 0);

  // Summary includes personalized block
  assert.ok(data.analysis.summary.personalized);
  assert.ok(data.analysis.summary.personalized.totalRanked > 0);

  // Each ranked finding includes Phase 5 fields
  const first = data.analysis.rankedFindings[0];
  assert.equal(first.rank, 1);
  assert.ok(typeof first.personalizedScore === "number");
  assert.ok(first.impactMagnitude);
  assert.ok(first.rankingReason);
  assert.ok(first.plainEnglishExplanation);
});

test("POST /api/analyze/compare rejects missing clause texts with 400", async () => {
  const res = await fetch(`${baseUrl}/api/analyze/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldClauseText: "" })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("POST /api/analyze/compare compares clauses and returns structured result", async () => {
  const res = await fetch(`${baseUrl}/api/analyze/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      oldClauseText: "You may opt out of arbitration within 30 days of registration.",
      newClauseText: "All disputes must be settled by mandatory binding arbitration with no opt-out."
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.comparison);
  assert.ok(data.comparison.changeMagnitude);
  assert.ok(data.comparison.lexicalMetrics);
});
