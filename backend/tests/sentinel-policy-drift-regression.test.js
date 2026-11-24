import test from "node:test";
import assert from "node:assert/strict";

import { calculatePolicyDrift } from "../src/sentinel/drift-engine.js";
import { segmentDocumentPages } from "../src/processing/segmentation/clause-segmenter.js";
import { analyzeSegment } from "../src/analysis/rule-engine/clause-analyzer.js";

test("Sentinel Regression: accurately calculates policy drift on raw policy text", async () => {
  const baseText =
    "Users may cancel their subscription at any time. We will provide a refund for unused subscription periods. We will not share personal information with third parties without user consent.";

  const updatedText =
    "Users may cancel their subscription at any time, but no refunds will be provided. We may share personal information with third-party advertising partners. We reserve the right to modify these terms at any time without prior notice.";

  const drift = await calculatePolicyDrift({
    vendorName: "Acme Cloud",
    baseVersion: {
      versionLabel: "Baseline Version",
      policyText: baseText
    },
    currentVersion: {
      versionLabel: "Updated Version",
      policyText: updatedText
    }
  });

  assert.equal(drift.driftDirection, "MORE_RESTRICTIVE");
  assert.equal(drift.driftMagnitude, "HIGH");
  assert.equal(drift.magnitudeScore, 75);
  assert.equal(drift.newRestrictions.length, 3);
  assert.equal(drift.removedRestrictions.length, 0);

  const categories = drift.newRestrictions.map((r) => r.categoryId).sort();
  assert.deepEqual(categories, [
    "PRIVACY_DATA_SHARING",
    "REFUND_RESTRICTIONS",
    "UNILATERAL_CHANGES"
  ]);

  const refund = drift.newRestrictions.find((r) => r.categoryId === "REFUND_RESTRICTIONS");
  assert.ok(refund);
  assert.equal(refund.severity, "HIGH");
  assert.match(refund.evidence, /no refunds will be provided/i);

  const unilateral = drift.newRestrictions.find((r) => r.categoryId === "UNILATERAL_CHANGES");
  assert.ok(unilateral);
  assert.equal(unilateral.severity, "HIGH");
  assert.match(unilateral.evidence, /reserve the right to modify these terms/i);

  const dataSharing = drift.newRestrictions.find((r) => r.categoryId === "PRIVACY_DATA_SHARING");
  assert.ok(dataSharing);
  assert.equal(dataSharing.severity, "MEDIUM");
  assert.match(dataSharing.evidence, /third-party advertising partners/i);
});

test("ClauseSegmenter: gracefully handles pages with text, rawText, or normalizedText", () => {
  const pageWithText = segmentDocumentPages([{ pageNumber: 1, text: "Section 1. Terms of Service.\n\nAll users must comply." }]);
  assert.ok(pageWithText.length > 0, "Pages with .text should produce segments");

  const pageWithRawText = segmentDocumentPages([{ pageNumber: 1, rawText: "Section 1. Terms of Service.\n\nAll users must comply." }]);
  assert.ok(pageWithRawText.length > 0, "Pages with .rawText should produce segments");

  const pageWithNormalizedText = segmentDocumentPages([{ pageNumber: 1, normalizedText: "Section 1. Terms of Service.\n\nAll users must comply." }]);
  assert.ok(pageWithNormalizedText.length > 0, "Pages with .normalizedText should produce segments");
});

test("Rule Engine: RULE_DATA_SHARING distinguishes protective covenants from third-party advertising disclosures", () => {
  const protectiveClause = {
    segmentIndex: 0,
    pageNumber: 1,
    title: "Privacy Section",
    clauseCategory: "privacy",
    text: "We will not share personal information with third parties without user consent."
  };
  const protectiveFindings = analyzeSegment(protectiveClause);
  const falsePositiveSharing = protectiveFindings.filter((f) => f.ruleId === "RULE_DATA_SHARING");
  assert.equal(falsePositiveSharing.length, 0, "Protective covenant must not trigger RULE_DATA_SHARING");

  const commercialClause = {
    segmentIndex: 1,
    pageNumber: 1,
    title: "Privacy Section",
    clauseCategory: "privacy",
    text: "We may share personal information with third-party advertising partners."
  };
  const commercialFindings = analyzeSegment(commercialClause);
  const detectedSharing = commercialFindings.filter((f) => f.ruleId === "RULE_DATA_SHARING");
  assert.equal(detectedSharing.length, 1, "Disclosing to third-party advertising partners must trigger RULE_DATA_SHARING");
  assert.equal(detectedSharing[0].categoryId, "PRIVACY_DATA_SHARING");
});
