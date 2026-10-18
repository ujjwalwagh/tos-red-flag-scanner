/**
 * Policy Drift & Timeline Changelog Engine ("ClauseGuard Sentinel") (Phase 8).
 *
 * Evaluates chronological revisions of vendor terms, computes semantic and
 * structural drift magnitude, identifies newly introduced restrictions or stripped rights,
 * and compiles word-level redline transition diffs.
 */

import { AppError } from "../security/security.js";
import { normalizeCategoryId, getRiskCategory } from "../analysis/risk-categories.js";
import { computeWordDiff } from "../negotiation/redline-differ.js";
import { analyzeDocument } from "../architecture/pipeline/analysis-pipeline.js";

export const SENTINEL_DISCLAIMER =
  "LEGAL DISCLAIMER: Policy drift and version comparison metrics are automated analytical " +
  "estimations of textual revisions. They do not constitute formal legal counsel. Contractual rights " +
  "may be affected by bilateral notice rules, user acceptance mechanisms, or statutory non-retroactivity.";

/**
 * Calculates policy drift between two historical policy versions.
 *
 * @param {Object} params
 * @param {string} [params.vendorName="Vendor"] - Service provider name
 * @param {Object} params.baseVersion - { versionLabel, policyText, findings }
 * @param {Object} params.currentVersion - { versionLabel, policyText, findings }
 * @returns {Promise<Object>} Structured policy drift analysis
 */
export async function calculatePolicyDrift(params = {}) {
  const vendorName = (params.vendorName || "Vendor").trim();
  const baseVer = params.baseVersion;
  const currentVer = params.currentVersion;

  if (!baseVer || !currentVer) {
    throw new AppError(400, "Both 'baseVersion' and 'currentVersion' objects are required to evaluate policy drift.");
  }

  const baseLabel = (baseVer.versionLabel || baseVer.version || "Previous Version").trim();
  const currentLabel = (currentVer.versionLabel || currentVer.version || "Current Version").trim();
  const basePolicyText = typeof baseVer.policyText === "string" ? baseVer.policyText : (typeof baseVer.text === "string" ? baseVer.text : "");
  const currentPolicyText = typeof currentVer.policyText === "string" ? currentVer.policyText : (typeof currentVer.text === "string" ? currentVer.text : "");

  // Obtain findings for base version
  let baseFindings = Array.isArray(baseVer.findings) ? baseVer.findings : [];
  if (baseFindings.length === 0 && basePolicyText.trim()) {
    const analysis = await analyzeDocument({
      metadata: { filename: `${vendorName}-${baseLabel}` },
      pages: [{ pageNumber: 1, text: basePolicyText }]
    });
    baseFindings = analysis.rankedFindings || analysis.findings || [];
  }

  // Obtain findings for current version
  let currentFindings = Array.isArray(currentVer.findings) ? currentVer.findings : [];
  if (currentFindings.length === 0 && currentPolicyText.trim()) {
    const analysis = await analyzeDocument({
      metadata: { filename: `${vendorName}-${currentLabel}` },
      pages: [{ pageNumber: 1, text: currentPolicyText }]
    });
    currentFindings = analysis.rankedFindings || analysis.findings || [];
  }

  // Map findings by canonical category
  const baseCatMap = new Map();
  for (const f of baseFindings) {
    const id = normalizeCategoryId(f.categoryId || f.category || f.clauseType || "");
    if (id) baseCatMap.set(id, f);
  }

  const currentCatMap = new Map();
  for (const f of currentFindings) {
    const id = normalizeCategoryId(f.categoryId || f.category || f.clauseType || "");
    if (id) currentCatMap.set(id, f);
  }

  const newRestrictions = [];
  const removedRestrictions = [];
  const clauseTransitions = [];

  // Check for newly added restrictions
  for (const [catId, currentFinding] of currentCatMap.entries()) {
    const catMeta = getRiskCategory(catId);
    if (!baseCatMap.has(catId)) {
      newRestrictions.push({
        categoryId: catId,
        categoryDisplayName: catMeta.displayName,
        severity: currentFinding.severity || "MEDIUM",
        evidence: currentFinding.evidence || currentFinding.quote || "",
        title: `${catMeta.displayName} introduced in ${currentLabel}`,
        explanation: currentFinding.explanation || currentFinding.plainEnglish || ""
      });
    } else {
      // Clause exists in both — compute transition diff
      const baseFinding = baseCatMap.get(catId);
      const baseText = baseFinding.evidence || baseFinding.quote || "";
      const currentText = currentFinding.evidence || currentFinding.quote || "";

      if (baseText && currentText && baseText !== currentText) {
        const diff = computeWordDiff(baseText, currentText);
        clauseTransitions.push({
          categoryId: catId,
          categoryDisplayName: catMeta.displayName,
          baseText,
          currentText,
          diffStats: diff.stats,
          redlineHtml: diff.htmlDiff
        });
      }
    }
  }

  // Check for removed restrictions
  for (const [catId, baseFinding] of baseCatMap.entries()) {
    const catMeta = getRiskCategory(catId);
    if (!currentCatMap.has(catId)) {
      removedRestrictions.push({
        categoryId: catId,
        categoryDisplayName: catMeta.displayName,
        severity: baseFinding.severity || "MEDIUM",
        evidence: baseFinding.evidence || baseFinding.quote || "",
        title: `${catMeta.displayName} removed or relaxed in ${currentLabel}`
      });
    }
  }

  // Compute direction and magnitude
  let driftDirection = "NEUTRAL";
  if (newRestrictions.length > removedRestrictions.length) {
    driftDirection = "MORE_RESTRICTIVE";
  } else if (removedRestrictions.length > newRestrictions.length) {
    driftDirection = "MORE_FAVORABLE";
  }

  const totalShifts = newRestrictions.length + removedRestrictions.length + clauseTransitions.length;
  let driftMagnitude = "MINIMAL";
  if (totalShifts >= 4 || newRestrictions.some(r => r.severity === "HIGH" || r.severity === "CRITICAL")) {
    driftMagnitude = "HIGH";
  } else if (totalShifts >= 2) {
    driftMagnitude = "MODERATE";
  }

  let driftSummary = `${vendorName} terms remained relatively consistent between ${baseLabel} and ${currentLabel}.`;
  if (driftDirection === "MORE_RESTRICTIVE") {
    driftSummary = `${vendorName} terms became significantly more restrictive in ${currentLabel}, adding ${newRestrictions.length} new restriction ${newRestrictions.length === 1 ? "clause" : "clauses"}.`;
  } else if (driftDirection === "MORE_FAVORABLE") {
    driftSummary = `${vendorName} removed ${removedRestrictions.length} previously flagged restrictive ${removedRestrictions.length === 1 ? "clause" : "clauses"} in ${currentLabel}.`;
  }

  return {
    vendorName,
    baseVersionLabel: baseLabel,
    previousVersion: baseLabel,
    currentVersionLabel: currentLabel,
    currentVersion: currentLabel,
    driftDirection,
    driftMagnitude,
    magnitudeScore: driftMagnitude === "HIGH" ? 75 : (driftMagnitude === "MODERATE" ? 50 : 25),
    driftSummary,
    summary: driftSummary,
    newRestrictions,
    addedRestrictions: newRestrictions,
    removedRestrictions,
    clauseTransitions,
    totalBaseFindings: baseFindings.length,
    totalCurrentFindings: currentFindings.length,
    disclaimer: SENTINEL_DISCLAIMER
  };
}
