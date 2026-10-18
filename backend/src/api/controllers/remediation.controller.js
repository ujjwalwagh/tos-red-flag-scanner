/**
 * Remediation & Export API Controllers for TOS Red Flag Scanner (Phase 6).
 */

import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { generateOptOutNotice } from "../../remediation/optout-generator.js";
import { generateActionChecklist } from "../../remediation/checklist-generator.js";
import { exportReport, EXPORT_FORMATS } from "../../reporting/report-exporter.js";
import { logAudit } from "../../utils/logger.js";

/**
 * Generates formal opt-out or revocation notice.
 * POST /api/remediation/opt-out
 */
export async function generateOptOutController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const {
      remediationType,
      noticeType,
      categoryId,
      companyName,
      clauseEvidence,
      effectiveDate,
      userMetadata,
      findingTitle,
      title
    } = req.body || {};

    const type = remediationType || noticeType || categoryId;
    if (!type) {
      throw new AppError(400, "A valid 'noticeType', 'remediationType', or 'categoryId' is required.");
    }

    const notice = generateOptOutNotice({
      noticeType: type,
      companyName,
      clauseEvidence,
      effectiveDate,
      userMetadata,
      findingTitle: findingTitle || title
    });

    logAudit("opt_out_notice_generated", {
      requestId,
      noticeType: notice.noticeType,
      companyName: companyName || "unspecified"
    });

    return res.status(200).json({
      success: true,
      notice
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
      error: error.message || "Could not generate opt-out notice."
    });
  }
}

/**
 * Generates an actionable pre-agreement checklist from findings.
 * POST /api/remediation/checklist
 */
export async function generateChecklistController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { rankedFindings, findings, companyName } = req.body || {};
    const inputFindings = Array.isArray(rankedFindings) ? rankedFindings : (Array.isArray(findings) ? findings : []);

    const checklist = generateActionChecklist(inputFindings, { companyName });

    logAudit("checklist_generated", {
      requestId,
      totalItems: checklist.summary.totalItems,
      immediateCount: checklist.summary.immediateCount
    });

    return res.status(200).json({
      success: true,
      checklist
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
      error: error.message || "Could not generate checklist."
    });
  }
}

/**
 * Exports analysis audit reports into Markdown, JSON, or standalone printable HTML.
 * POST /api/export/report
 */
export async function exportReportController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { analysis, format = "markdown", documentTitle, sourceLabel } = req.body || {};

    if (!analysis || typeof analysis !== "object") {
      throw new AppError(400, "Valid 'analysis' object is required for report export.");
    }

    const normFormat = String(format || "").toLowerCase().trim();
    const validFormats = Object.values(EXPORT_FORMATS);
    if (!validFormats.includes(normFormat)) {
      throw new AppError(400, `Unsupported export format '${format}'. Valid formats: ${validFormats.join(", ")}`);
    }

    const exported = exportReport(analysis, normFormat, { documentTitle, sourceLabel });

    logAudit("report_exported", {
      requestId,
      format: normFormat,
      documentTitle: documentTitle || "unnamed"
    });

    // Check if raw content response is requested
    if (req.query?.raw === "true") {
      if (normFormat === EXPORT_FORMATS.HTML) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(exported);
      }
      if (normFormat === EXPORT_FORMATS.MARKDOWN) {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        return res.status(200).send(exported);
      }
    }

    return res.status(200).json({
      success: true,
      format: normFormat,
      content: exported
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
      error: error.message || "Failed to export audit report."
    });
  }
}
