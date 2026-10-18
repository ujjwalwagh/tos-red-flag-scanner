/**
 * Personalized Risk Ranker for TOS Red Flag Scanner (Phase 5).
 *
 * Reranks detected legal clause findings dynamically based on user-configured
 * concern weights (1 to 5), evaluates impact magnitudes, and provides transparent
 * ranking reasons.
 */

import { getRiskCategory } from "./risk-categories.js";
import { validateUserPreferences, getCategoryWeight } from "./user-preferences.js";
import { calculateImpactMagnitude, generatePlainEnglishExplanation } from "./impact-evaluator.js";

/**
 * Reranks clause findings based on user concern weights.
 * Completely deterministic and preserves all original finding properties.
 *
 * @param {Array<Object>} findings - Clause findings from Phase 3 & 4
 * @param {Object} [userPreferences] - Optional user concern weights { category: 1..5 }
 * @returns {Array<Object>} Ranked findings with personalized metrics & explanations
 */
export function rankFindings(findings, userPreferences = {}) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }

  const preferences = validateUserPreferences(userPreferences);

  // Compute personalized scores and metadata for each finding
  const enriched = findings.map((finding) => {
    const category = getRiskCategory(finding.categoryId || finding.category);
    const userWeight = getCategoryWeight(preferences, category.id);
    const impactMagnitude = calculateImpactMagnitude(finding, userWeight);
    const personalizedScore = computePersonalizedScore(finding, userWeight);
    const plainEnglishExplanation = generatePlainEnglishExplanation(finding, category);

    return {
      ...finding,
      categoryId: category.id,
      categoryDisplayName: category.displayName,
      impactDomain: category.impactDomain,
      userConcernWeight: userWeight,
      impactMagnitude,
      personalizedScore,
      plainEnglishExplanation
    };
  });

  // Sort descending by personalizedScore, then severity, then confidence
  const severityRank = { HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

  enriched.sort((a, b) => {
    // 1. Personalized score
    const scoreDiff = b.personalizedScore - a.personalizedScore;
    if (Math.abs(scoreDiff) >= 1) return scoreDiff;

    // 2. Base severity rank
    const aSev = severityRank[String(a.severity).toUpperCase()] || 1;
    const bSev = severityRank[String(b.severity).toUpperCase()] || 1;
    if (aSev !== bSev) return bSev - aSev;

    // 3. Detection confidence
    return (b.confidence || 0) - (a.confidence || 0);
  });

  // Assign 1-indexed ranks and build contextual ranking reasons
  return enriched.map((item, index) => {
    const rank = index + 1;
    const rankingReason = buildRankingReason(item, rank);
    return {
      rank,
      rankingReason,
      ...item
    };
  });
}

/**
 * Computes deterministic score from 0 to 100 combining base severity,
 * detection confidence, and user concern multiplier.
 */
function computePersonalizedScore(finding, userWeight) {
  const baseSeverity = String(finding.severity || "INFO").toUpperCase();
  const confidence = typeof finding.confidence === "number" ? finding.confidence : 0.85;

  // Base points by severity
  const basePoints = {
    HIGH: 50,
    MEDIUM: 35,
    LOW: 20,
    INFO: 10
  }[baseSeverity] || 10;

  // User weight modifier (weight 1..5: weight 5 gives +35, weight 1 gives -5)
  // Maps 1 -> -5, 2 -> +5, 3 -> +15, 4 -> +25, 5 -> +35
  const weightModifier = (userWeight - 1) * 10 - 5;

  // Confidence contribution (0 to 15 points)
  const confidencePoints = Math.round(confidence * 15);

  // Bonus if verified by both rule and AI
  const multiSignalBonus = finding.ruleDetected && finding.aiDetected ? 5 : 0;

  const total = basePoints + weightModifier + confidencePoints + multiSignalBonus;
  return Math.max(1, Math.min(100, Math.round(total)));
}

/**
 * Generates an intuitive sentence explaining why this item earned its rank.
 */
function buildRankingReason(item, rank) {
  const weight = item.userConcernWeight;
  const sev = String(item.severity).toLowerCase();
  const cat = item.categoryDisplayName || item.category;

  if (weight >= 5) {
    return `Ranked #${rank} because you marked "${cat}" as a top priority (weight 5/5) combined with ${sev} severity.`;
  }
  if (weight >= 4) {
    return `Ranked #${rank} due to your high concern for "${cat}" (weight ${weight}/5) and detected clause evidence.`;
  }
  if (weight <= 2) {
    return `Ranked #${rank}: base ${sev} severity lowered because you placed reduced priority on "${cat}" (weight ${weight}/5).`;
  }
  return `Ranked #${rank} based on ${sev} contractual impact in "${cat}" with standard review priority.`;
}

/**
 * Generates an aggregated personalized summary across all ranked findings.
 *
 * @param {Array<Object>} rankedFindings
 * @param {Object} [userPreferences]
 * @returns {Object} Personalized summary metrics
 */
export function computePersonalizedSummary(rankedFindings, userPreferences = {}) {
  const preferences = validateUserPreferences(userPreferences);
  const totalFindings = rankedFindings.length;

  const impactDistribution = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0
  };

  const categoryScores = {};
  let totalScore = 0;

  for (const item of rankedFindings) {
    totalScore += item.personalizedScore;
    if (impactDistribution[item.impactMagnitude] !== undefined) {
      impactDistribution[item.impactMagnitude]++;
    }
    const cat = item.categoryDisplayName || item.category;
    categoryScores[cat] = (categoryScores[cat] || 0) + item.personalizedScore;
  }

  // Find top concern categories in this document
  const topConcernCategories = Object.entries(categoryScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, score]) => ({ category, cumulativeScore: score }));

  const averagePersonalizedScore = totalFindings > 0 ? Math.round(totalScore / totalFindings) : 0;
  const highestImpactFinding = totalFindings > 0 ? rankedFindings[0] : null;

  return {
    totalRanked: totalFindings,
    averagePersonalizedScore,
    impactDistribution,
    topConcernCategories,
    highestImpactFinding: highestImpactFinding
      ? {
          title: highestImpactFinding.title,
          category: highestImpactFinding.categoryDisplayName || highestImpactFinding.category,
          impactMagnitude: highestImpactFinding.impactMagnitude,
          score: highestImpactFinding.personalizedScore
        }
      : null,
    personalizedAt: new Date().toISOString()
  };
}
