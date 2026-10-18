import test from "node:test";
import assert from "node:assert/strict";

import {
  precisionAtK,
  recallAtK,
  confusionMatrix,
  classificationMetrics,
  macroF1
} from "../src/evaluation/metrics.js";

import { evaluateRanking } from "../src/evaluation/ranking-evaluator.js";
import { evaluateChangeImpact } from "../src/evaluation/change-evaluator.js";

// =========================================================================
// 1. Metrics Unit Tests: precisionAtK & recallAtK
// =========================================================================

test("precisionAtK: perfect match returns 1.0", () => {
  const predicted = ["c1", "c2", "c3", "c4", "c5"];
  const groundTruth = ["c1", "c2", "c3", "c4", "c5"];
  const score = precisionAtK(predicted, groundTruth, 5);
  assert.equal(score, 1.0);
});

test("recallAtK: perfect match returns 1.0", () => {
  const predicted = ["c1", "c2", "c3", "c4", "c5"];
  const groundTruth = ["c1", "c2", "c3", "c4", "c5"];
  const score = recallAtK(predicted, groundTruth, 5);
  assert.equal(score, 1.0);
});

test("precisionAtK & recallAtK: partial overlap returns expected proportions", () => {
  // 3 out of 5 predicted are relevant
  const predicted = ["c1", "c2", "c3", "c_irrel_1", "c_irrel_2"];
  // 4 items are in ground truth
  const groundTruth = ["c1", "c2", "c3", "c4"];

  const p5 = precisionAtK(predicted, groundTruth, 5);
  const r5 = recallAtK(predicted, groundTruth, 5);

  assert.equal(p5, 3 / 5); // 0.6
  assert.equal(r5, 3 / 4); // 0.75
});

test("precisionAtK & recallAtK: zero overlap returns 0.0", () => {
  const predicted = ["x1", "x2", "x3", "x4", "x5"];
  const groundTruth = ["y1", "y2", "y3"];

  assert.equal(precisionAtK(predicted, groundTruth, 5), 0.0);
  assert.equal(recallAtK(predicted, groundTruth, 5), 0.0);
});

test("precisionAtK & recallAtK: empty predictions returns 0.0", () => {
  const groundTruth = ["c1", "c2"];
  assert.equal(precisionAtK([], groundTruth, 5), 0.0);
  assert.equal(recallAtK([], groundTruth, 5), 0.0);
  assert.equal(precisionAtK(null, groundTruth, 5), 0.0);
  assert.equal(recallAtK(null, groundTruth, 5), 0.0);
});

test("precisionAtK & recallAtK: empty ground truth protected against division by zero", () => {
  const predicted = ["c1", "c2", "c3"];
  assert.equal(precisionAtK(predicted, [], 5), 0.0);
  assert.equal(recallAtK(predicted, [], 5), 0.0);
  assert.equal(precisionAtK(predicted, null, 5), 0.0);
  assert.equal(recallAtK(predicted, null, 5), 0.0);
});

test("precisionAtK & recallAtK: duplicate IDs handled safely via Set deduplication", () => {
  const predicted = ["c1", "c1", "c1", "c2", "c3"];
  const groundTruth = ["c1", "c2", "c3", "c4", "c5"];

  // Unique top-5 hits = c1, c2, c3 (3 hits out of k=5)
  assert.equal(precisionAtK(predicted, groundTruth, 5), 3 / 5);
  // 3 hits out of 5 relevant
  assert.equal(recallAtK(predicted, groundTruth, 5), 3 / 5);
});

test("precisionAtK & recallAtK: k <= 0 or invalid k returns 0.0", () => {
  const predicted = ["c1", "c2"];
  const groundTruth = ["c1", "c2"];
  assert.equal(precisionAtK(predicted, groundTruth, 0), 0.0);
  assert.equal(precisionAtK(predicted, groundTruth, -1), 0.0);
  assert.equal(precisionAtK(predicted, groundTruth, "invalid"), 0.0);
  assert.equal(recallAtK(predicted, groundTruth, 0), 0.0);
  assert.equal(recallAtK(predicted, groundTruth, -5), 0.0);
});

test("precisionAtK & recallAtK: k greater than prediction count slices safely", () => {
  const predicted = ["c1", "c2"]; // only 2 items
  const groundTruth = ["c1", "c2", "c3"];
  // 2 hits out of k=5 -> 2/5 = 0.4
  assert.equal(precisionAtK(predicted, groundTruth, 5), 0.4);
  // 2 hits out of 3 ground truth -> 2/3
  assert.equal(recallAtK(predicted, groundTruth, 5), 0.6667);
});

// =========================================================================
// 2. Metrics Unit Tests: Confusion Matrix & Classification Metrics
// =========================================================================

test("confusionMatrix & classificationMetrics: perfect match yields 1.0 metrics", () => {
  const preds = ["A", "B", "C", "A", "B"];
  const gts = ["A", "B", "C", "A", "B"];
  const labels = ["A", "B", "C"];

  const cm = confusionMatrix(preds, gts, labels);
  assert.equal(cm.perClass.A.tp, 2);
  assert.equal(cm.perClass.A.fp, 0);
  assert.equal(cm.perClass.A.fn, 0);

  const metrics = classificationMetrics(preds, gts, labels);
  assert.equal(metrics.accuracy, 1.0);
  assert.equal(metrics.precision, 1.0);
  assert.equal(metrics.recall, 1.0);
  assert.equal(metrics.f1, 1.0);
  assert.equal(metrics.macroF1, 1.0);
});

test("classificationMetrics: handles zero true positives without NaN", () => {
  const preds = ["A", "A", "A"];
  const gts = ["B", "B", "B"];
  const labels = ["A", "B"];

  const metrics = classificationMetrics(preds, gts, labels);
  assert.equal(metrics.accuracy, 0.0);
  assert.equal(metrics.precision, 0.0);
  assert.equal(metrics.recall, 0.0);
  assert.equal(metrics.f1, 0.0);
  assert.equal(metrics.macroF1, 0.0);
  assert.ok(Number.isFinite(metrics.macroF1));
});

test("classificationMetrics: handles empty arrays safely", () => {
  const metrics = classificationMetrics([], [], ["A", "B"]);
  assert.equal(metrics.sampleCount, 0);
  assert.equal(metrics.macroF1, 0.0);
  assert.ok(Number.isFinite(metrics.accuracy));
});

test("macroF1 returns scalar float in range [0, 1]", () => {
  const preds = ["HIGH", "LOW", "MEDIUM", "HIGH"];
  const gts = ["HIGH", "HIGH", "MEDIUM", "LOW"];
  const score = macroF1(preds, gts, ["HIGH", "MEDIUM", "LOW"]);
  assert.ok(score >= 0.0 && score <= 1.0);
});

// =========================================================================
// 3. Ranking Evaluator Integration Tests
// =========================================================================

test("evaluateRanking: dataset loads and executes all 20 scenarios", () => {
  const result = evaluateRanking();

  assert.equal(result.scenarioCount, 20);
  assert.equal(result.k, 5);
  assert.ok(result.meanPrecisionAt5 >= 0.0 && result.meanPrecisionAt5 <= 1.0);
  assert.ok(result.meanRecallAt5 >= 0.0 && result.meanRecallAt5 <= 1.0);
  assert.equal(typeof result.precisionTargetMet, "boolean");
  assert.equal(typeof result.recallTargetMet, "boolean");
  assert.equal(result.scenarioResults.length, 20);

  // Validate scenario result schema
  const first = result.scenarioResults[0];
  assert.ok(first.scenarioId);
  assert.ok(first.policyType);
  assert.equal(first.topKPredicted.length, 5);
  assert.ok(Array.isArray(first.groundTruthRelevant));
  assert.ok(first.precisionAt5 >= 0.0 && first.precisionAt5 <= 1.0);
  assert.ok(first.recallAt5 >= 0.0 && first.recallAt5 <= 1.0);
});

test("evaluateRanking: execution is completely deterministic across repeated runs", () => {
  const run1 = evaluateRanking();
  const run2 = evaluateRanking();

  assert.equal(run1.meanPrecisionAt5, run2.meanPrecisionAt5);
  assert.equal(run1.meanRecallAt5, run2.meanRecallAt5);
  assert.deepEqual(
    run1.scenarioResults.map((s) => s.topKPredicted),
    run2.scenarioResults.map((s) => s.topKPredicted)
  );
});

// =========================================================================
// 4. Change Evaluator Integration Tests
// =========================================================================

test("evaluateChangeImpact: dataset loads and executes all 30 clause pairs", async () => {
  const result = await evaluateChangeImpact();

  assert.equal(result.caseCount, 30);
  assert.equal(result.targetMacroF1, 0.85);

  // Validate changeMagnitude metrics
  assert.ok(result.changeMagnitude);
  assert.ok(result.changeMagnitude.macroF1 >= 0.0 && result.changeMagnitude.macroF1 <= 1.0);
  assert.ok(result.changeMagnitude.accuracy >= 0.0 && result.changeMagnitude.accuracy <= 1.0);
  assert.equal(typeof result.changeMagnitudeTargetMet, "boolean");

  // Validate userRiskDelta metrics
  assert.ok(result.userRiskDelta);
  assert.ok(result.userRiskDelta.macroF1 >= 0.0 && result.userRiskDelta.macroF1 <= 1.0);
  assert.ok(result.userRiskDelta.accuracy >= 0.0 && result.userRiskDelta.accuracy <= 1.0);
  assert.equal(typeof result.userRiskDeltaTargetMet, "boolean");

  // Validate case results schema
  assert.equal(result.caseResults.length, 30);
  const first = result.caseResults[0];
  assert.ok(first.caseId);
  assert.ok(first.category);
  assert.ok(first.predictedMagnitude);
  assert.ok(first.groundTruthMagnitude);
  assert.ok(first.predictedRiskDelta);
  assert.ok(first.groundTruthRiskDelta);
  assert.ok(typeof first.magnitudeCorrect === "boolean");
  assert.ok(typeof first.riskDeltaCorrect === "boolean");
});

test("evaluateChangeImpact: runs deterministically without network dependencies", async () => {
  const run1 = await evaluateChangeImpact();
  const run2 = await evaluateChangeImpact();

  assert.equal(run1.changeMagnitude.macroF1, run2.changeMagnitude.macroF1);
  assert.equal(run1.userRiskDelta.macroF1, run2.userRiskDelta.macroF1);
  assert.deepEqual(
    run1.caseResults.map((c) => c.predictedMagnitude),
    run2.caseResults.map((c) => c.predictedMagnitude)
  );
  assert.deepEqual(
    run1.caseResults.map((c) => c.predictedRiskDelta),
    run2.caseResults.map((c) => c.predictedRiskDelta)
  );
});
