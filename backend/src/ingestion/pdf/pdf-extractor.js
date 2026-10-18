/**
 * PDF Text Extraction Module for TOS Red Flag Scanner.
 * Extracts text page-by-page, preserves page numbers and relationships,
 * and detects pages requiring OCR.
 */

import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { AppError } from "../../security/security.js";
import { normalizeText, countWords, countCharacters } from "../../processing/normalization/text-normalizer.js";

// Minimum character and word thresholds to consider a page legitimately extracted
const MIN_EXTRACTED_CHARS = 25;
const MIN_EXTRACTED_WORDS = 4;

/**
 * Extracts text page-by-page from a PDF buffer.
 *
 * @param {Buffer} pdfBuffer - Valid PDF binary buffer
 * @returns {Promise<{
 *   metadata: Object,
 *   pages: Array<{ pageNumber: number, rawText: string, normalizedText: string, characterCount: number, wordCount: number, extractionStatus: string }>,
 *   rawText: string,
 *   normalizedText: string
 * }>}
 */
export async function extractPdfPages(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new AppError(400, "Uploaded file payload is invalid or empty.");
  }

  const rawPages = [];

  const parseOptions = {
    // Custom page render hook into pdf.js via pdf-parse
    pagerender: async function (pageData) {
      return pageData.getTextContent().then((textContent) => {
        let lastY = null;
        let text = "";

        for (const item of textContent.items) {
          if (lastY === item.transform[5] || lastY === null) {
            text += item.str;
          } else {
            text += "\n" + item.str;
          }
          lastY = item.transform[5];
        }

        // pageIndex is 0-indexed in pdf.js
        const pageNumber = typeof pageData.pageIndex === "number" ? pageData.pageIndex + 1 : rawPages.length + 1;

        rawPages.push({
          pageNumber,
          rawText: text
        });

        return text;
      });
    }
  };

  let parseResult;
  try {
    parseResult = await pdfParse(pdfBuffer, parseOptions);
  } catch (error) {
    throw new AppError(422, `Could not read text from this PDF: ${error?.message || "Invalid or corrupt format"}`);
  }

  const totalPages = parseResult.numpages || rawPages.length || 0;
  if (totalPages === 0) {
    throw new AppError(422, "The PDF file contains no pages.");
  }

  // Sort pages by page number in case pdf.js dispatched asynchronously
  rawPages.sort((a, b) => a.pageNumber - b.pageNumber);

  const processedPages = [];
  const unextractablePages = [];
  let totalRawChars = 0;
  let totalNormChars = 0;
  let totalWords = 0;

  for (let i = 0; i < totalPages; i++) {
    const pageNum = i + 1;
    const pageItem = rawPages.find((p) => p.pageNumber === pageNum) || { pageNumber: pageNum, rawText: "" };
    const rawText = pageItem.rawText || "";
    const normalized = normalizeText(rawText);

    const charCount = countCharacters(normalized);
    const wordCount = countWords(normalized);

    const hasSufficientText = charCount >= MIN_EXTRACTED_CHARS && wordCount >= MIN_EXTRACTED_WORDS;
    const extractionStatus = hasSufficientText ? "extracted" : "requires_ocr";

    if (!hasSufficientText) {
      unextractablePages.push(pageNum);
    }

    totalRawChars += rawText.length;
    totalNormChars += charCount;
    totalWords += wordCount;

    processedPages.push({
      pageNumber: pageNum,
      rawText,
      normalizedText: normalized,
      characterCount: charCount,
      wordCount,
      extractionStatus
    });
  }

  const fullRawText = processedPages.map((p) => p.rawText).join("\n\n");
  const fullNormalizedText = processedPages
    .map((p) => p.normalizedText)
    .filter(Boolean)
    .join("\n\n");

  const extractedPageCount = totalPages - unextractablePages.length;
  const requiresOcr = unextractablePages.length > 0;

  return {
    metadata: {
      pageCount: totalPages,
      extractedPageCount,
      unextractablePages,
      requiresOcr,
      ocrNotice: requiresOcr
        ? `Pages [${unextractablePages.join(", ")}] contained minimal or no text layer. Scanned images require OCR to read.`
        : null,
      totalRawCharacters: totalRawChars,
      totalNormalizedCharacters: totalNormChars,
      totalWords
    },
    pages: processedPages,
    rawText: fullRawText,
    normalizedText: fullNormalizedText
  };
}
