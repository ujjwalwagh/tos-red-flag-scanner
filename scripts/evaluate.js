#!/usr/bin/env node

/**
 * Quantitative Evaluation CLI Script for TOS Red Flag Scanner (Phase 9.5B).
 *
 * Executes the quantitative evaluation framework across:
 * 1. Personalized Clause Ranking (Precision@5, Recall@5)
 * 2. ToS Change Impact Detection (Precision, Recall, F1, Macro-F1)
 *
 * Produces structured academic reporting comparing measured performance against
 * the proposed project targets (>= 85%).
 */

import { evaluateRanking } from "../backend/src/evaluation/ranking-evaluator.js";
import { evaluateChangeImpact } from "../backend/src/evaluation/change-evaluator.js";

async function main() {
  console.log("==================================================");
  console.log("PRISMCLAUSE QUANTITATIVE EVALUATION");
  console.log("==================================================");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("Runtime: Node.js (Deterministic Benchmark Suite)");
  console.log("");

  // 1. Personalized Clause Ranking Evaluation
  console.log("--------------------------------------------------");
  console.log("1. PERSONALIZED CLAUSE RANKING EVALUATION");
  console.log("--------------------------------------------------");

  const rankingResults = evaluateRanking();
  const p5Pct = (rankingResults.meanPrecisionAt5 * 100).toFixed(2);
  const r5Pct = (rankingResults.meanRecallAt5 * 100).toFixed(2);
  const targetP5Pct = (rankingResults.targetPrecisionAt5 * 100).toFixed(2);
  const targetR5Pct = (rankingResults.targetRecallAt5 * 100).toFixed(2);

  console.log(`Scenarios Evaluated: ${rankingResults.scenarioCount}`);
  console.log(`Evaluation Metric:   Precision@5 and Recall@5`);
  console.log(`Cutoff Rank (K):     ${rankingResults.k}`);
  console.log("");
  console.log(`Mean Precision@5:    ${p5Pct}% (Target: >= ${targetP5Pct}%) -> ${rankingResults.precisionTargetMet ? "MET [PASS]" : "NOT MET [FAIL]"}`);
  console.log(`Mean Recall@5:       ${r5Pct}% (Target: >= ${targetR5Pct}%) -> ${rankingResults.recallTargetMet ? "MET [PASS]" : "NOT MET [FAIL]"}`);
  console.log("");

  // Sample scenario breakdowns
  console.log("Scenario Sample Summary (First 5 Scenarios):");
  rankingResults.scenarioResults.slice(0, 5).forEach((s) => {
    console.log(`  [${s.scenarioId}] ${s.policyType.padEnd(30)} P@5: ${(s.precisionAt5 * 100).toFixed(0)}%  R@5: ${(s.recallAt5 * 100).toFixed(0)}%`);
  });
  console.log("");

  // 2. Change Impact Detection Evaluation
  console.log("--------------------------------------------------");
  console.log("2. TOS CHANGE IMPACT DETECTION EVALUATION");
  console.log("--------------------------------------------------");

  const changeResults = await evaluateChangeImpact();
  const mag = changeResults.changeMagnitude;
  const delta = changeResults.userRiskDelta;
  const targetF1Pct = (changeResults.targetMacroF1 * 100).toFixed(2);

  console.log(`Clause Pairs Evaluated: ${changeResults.caseCount}`);
  console.log("");
  console.log("Change Magnitude Classification (NONE, MINOR, MODERATE, SIGNIFICANT, CRITICAL):");
  console.log(`  Overall Accuracy:     ${(mag.accuracy * 100).toFixed(2)}%`);
  console.log(`  Micro Precision:      ${(mag.precision * 100).toFixed(2)}%`);
  console.log(`  Micro Recall:         ${(mag.recall * 100).toFixed(2)}%`);
  console.log(`  Micro F1-Score:       ${(mag.f1 * 100).toFixed(2)}%`);
  console.log(`  Macro Precision:      ${(mag.macroPrecision * 100).toFixed(2)}%`);
  console.log(`  Macro Recall:         ${(mag.macroRecall * 100).toFixed(2)}%`);
  console.log(`  Macro-F1:             ${(mag.macroF1 * 100).toFixed(2)}% (Target: >= ${targetF1Pct}%) -> ${changeResults.changeMagnitudeTargetMet ? "MET [PASS]" : "NOT MET [FAIL]"}`);
  console.log("");

  console.log("User Risk Delta Classification (INCREASED_RISK, NEUTRAL, DECREASED_RISK):");
  console.log(`  Overall Accuracy:     ${(delta.accuracy * 100).toFixed(2)}%`);
  console.log(`  Micro Precision:      ${(delta.precision * 100).toFixed(2)}%`);
  console.log(`  Micro Recall:         ${(delta.recall * 100).toFixed(2)}%`);
  console.log(`  Micro F1-Score:       ${(delta.f1 * 100).toFixed(2)}%`);
  console.log(`  Macro Precision:      ${(delta.macroPrecision * 100).toFixed(2)}%`);
  console.log(`  Macro Recall:         ${(delta.macroRecall * 100).toFixed(2)}%`);
  console.log(`  Macro-F1:             ${(delta.macroF1 * 100).toFixed(2)}% (Target: >= ${targetF1Pct}%) -> ${changeResults.userRiskDeltaTargetMet ? "MET [PASS]" : "NOT MET [FAIL]"}`);
  console.log("");

  // Per-class breakdowns
  console.log("Per-Class Metrics Breakdown:");
  console.log("  Magnitude Classes:");
  Object.entries(mag.classes).forEach(([cls, stats]) => {
    console.log(`    ${cls.padEnd(14)} Support: ${String(stats.support).padStart(2)}  P: ${(stats.precision * 100).toFixed(1)}%  R: ${(stats.recall * 100).toFixed(1)}%  F1: ${(stats.f1 * 100).toFixed(1)}%`);
  });
  console.log("  Risk Delta Classes:");
  Object.entries(delta.classes).forEach(([cls, stats]) => {
    console.log(`    ${cls.padEnd(16)} Support: ${String(stats.support).padStart(2)}  P: ${(stats.precision * 100).toFixed(1)}%  R: ${(stats.recall * 100).toFixed(1)}%  F1: ${(stats.f1 * 100).toFixed(1)}%`);
  });
  console.log("");

  // Summary Table
  console.log("==================================================");
  console.log("SUMMARY: ACADEMIC BENCHMARK ALIGNMENT");
  console.log("==================================================");
  console.log(`Personalized Ranking Precision@5:  ${p5Pct}%  [Target: >= 85%] -> ${rankingResults.precisionTargetMet ? "MET" : "NOT MET"}`);
  console.log(`Personalized Ranking Recall@5:     ${r5Pct}%  [Target: >= 85%] -> ${rankingResults.recallTargetMet ? "MET" : "NOT MET"}`);
  console.log(`Change Magnitude Macro-F1:        ${(mag.macroF1 * 100).toFixed(2)}%  [Target: >= 85%] -> ${changeResults.changeMagnitudeTargetMet ? "MET" : "NOT MET"}`);
  console.log(`User Risk Delta Macro-F1:         ${(delta.macroF1 * 100).toFixed(2)}%  [Target: >= 85%] -> ${changeResults.userRiskDeltaTargetMet ? "MET" : "NOT MET"}`);
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Evaluation error:", err);
  process.exit(1);
});
