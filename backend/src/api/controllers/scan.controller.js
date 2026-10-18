import crypto from "node:crypto";
import { AppError, validatePolicyUrl } from "../../security/security.js";
import { fetchPolicyText, MAX_POLICY_TEXT_LENGTH } from "../../ingestion/url/fetch-policy-text.js";
import { extractPdfTextFromBuffer } from "../../ingestion/pdf/pdf-text.js";
import { computeReadability } from "../../analysis/semantic/readability.js";
import { scanPolicyForRedFlags } from "../../analysis/semantic/scan-policy.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";
import { normalizeText } from "../../processing/normalization/text-normalizer.js";
import { logAudit, estimateInputLength } from "../../utils/logger.js";

export async function scanPolicyController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const urlValue = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const pastedText = typeof req.body?.policyText === "string" ? req.body.policyText.trim() : "";
    const scanMode = req.body?.scanMode === "strict" ? "strict" : "broad";
    const uploadedPdf = req.file;
    const selectedInputCount = Number(Boolean(urlValue)) + Number(Boolean(uploadedPdf)) + Number(Boolean(pastedText));

    if (!selectedInputCount) {
      throw new AppError(400, "Provide one input: policy URL, PDF upload, or pasted text.");
    }

    if (selectedInputCount > 1) {
      throw new AppError(400, "Choose one input method only: URL, PDF, or pasted text.");
    }

    let policyText = "";
    let sourceLabel = "";
    let sourceType = "unknown";

    if (uploadedPdf) {
      policyText = await extractPdfTextFromBuffer(uploadedPdf.buffer);
      sourceLabel = `PDF: ${uploadedPdf.originalname || "uploaded-file.pdf"}`;
      sourceType = "pdf";
    } else if (urlValue) {
      const parsedUrl = await validatePolicyUrl(urlValue);
      policyText = await fetchPolicyText(parsedUrl);
      sourceLabel = parsedUrl.toString();
      sourceType = "url";
    } else {
      policyText = pastedText.slice(0, MAX_POLICY_TEXT_LENGTH);
      sourceLabel = "Pasted text";
      sourceType = "text";
    }

    if (policyText.length < 500) {
      return res.status(422).json({
        error: "The content is too short to analyze. Use a fuller Terms/Privacy page or a complete PDF."
      });
    }

    let userPreferences = req.body?.userPreferences || req.body?.preferences;
    if (typeof userPreferences === "string") {
      try {
        userPreferences = JSON.parse(userPreferences);
      } catch {
        userPreferences = {};
      }
    }

    const report = await scanPolicyForRedFlags(policyText, sourceLabel, {
      mode: scanMode,
      userPreferences
    });
    const readability = computeReadability(policyText);
    const segments = (Array.isArray(report.segments) && report.segments.length > 0)
      ? report.segments
      : segmentDocumentPages([{
          pageNumber: 1,
          rawText: policyText,
          normalizedText: normalizeText(policyText)
        }]);

    return res.json({
      ...report,
      readability,
      segments
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    const message =
      status >= 500
        ? "Failed to scan this document right now. Please try again."
        : error?.message || "Invalid request";

    logAudit("scan_failed", {
      requestId,
      statusCode: status,
      scanMode: req.body?.scanMode === "strict" ? "strict" : "broad",
      sourceType: req.file ? "pdf" : req.body?.url ? "url" : req.body?.policyText ? "text" : "unknown",
      inputLength: estimateInputLength(req),
      errorName: error?.name || "UnknownError",
      errorMessage: String(error?.message || "Unknown error").slice(0, 220)
    });

    return res.status(status).json({ error: message });
  }
}
