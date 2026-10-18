import { normalizeText, countWords, countCharacters } from "../../processing/normalization/text-normalizer.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";

/**
 * Creates a structured document from raw text input.
 *
 * @param {string} rawText
 * @param {Object} options
 * @returns {Object} Structured document
 */
export function ingestRawText(rawText, options = {}) {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  const normalized = normalizeText(text);
  const pages = [
    {
      pageNumber: 1,
      rawText: text,
      normalizedText: normalized
    }
  ];

  return {
    metadata: {
      filename: options.filename || "pasted-policy.txt",
      pageCount: 1,
      extractedPageCount: 1,
      requiresOcr: false,
      wordCount: countWords(normalized),
      characterCount: countCharacters(normalized),
      processedAt: new Date().toISOString()
    },
    pages,
    segments: segmentDocumentPages(pages),
    normalizedText: normalized,
    rawText: text
  };
}
