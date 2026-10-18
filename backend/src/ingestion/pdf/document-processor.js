/**
 * Document Ingestion & Processing Pipeline for TOS Red Flag Scanner.
 * Orchestrates safe buffer validation, page-by-page text extraction,
 * text normalization, and deterministic clause segmentation.
 */

import path from "node:path";
import { AppError } from "../../security/security.js";
import { extractPdfPages } from "./pdf-extractor.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

/**
 * Validates raw uploaded PDF buffer for safety, size limits, and magic bytes.
 *
 * @param {Buffer} buffer - File payload buffer
 * @param {Object} options - Validation options
 * @param {number} [options.maxSize=10485760] - Maximum allowed size in bytes
 * @param {string} [options.filename] - Original uploaded filename
 * @returns {{ sanitizedFilename: string, fileSize: number }}
 */
export function validatePdfBuffer(buffer, options = {}) {
  const maxSize = options.maxSize || DEFAULT_MAX_FILE_SIZE;
  const rawFilename = typeof options.filename === "string" ? options.filename : "uploaded-document.pdf";

  // Sanitize filename to avoid path traversal or control characters
  const sanitizedFilename = path.basename(rawFilename).replace(/[^\w.\- ]+/g, "_");

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, "Uploaded file is empty or invalid.");
  }

  if (buffer.length > maxSize) {
    const maxMb = Math.round(maxSize / (1024 * 1024));
    throw new AppError(413, `PDF exceeds maximum allowed size of ${maxMb}MB.`);
  }

  // Verify PDF magic bytes at beginning of file (%PDF-)
  if (buffer.length < 5 || !buffer.subarray(0, 5).equals(PDF_MAGIC_BYTES)) {
    throw new AppError(400, "Invalid file format: File header does not match a valid PDF.");
  }

  return {
    sanitizedFilename,
    fileSize: buffer.length
  };
}

/**
 * Ingests and processes a PDF document into a structured document representation.
 * Completely local, deterministic, and independent from the AI/LLM layer.
 *
 * @param {Buffer} pdfBuffer - In-memory PDF buffer
 * @param {Object} [options={}] - Processing options
 * @param {string} [options.filename] - Original document name
 * @param {number} [options.maxSize] - Optional max file size
 * @returns {Promise<{
 *   metadata: Object,
 *   pages: Array<Object>,
 *   segments: Array<Object>,
 *   normalizedText: string,
 *   rawText: string
 * }>}
 */
export async function processPdfDocument(pdfBuffer, options = {}) {
  // Step 1: Validate file buffer, size, and magic bytes
  const { sanitizedFilename, fileSize } = validatePdfBuffer(pdfBuffer, options);

  // Step 2: Page-by-page extraction & text normalization
  const extractionResult = await extractPdfPages(pdfBuffer);

  // Step 3: Deterministic clause segmentation
  const segments = segmentDocumentPages(extractionResult.pages);

  // Step 4: Assemble comprehensive document structure
  return {
    metadata: {
      filename: sanitizedFilename,
      fileSizeBytes: fileSize,
      pageCount: extractionResult.metadata.pageCount,
      extractedPageCount: extractionResult.metadata.extractedPageCount,
      unextractablePages: extractionResult.metadata.unextractablePages,
      requiresOcr: extractionResult.metadata.requiresOcr,
      ocrNotice: extractionResult.metadata.ocrNotice,
      characterCount: extractionResult.metadata.totalNormalizedCharacters,
      wordCount: extractionResult.metadata.totalWords,
      segmentCount: segments.length,
      processedAt: new Date().toISOString()
    },
    pages: extractionResult.pages,
    segments,
    normalizedText: extractionResult.normalizedText,
    rawText: extractionResult.rawText
  };
}
