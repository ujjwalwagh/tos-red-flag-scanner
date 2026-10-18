/**
 * Personalized Ranking Evaluator for TOS Red Flag Scanner (Phase 9.5B).
 *
 * Evaluates the existing production rankFindings() algorithm quantitatively
 * against curated ground-truth ToS scenarios using Precision@5 and Recall@5.
 *
 * Reuses production rankFindings directly without modifying or duplicating logic.
 */

import { rankFindings } from "../analysis/personalized-ranker.js";
import { precisionAtK, recallAtK } from "./metrics.js";
import rankingDataset from "./data/ranking-dataset.json" with { type: "json" };

export const RANKING_TARGET_PRECISION = 0.85;
export const RANKING_TARGET_RECALL = 0.85;

/**
 * Runs the quantitative evaluation across all ranking scenarios.
 *
 * @param {Object} [options={}]
 * @param {Array<Object>} [options.dataset] - Optional custom dataset (defaults to bundled benchmark)
 * @param {number} [options.k=5] - Evaluation cutoff rank
 * @returns {Object} Comprehensive evaluation summary and per-scenario breakdown
 */
export function evaluateRanking(options = {}) {
  const dataset = Array.isArray(options.dataset) ? options.dataset : rankingDataset;
  const k = typeof options.k === "number" && options.k > 0 ? options.k : 5;

  const scenarioResults = [];
  let totalPrecision = 0;
  let totalRecall = 0;

  for (const scenario of dataset) {
    const findings = Array.isArray(scenario.findings) ? scenario.findings : [];
    const userPrefs = scenario.userPreferences || {};
    const groundTruth = Array.isArray(scenario.groundTruthRelevant) ? scenario.groundTruthRelevant : [];

    // Run production personalized ranker
    const ranked = rankFindings(findings, userPrefs);

    // Extract top K predicted clause/finding identifiers
    const topKIds = ranked.slice(0, k).map((item) => String(item.clauseId || item.findingId));

    const pAtK = precisionAtK(topKIds, groundTruth, k);
    const rAtK = recallAtK(topKIds, groundTruth, k);

    totalPrecision += pAtK;
    totalRecall += rAtK;

    scenarioResults.push({
      scenarioId: scenario.id,
      policyType: scenario.policyType,
      topKPredicted: topKIds,
      groundTruthRelevant: groundTruth,
      precisionAt5: pAtK,
      recallAt5: rAtK,
      rationale: scenario.rationale || ""
    });
  }

  const scenarioCount = dataset.length;
  const meanPrecisionAt5 = scenarioCount > 0 ? Number((totalPrecision / scenarioCount).toFixed(4)) : 0;
  const meanRecallAt5 = scenarioCount > 0 ? Number((totalRecall / scenarioCount).toFixed(4)) : 0;

  return {
    scenarioCount,
    k,
    meanPrecisionAt5,
    meanRecallAt5,
    targetPrecisionAt5: RANKING_TARGET_PRECISION,
    targetRecallAt5: RANKING_TARGET_RECALL,
    precisionTargetMet: meanPrecisionAt5 >= RANKING_TARGET_PRECISION,
    recallTargetMet: meanRecallAt5 >= RANKING_TARGET_RECALL,
    scenarioResults
  };
}
