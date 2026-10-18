/**
 * Regulatory Compliance & Enforceability API Controller for TOS Red Flag Scanner (Phase 8).
 */

import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { auditStatutoryCompliance } from "../../compliance/statutory-auditor.js";
import { JURISDICTIONS } from "../../compliance/statutory-rules.js";
import { logAudit } from "../../utils/logger.js";

/**
 * Audits document findings against specified statutory legal frameworks.
 * POST /api/compliance/audit
 */
export async function auditComplianceController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { findings, rankedFindings, jurisdiction, sourceUrl, policyText } = req.body || {};
    const inputFindings = Array.isArray(findings)
      ? findings
      : (Array.isArray(rankedFindings) ? rankedFindings : []);

    const compliance = auditStatutoryCompliance({
      findings: inputFindings,
      jurisdiction: jurisdiction || "US_FEDERAL",
      sourceUrl: sourceUrl || "",
      policyText: policyText || ""
    });

    logAudit("compliance_audited", {
      requestId,
      jurisdiction: compliance.jurisdiction,
      totalStatutoryAlerts: compliance.totalStatutoryAlerts,
      standing: compliance.complianceStanding
    });

    return res.status(200).json({
      success: true,
      compliance
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logAudit("request_error", {
      requestId,
      statusCode,
      errorName: error.name,
      errorMessage: error.message
    });

    return res.status(statusCode).json({
      error: error.message || "Failed to audit statutory compliance."
    });
  }
}

/**
 * Returns list of supported statutory jurisdictions.
 * GET /api/compliance/jurisdictions
 */
export async function getJurisdictionsController(_req, res) {
  return res.status(200).json({
    success: true,
    jurisdictions: Object.values(JURISDICTIONS)
  });
}
