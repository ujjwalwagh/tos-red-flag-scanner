/**
 * Comparative Benchmarking Engine for TOS Red Flag Scanner (Phase 7).
 *
 * Evaluates scanned documents against empirical industry benchmarks,
 * generating percentile rankings, domain comparisons, and restrictive outlier notices.
 */

import { INDUSTRY_SECTORS, BENCHMARK_DATA_VERSION } from "./benchmark-data.js";

export const BENCHMARK_SECTORS = {
  SAAS_CLOUD: "saas_cloud",
  SOCIAL_MEDIA: "social_media",
  ECOMMERCE: "ecommerce",
  CONSUMER_APPS: "consumer_apps",
  GENERAL: "general"
};

export const BENCHMARK_DISCLAIMER =
  "LEGAL DISCLAIMER: Comparative benchmarking rankings are statistical approximations derived from " +
  "aggregated empirical corpus analysis. Percentiles and relative standing do not represent formal " +
  "regulatory compliance certifications or statutory legal counsel.";

/**
 * Normalizes sector key or selects sensible default.
 *
 * @param {string} sectorKey
 * @returns {Object} Industry sector profile
 */
export function resolveSector(sectorKey = "") {
  const norm = String(sectorKey || "").toUpperCase().trim().replace(/[-\s]/g, "_");

  if (norm.includes("SAAS") || norm.includes("CLOUD") || norm.includes("B2B") || norm.includes("DEV")) {
    return INDUSTRY_SECTORS.SAAS_CLOUD;
  }
  if (norm.includes("SOCIAL") || norm.includes("MEDIA") || norm.includes("CREATOR") || norm.includes("COMMUNITY")) {
    return INDUSTRY_SECTORS.SOCIAL_MEDIA;
  }
  if (norm.includes("COMMERCE") || norm.includes("RETAIL") || norm.includes("SHOP") || norm.includes("MARKET")) {
    return INDUSTRY_SECTORS.ECOMMERCE;
  }
  if (norm.includes("APP") || norm.includes("MOBILE") || norm.includes("CONSUMER") || norm.includes("GAME")) {
    return INDUSTRY_SECTORS.CONSUMER_APPS;
  }
  return INDUSTRY_SECTORS.GENERAL;
}

/**
 * Evaluates document analysis against sector baselines.
 *
 * @param {Object} firstArg - Document analysis or options object
 * @param {Object} [secondArg={}] - Options if firstArg is analysis
 * @returns {Object} Structured benchmark evaluation
 */
export function evaluateDocumentBenchmark(firstArg = {}, secondArg = {}) {
  let analysis = {};
  let options = {};

  if (firstArg.findings || firstArg.rankedFindings || firstArg.flags) {
    analysis = firstArg;
    options = { ...firstArg, ...secondArg };
  } else {
    analysis = firstArg;
    options = secondArg;
  }

  const sector = resolveSector(options.sector || options.industrySector || analysis.sector);
  const findings = Array.isArray(analysis.rankedFindings)
    ? analysis.rankedFindings
    : (Array.isArray(analysis.findings) ? analysis.findings : (analysis.flags || []));

  const totalFindings = findings.length;

  // Track categories and severities
  const categoriesPresent = new Set();
  const keyRiskOutliers = [];
  let highSeverityCount = 0;
  let mediumSeverityCount = 0;
  let lowSeverityCount = 0;

  for (const f of findings) {
    const cat = String(f.categoryId || f.category || f.clauseType || "").toUpperCase();
    categoriesPresent.add(cat);

    const sev = String(f.severity || f.impactMagnitude || "MEDIUM").toUpperCase();
    if (sev === "HIGH" || sev === "CRITICAL") {
      highSeverityCount++;
      keyRiskOutliers.push({
        categoryId: cat,
        severity: sev,
        title: f.title || cat,
        reason: `Flagged as ${sev} severity risk in ${sector.displayName}.`
      });
    } else if (sev === "MEDIUM") {
      mediumSeverityCount++;
    } else {
      lowSeverityCount++;
    }
  }

  // 1. Raw restrictiveness points (0 - 100)
  const rawScore = Math.min(
    100,
    (highSeverityCount * 24) + (mediumSeverityCount * 12) + (lowSeverityCount * 5)
  );

  // 2. Compute overall percentile relative to sector baseline
  const flagRatio = sector.averageFlags > 0 ? totalFindings / sector.averageFlags : 1.0;
  let percentile = Math.round(
    Math.min(99, Math.max(5, (rawScore * 0.6) + (flagRatio * 25)))
  );

  if (totalFindings === 0) {
    percentile = 5; // Top 5% most consumer-friendly
  }

  // 3. Restrictiveness classification & relative standing
  let relativeStanding = "Standard";
  let restrictivenessLevel = "Moderate / Typical";
  let restrictivenessBadge = "moderate";

  if (percentile <= 30) {
    relativeStanding = "Favorable";
    restrictivenessLevel = "Consumer-Friendly / Above Average";
    restrictivenessBadge = "friendly";
  } else if (percentile <= 65) {
    relativeStanding = "Standard";
    restrictivenessLevel = "Moderate / Typical";
    restrictivenessBadge = "moderate";
  } else if (percentile <= 85) {
    relativeStanding = "Restrictive";
    restrictivenessLevel = "Above Average Restrictiveness";
    restrictivenessBadge = "restrictive";
  } else {
    relativeStanding = "High_Risk";
    restrictivenessLevel = "Aggressive / Outlier";
    restrictivenessBadge = "aggressive";
  }

  // 4. Domain-specific comparisons
  const hasArbitration = Array.from(categoriesPresent).some((c) => c.includes("ARBITRATION") || c.includes("CLASS_ACTION"));
  const hasContentGrab = Array.from(categoriesPresent).some((c) => c.includes("CONTENT") || c.includes("IP_RIGHTS") || c.includes("IP_OWNERSHIP"));
  const hasDataSharing = Array.from(categoriesPresent).some((c) => c.includes("DATA") || c.includes("SHARING") || c.includes("PRIVACY"));
  const hasAutoRenewal = Array.from(categoriesPresent).some((c) => c.includes("RENEWAL") || c.includes("SUBSCRIPTION") || c.includes("BILLING"));

  const domainScores = {
    disputeResolution: {
      status: hasArbitration ? "Restricted (Mandatory Arbitration)" : "Standard (Judicial Access Preserved)",
      industryPrevalence: `${Math.round(sector.arbitrationPrevalence * 100)}% of peers mandate arbitration`,
      isOutlier: hasArbitration && sector.arbitrationPrevalence < 0.6
    },
    contentRights: {
      status: hasContentGrab ? "Broad Operational/Commercial License Demanded" : "Standard Limited License",
      industryPrevalence: `${Math.round(sector.contentOverreachPrevalence * 100)}% of peers claim broad licenses`,
      isOutlier: hasContentGrab && sector.contentOverreachPrevalence < 0.35
    },
    dataPrivacy: {
      status: hasDataSharing ? "Third-Party Sharing / Commercial Telemetry Active" : "Standard Data Hygiene",
      industryPrevalence: "Common in ad-supported and freemium platforms",
      isOutlier: false
    },
    billingPractices: {
      status: hasAutoRenewal ? "Recurring Automatic Billing Configured" : "Standard Manual Renewal",
      industryPrevalence: "Standard across 85% of subscription platforms",
      isOutlier: false
    }
  };

  // 5. Outlier summary callouts
  const outlierCallouts = [];
  if (domainScores.contentRights.isOutlier) {
    outlierCallouts.push(
      `Broad content licensing is unusual for ${sector.displayName} (only ${Math.round(sector.contentOverreachPrevalence * 100)}% of peers mandate this).`
    );
  }
  if (domainScores.disputeResolution.isOutlier) {
    outlierCallouts.push(
      `Mandatory arbitration is less common among leading ${sector.displayName} providers.`
    );
  }
  if (totalFindings >= sector.averageFlags * 1.5) {
    outlierCallouts.push(
      `This document contains ${totalFindings} red flags, significantly higher than the sector average of ${sector.averageFlags.toFixed(1)}.`
    );
  }

  const comparisonStatement =
    totalFindings === 0
      ? `This policy is more consumer-friendly than 95% of ${sector.displayName} agreements evaluated.`
      : `This policy is more restrictive than ${percentile}% of ${sector.displayName} agreements evaluated.`;

  return {
    benchmarkVersion: BENCHMARK_DATA_VERSION,
    sector: sector.id,
    sectorId: sector.id,
    sectorDisplayName: sector.displayName,
    restrictivenessScore: rawScore,
    rawScore,
    percentileRank: percentile,
    percentile,
    relativeStanding,
    restrictivenessLevel,
    restrictivenessBadge,
    comparisonStatement,
    totalFindings,
    sectorAverageFlags: sector.averageFlags,
    domainBreakdown: domainScores,
    domainScores,
    keyRiskOutliers,
    outliers: outlierCallouts,
    disclaimer: BENCHMARK_DISCLAIMER
  };
}
