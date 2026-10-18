/**
 * Head-to-Head Comparative Vendor Matrix & Scorecard Compiler (Phase 8).
 *
 * Aligns contractual terms across 2 to 5 competing vendors, generating a
 * category-by-category comparative matrix and automated procurement recommendation.
 */

import { AppError } from "../security/security.js";
import { getAllRiskCategories, normalizeCategoryId, getRiskCategory } from "../analysis/risk-categories.js";

export const COMPARATOR_DISCLAIMER =
  "LEGAL DISCLAIMER: Comparative vendor matrices and procurement scorecards provide automated " +
  "heuristic assessments based on analyzed Terms of Service text. They do not constitute formal " +
  "procurement certifications or legal counsel. Organizations should evaluate custom enterprise riders " +
  "and specific compliance requirements before executing vendor agreements.";

/**
 * Compiles a comparative matrix and procurement recommendation across 2 to 5 vendors.
 *
 * @param {Array<Object>} vendorAnalyses - Array of { vendorName, analysis } objects
 * @returns {Object} Comparative matrix result
 */
export function compareVendors(vendorAnalyses = []) {
  if (!Array.isArray(vendorAnalyses) || vendorAnalyses.length < 2) {
    throw new AppError(400, "Comparison requires at least two vendor analyses.");
  }
  if (vendorAnalyses.length > 5) {
    throw new AppError(400, "A maximum of five vendors can be compared simultaneously.");
  }

  const vendors = [];
  const vendorScores = {};
  const vendorCriticalCounts = {};

  for (const item of vendorAnalyses) {
    const name = (item.vendorName || item.name || "Vendor").trim();
    vendors.push(name);
    const analysis = item.analysis || item;
    const findings = Array.isArray(analysis.rankedFindings)
      ? analysis.rankedFindings
      : (Array.isArray(analysis.findings) ? analysis.findings : (analysis.flags || []));

    let score = 0;
    let criticalCount = 0;

    for (const f of findings) {
      // FIX 1: Exclude synthetic placeholder findings from contributing to risk score
      if (
        f.title === "Standard Terms Phrasing" ||
        (f.categoryId === "GENERAL_RISK" && f.severity?.toLowerCase() === "low" && f.title?.includes("Standard Terms"))
      ) {
        continue;
      }

      const sev = String(f.severity || f.impactMagnitude || "MEDIUM").toUpperCase();
      const rawId = f.categoryId || f.category || f.clauseType || "";
      const cat = getRiskCategory(rawId);
      const catWeight = cat?.defaultWeight || 3;

      let basePoints = 8;
      if (sev === "CRITICAL") {
        basePoints = 18;
        criticalCount++;
      } else if (sev === "HIGH") {
        basePoints = 14;
        criticalCount++;
      } else if (sev === "MEDIUM") {
        basePoints = 8;
      } else if (sev === "LOW") {
        basePoints = 3;
      } else {
        basePoints = 1;
      }

      // Proportional risk weight adjustment: weights 4-5 add emphasis, weight 2 de-emphasizes
      const weightDelta = (catWeight - 3);
      const findingScore = Math.max(1, basePoints + weightDelta);
      score += findingScore;
    }

    vendorScores[name] = Math.min(100, Math.max(0, score));
    vendorCriticalCounts[name] = criticalCount;
  }

  // Build category matrix across all canonical categories
  const canonicalCategories = getAllRiskCategories();
  const categoryMatrix = {};

  for (const cat of canonicalCategories) {
    categoryMatrix[cat.id] = {
      categoryId: cat.id,
      categoryDisplayName: cat.displayName,
      vendorEntries: {}
    };

    for (const item of vendorAnalyses) {
      const name = (item.vendorName || item.name || "Vendor").trim();
      const analysis = item.analysis || item;
      const findings = Array.isArray(analysis.rankedFindings)
        ? analysis.rankedFindings
        : (Array.isArray(analysis.findings) ? analysis.findings : (analysis.flags || []));

      // Match finding for this category (ignoring synthetic placeholder flags)
      const match = findings.find(f => {
        if (
          f.title === "Standard Terms Phrasing" ||
          (f.categoryId === "GENERAL_RISK" && f.severity?.toLowerCase() === "low" && f.title?.includes("Standard Terms"))
        ) {
          return false;
        }
        const rawId = f.categoryId || f.category || f.clauseType || "";
        return normalizeCategoryId(rawId) === cat.id;
      });

      if (match) {
        const sev = String(match.severity || match.impactMagnitude || "MEDIUM").toUpperCase();
        categoryMatrix[cat.id].vendorEntries[name] = {
          status: "FLAGGED",
          severity: sev,
          evidence: match.evidence || match.quote || "",
          summary: match.explanation || match.plainEnglish || `${cat.displayName} provision flagged.`
        };
      } else {
        categoryMatrix[cat.id].vendorEntries[name] = {
          status: "NOT_DETECTED",
          severity: "NONE",
          evidence: "",
          summary: `No ${cat.displayName.toLowerCase()} red flags detected in analyzed excerpt.`
        };
      }
    }
  }

  // Determine recommended vendor (lowest score, tie-breaker: fewest critical findings)
  const sortedVendors = [...vendors].sort((a, b) => {
    if (vendorScores[a] !== vendorScores[b]) {
      return vendorScores[a] - vendorScores[b];
    }
    return vendorCriticalCounts[a] - vendorCriticalCounts[b];
  });

  const recommendedVendor = sortedVendors[0];
  const lowestScore = vendorScores[recommendedVendor];
  const runnerUp = sortedVendors[1];

  let recommendationRationale = `${recommendedVendor} demonstrates the most favorable contractual posture overall (Restrictiveness Score: ${lowestScore}/100).`;
  if (runnerUp && vendorScores[runnerUp] > lowestScore) {
    recommendationRationale += ` In contrast, ${runnerUp} incurs ${vendorScores[runnerUp] - lowestScore} more points of contractual restrictiveness.`;
  }

  return {
    vendors,
    recommendedVendor,
    recommendationRationale,
    recommendation: {
      preferredVendor: recommendedVendor,
      recommendedVendor,
      rationale: recommendationRationale
    },
    vendorScores,
    scorecard: sortedVendors.map(v => ({
      vendorName: v,
      totalRiskScore: vendorScores[v],
      criticalFlags: vendorCriticalCounts[v]
    })),
    sortedRankings: sortedVendors.map(v => ({
      vendorName: v,
      score: vendorScores[v],
      criticalFlags: vendorCriticalCounts[v]
    })),
    categoryMatrix,
    categories: Object.keys(categoryMatrix),
    disclaimer: COMPARATOR_DISCLAIMER
  };
}
