/**
 * Jurisdictional Regulatory Compliance & Enforceability Auditor ("ClauseGuard LexCheck") (Phase 8).
 *
 * Audits flagged contract provisions against codified consumer protection,
 * privacy, and unfair contract terms statutes across major global jurisdictions.
 */

import { AppError } from "../security/security.js";
import { normalizeCategoryId, getRiskCategory } from "../analysis/risk-categories.js";
import { JURISDICTIONS, STATUTORY_RULES } from "./statutory-rules.js";

export const COMPLIANCE_DISCLAIMER =
  "LEGAL DISCLAIMER: Regulatory compliance audits and enforceability indicators are automated informational " +
  "drafting aids produced by ClauseGuard AI. They do not constitute formal legal counsel, attorney representation, " +
  "or official regulatory enforcement rulings. The enforceability of any contractual clause depends on specific " +
  "factual context, governing choice of law, severance clauses, and applicable judicial precedent.";

/**
 * Normalizes jurisdiction key.
 *
 * @param {string} [jurisdictionKey="US_FEDERAL"]
 * @returns {Object} Jurisdiction profile
 */
export function resolveJurisdiction(jurisdictionKey = "") {
  const norm = String(jurisdictionKey || "").toUpperCase().trim().replace(/[-\s]/g, "_");

  if (norm.includes("CALIFORNIA") || norm.includes("CCPA") || norm.includes("CPRA") || norm === "CA" || norm === "US_CA") {
    return JURISDICTIONS.US_CALIFORNIA;
  }
  if (norm.includes("EU") || norm.includes("GDPR") || norm.includes("EUROPE")) {
    return JURISDICTIONS.EU_GDPR;
  }
  if (norm.includes("UK") || norm.includes("BRITAIN") || norm.includes("CRA")) {
    return JURISDICTIONS.UK_CRA;
  }
  if (norm.includes("INDIA") || norm.includes("RBI") || norm === "IN" || norm === "IN_CONSUMER") {
    return JURISDICTIONS.IN_CONSUMER;
  }
  return JURISDICTIONS.US_FEDERAL;
}

/**
 * Infers document jurisdiction or origin based on source URL or policy text indicators.
 *
 * @param {string} [sourceUrl=""] - Source URL or filename
 * @param {string} [policyText=""] - Policy document text
 * @returns {Object|null} Inferred jurisdiction object or null
 */
export function inferDocumentJurisdiction(sourceUrl = "", policyText = "") {
  const combined = `${sourceUrl || ""} ${typeof policyText === "string" ? policyText.slice(0, 5000) : ""}`.toLowerCase();

  if (
    /\/intl\/en_in\b/i.test(sourceUrl) ||
    /\.co\.in\b/i.test(sourceUrl) ||
    /\b(?:laws?\s+of\s+india|courts?\s+(?:in|of)\s+new\s+delhi|republic\s+of\s+india|reserve\s+bank\s+of\s+india|npci|upi\s+autopay)\b/i.test(combined)
  ) {
    return JURISDICTIONS.IN_CONSUMER;
  }

  if (
    /\.co\.uk\b/i.test(sourceUrl) ||
    /\b(?:laws?\s+of\s+england(?:\s+and\s+wales)?|courts?\s+of\s+london|united\s+kingdom)\b/i.test(combined)
  ) {
    return JURISDICTIONS.UK_CRA;
  }

  if (
    /\.(?:eu|de|fr|es|it|nl)\b/i.test(sourceUrl) ||
    /\b(?:european\s+union|gdpr|directive\s+93\/13)\b/i.test(combined)
  ) {
    return JURISDICTIONS.EU_GDPR;
  }

  if (
    /\b(?:california\s+law|laws?\s+of\s+(?:the\s+state\s+of\s+)?california|courts?\s+of\s+(?:santa\s+clara|san\s+francisco|los\s+angeles))\b/i.test(combined)
  ) {
    return JURISDICTIONS.US_CALIFORNIA;
  }

  return null;
}

/**
 * Audits document findings against specified statutory legal frameworks.
 *
 * @param {Object} params
 * @param {Array<Object>} params.findings - Document findings
 * @param {string} [params.jurisdiction] - Target legal framework
 * @param {string} [params.sourceUrl] - Source URL for jurisdiction inference
 * @param {string} [params.policyText] - Document text for jurisdiction inference
 * @returns {Object} Structured compliance evaluation
 */
export function auditStatutoryCompliance(params = {}) {
  const findings = Array.isArray(params.findings)
    ? params.findings
    : (Array.isArray(params.rankedFindings) ? params.rankedFindings : []);

  const explicitJurisdictionKey = params.jurisdiction;
  const inferred = params.inferredJurisdiction || inferDocumentJurisdiction(params.sourceUrl, params.policyText);
  const targetKey = explicitJurisdictionKey || (inferred ? inferred.id : "US_FEDERAL");
  const jurisdiction = resolveJurisdiction(targetKey);

  let applicabilityNotice = null;
  if (inferred && inferred.id !== jurisdiction.id) {
    applicabilityNotice = `Note: This policy appears to be governed by ${inferred.displayName}. Evaluated against ${jurisdiction.displayName} for comparative analysis.`;
  }

  const statutoryAlerts = [];
  let criticalViolationCount = 0;
  let unenforceableCount = 0;

  for (const f of findings) {
    const rawCat = f.categoryId || f.category || f.clauseType || "";
    const catId = normalizeCategoryId(rawCat);
    if (!catId) continue;

    // Distinguish optional recurring payment features from negative-option auto-renewal mandates
    if (catId === "AUTO_RENEWAL") {
      const isOptional =
        f.title === "Optional Recurring Payment Feature" ||
        String(f.severity || "").toLowerCase() === "low" ||
        /\b(?:you\s+may\s+choose|optional|allows\s+users\s+to|user\s+may\s+set\s+up)\b/i.test(f.evidence || "");
      if (isOptional) {
        // Optional user-initiated bill payments do not constitute a negative-option auto-renewal
        continue;
      }
    }

    const rulesForCat = STATUTORY_RULES[catId] || [];
    // Find matching rule for this jurisdiction or fallback
    const matchedRule = rulesForCat.find(r => r.jurisdiction === jurisdiction.id) ||
                        rulesForCat.find(r => r.jurisdiction === "US_FEDERAL");

    if (matchedRule) {
      const catMeta = getRiskCategory(catId);
      const isUnenforceable = String(matchedRule.status).includes("UNENFORCEABLE");
      const isViolation = String(matchedRule.status).includes("VIOLATION");

      if (isUnenforceable) unenforceableCount++;
      if (isViolation) criticalViolationCount++;

      const alertClassification = isUnenforceable
        ? "UNENFORCEABLE_CLAUSE"
        : (isViolation ? "STATUTORY_VIOLATION" : "STATUTORY_REQUIREMENT");

      statutoryAlerts.push({
        categoryId: catId,
        categoryDisplayName: catMeta.displayName,
        clauseTitle: f.title || catMeta.displayName,
        evidence: f.evidence || f.quote || "",
        jurisdiction: jurisdiction.id,
        statutoryCitation: matchedRule.statutoryCitation,
        enforceabilityStatus: matchedRule.status,
        alertClassification,
        isVerifiedViolation: isViolation,
        statutoryRiskLevel: matchedRule.riskLevel,
        summary: matchedRule.summary,
        guidance: matchedRule.guidance
      });
    }
  }

  let complianceStanding = "COMPLIANT_STANDARD";
  if (criticalViolationCount > 0 || unenforceableCount >= 2) {
    complianceStanding = "HIGH_REGULATORY_EXPOSURE";
  } else if (statutoryAlerts.length > 0) {
    complianceStanding = "REVIEW_RECOMMENDED";
  }

  return {
    jurisdiction: jurisdiction.id,
    jurisdictionDisplayName: jurisdiction.displayName,
    jurisdictionName: jurisdiction.displayName,
    inferredJurisdiction: inferred ? inferred.id : null,
    applicabilityNotice,
    regulatoryNotice: "Statutory alerts identify codified regulatory standards that apply to clauses of this nature. They do not constitute verified legal violations.",
    complianceStanding,
    overallEnforceability: complianceStanding,
    totalStatutoryAlerts: statutoryAlerts.length,
    vulnerableClausesCount: statutoryAlerts.length,
    unenforceableClausesCount: unenforceableCount,
    criticalViolationsCount: criticalViolationCount,
    statutoryAlerts,
    audits: statutoryAlerts,
    disclaimer: COMPLIANCE_DISCLAIMER
  };
}
