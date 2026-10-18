/**
 * Portfolio Risk Aggregator & Systemic Exposure Engine (Phase 8).
 *
 * Computes organizational stack exposure, weighted portfolio risk scores,
 * systemic vulnerability concentrations, and vendor risk distributions across
 * an active multi-vendor software footprint.
 */

import { AppError } from "../security/security.js";

export const PORTFOLIO_DISCLAIMER =
  "LEGAL DISCLAIMER: Portfolio risk scores and systemic exposure metrics are automated analytical " +
  "estimations produced by ClauseGuard AI. They do not constitute formal enterprise audit certifications, " +
  "regulatory attestation, or legal counsel. Actual institutional liability depends on corporate structures, " +
  "governing law, negotiated enterprise agreements, and specific operational implementations.";

/**
 * Calculates a unified portfolio risk summary across multiple vendor analyses.
 *
 * @param {Object} params
 * @param {string} [params.portfolioName="Vendor Portfolio"] - Label for the stack
 * @param {Array<Object>} params.vendors - Array of { vendorName, analysis } objects
 * @returns {Object} Structured portfolio analysis
 */
export function evaluatePortfolioRisk(params = {}) {
  const portfolioName = (params.portfolioName || "Vendor Portfolio").trim();
  const vendors = Array.isArray(params.vendors) ? params.vendors : [];

  if (vendors.length === 0) {
    throw new AppError(400, "At least one vendor analysis is required to evaluate a portfolio.");
  }

  let cumulativeScore = 0;
  const vendorRankings = [];
  const domainOccurrences = {
    disputeResolution: { count: 0, vendors: [], label: "Mandatory Arbitration & Class Action Waivers" },
    contentRights: { count: 0, vendors: [], label: "Broad Content & IP Licensing Overreach" },
    dataPrivacy: { count: 0, vendors: [], label: "Third-Party Data Sharing & Commercial Tracking" },
    billingPractices: { count: 0, vendors: [], label: "Aggressive Auto-Renewal & Fee Lock-In" },
    unilateralChanges: { count: 0, vendors: [], label: "Unilateral Modification Without Direct Notice" }
  };

  const categoryAggregates = {};

  for (const item of vendors) {
    const vName = (item.vendorName || item.name || "Unnamed Vendor").trim();
    const analysis = item.analysis || item;
    const findings = Array.isArray(analysis.rankedFindings)
      ? analysis.rankedFindings
      : (Array.isArray(analysis.findings) ? analysis.findings : (analysis.flags || []));

    // Determine vendor score from Phase 7 benchmark or compute from findings
    let vScore = 0;
    if (analysis.benchmarks?.restrictivenessScore !== undefined) {
      vScore = analysis.benchmarks.restrictivenessScore;
    } else {
      let high = 0, med = 0, low = 0;
      for (const f of findings) {
        const sev = String(f.severity || f.impactMagnitude || "MEDIUM").toUpperCase();
        if (sev === "HIGH" || sev === "CRITICAL") high++;
        else if (sev === "MEDIUM") med++;
        else low++;
      }
      vScore = Math.min(100, (high * 24) + (med * 12) + (low * 5));
    }

    cumulativeScore += vScore;

    let standing = "Standard";
    if (vScore <= 30) standing = "Favorable";
    else if (vScore <= 65) standing = "Standard";
    else if (vScore <= 85) standing = "Restrictive";
    else standing = "High_Risk";

    vendorRankings.push({
      vendorName: vName,
      score: vScore,
      totalFindings: findings.length,
      standing
    });

    // Check categories for systemic concentrations
    const vCats = new Set(findings.map(f => String(f.categoryId || f.category || f.clauseType || "").toUpperCase()));

    for (const cat of vCats) {
      categoryAggregates[cat] = (categoryAggregates[cat] || 0) + 1;
    }

    if (Array.from(vCats).some(c => c.includes("ARBITRATION") || c.includes("CLASS_ACTION"))) {
      domainOccurrences.disputeResolution.count++;
      domainOccurrences.disputeResolution.vendors.push(vName);
    }
    if (Array.from(vCats).some(c => c.includes("CONTENT") || c.includes("IP_OWNERSHIP") || c.includes("IP_RIGHTS"))) {
      domainOccurrences.contentRights.count++;
      domainOccurrences.contentRights.vendors.push(vName);
    }
    if (Array.from(vCats).some(c => c.includes("DATA") || c.includes("SHARING") || c.includes("PRIVACY"))) {
      domainOccurrences.dataPrivacy.count++;
      domainOccurrences.dataPrivacy.vendors.push(vName);
    }
    if (Array.from(vCats).some(c => c.includes("RENEWAL") || c.includes("SUBSCRIPTION") || c.includes("BILLING"))) {
      domainOccurrences.billingPractices.count++;
      domainOccurrences.billingPractices.vendors.push(vName);
    }
    if (Array.from(vCats).some(c => c.includes("UNILATERAL") || c.includes("CHANGE"))) {
      domainOccurrences.unilateralChanges.count++;
      domainOccurrences.unilateralChanges.vendors.push(vName);
    }
  }

  // Sort vendor rankings by score ascending (lowest risk first)
  vendorRankings.sort((a, b) => a.score - b.score);

  const totalVendors = vendors.length;
  const aggregateStackScore = Math.round(cumulativeScore / totalVendors);

  let portfolioHealth = "FAVORABLE";
  if (aggregateStackScore > 75) portfolioHealth = "CRITICAL_EXPOSURE";
  else if (aggregateStackScore > 50) portfolioHealth = "MODERATE_RISK";
  else if (aggregateStackScore > 25) portfolioHealth = "CONTROLLED_RISK";

  // Identify systemic risk concentrations (present in > 40% of vendors)
  const systemicExposures = [];
  for (const [key, domain] of Object.entries(domainOccurrences)) {
    const rate = domain.count / totalVendors;
    if (rate >= 0.4 && domain.count > 0) {
      const pct = Math.round(rate * 100);
      systemicExposures.push({
        domainKey: key,
        domainLabel: domain.label,
        affectedCount: domain.count,
        totalVendors,
        prevalencePercentage: pct,
        affectedVendors: domain.vendors,
        summary: `${pct}% of stack vendors (${domain.count}/${totalVendors}) exhibit ${domain.label.toLowerCase()}.`
      });
    }
  }

  return {
    portfolioName,
    totalVendors,
    aggregateStackScore,
    portfolioRiskScore: aggregateStackScore,
    portfolioHealth,
    portfolioPosture: portfolioHealth,
    vendorRankings,
    systemicExposures,
    systemicConcentrations: systemicExposures,
    categoryConcentrations: categoryAggregates,
    disclaimer: PORTFOLIO_DISCLAIMER
  };
}
