/**
 * PDF Text Extraction Bridge for TOS Red Flag Scanner.
 * Preserves backwards compatibility for Phase 1 while routing through
 * the new Phase 2 document-processor pipeline.
 */

import { AppError } from "../../security/security.js";
import { processPdfDocument } from "./document-processor.js";

/**
 * Legacy Phase 1 helper: Extracts and cleans text from PDF buffer.
 * Capped at 24,000 characters for LLM scanning.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>}
 */
export async function extractPdfTextFromBuffer(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new AppError(400, "Uploaded file payload is invalid.");
  }

  try {
    const result = await processPdfDocument(pdfBuffer);
    const text = result.normalizedText || "";
    if (!text.trim()) {
      throw new AppError(422, "Could not read text from this PDF.");
    }
    return text.slice(0, 24_000);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(422, `Could not read text from this PDF: ${error?.message || "Invalid file"}`);
  }
}

export { processPdfDocument };
