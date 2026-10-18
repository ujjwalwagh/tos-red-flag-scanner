import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { processPdfDocument } from "../../ingestion/pdf/document-processor.js";
import { logAudit } from "../../utils/logger.js";
import { config } from "../../config/env.js";

export async function ingestDocumentController(req, res, next) {
  const requestId = crypto.randomUUID();
  try {
    const uploadedFile = req.files?.file?.[0] || req.files?.policyFile?.[0] || req.file;

    if (!uploadedFile) {
      throw new AppError(400, "No PDF file provided. Please attach a PDF under 'file' or 'policyFile'.");
    }

    const document = await processPdfDocument(uploadedFile.buffer, {
      filename: uploadedFile.originalname,
      maxSize: config.maxPdfBytes
    });

    logAudit("document_ingested", {
      requestId,
      filename: document.metadata.filename,
      pageCount: document.metadata.pageCount,
      requiresOcr: document.metadata.requiresOcr,
      wordCount: document.metadata.wordCount
    });

    return res.status(200).json({
      success: true,
      document
    });
  } catch (error) {
    next(error);
  }
}
