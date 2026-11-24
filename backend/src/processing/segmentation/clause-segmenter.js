/**
 * Basic Deterministic Clause Segmentation Layer for TOS Red Flag Scanner.
 * Splits normalized document text into structured segments based on structural signals
 * (headings, numbered clauses, sections, and paragraphs) without using an LLM.
 */

import { countWords, countCharacters } from "../normalization/text-normalizer.js";

// Common legal clause keywords for heuristic category tagging
const CLAUSE_CATEGORY_KEYWORDS = {
  arbitration: ["arbitration", "dispute resolution", "governing law", "jurisdiction", "jury waiver", "class action waiver"],
  liability: ["limitation of liability", "indemnification", "hold harmless", "disclaimer of warranties", "as is"],
  termination: ["termination", "cancellation", "suspension", "modifications to terms", "changes to terms"],
  privacy: ["privacy", "data collection", "data sharing", "cookies", "tracking", "personal information", "third party"],
  payment: ["fees", "billing", "subscription", "auto-renewal", "refund", "recurring charge", "payment terms"],
  intellectual_property: ["intellectual property", "copyright", "trademarks", "license grant", "proprietary rights", "user content"]
};

// Patterns that identify section headings or clause boundaries
const HEADING_PATTERNS = [
  // 1. / 1.1 / 1.1.1 / Section 1 / Article I
  /^(?:SECTION|ARTICLE|PART|CLAUSE)\s+[\dIVXLCDM]+[:.]?\s*(.*)$/i,
  /^(\d+(?:\.\d+)*)[:.]?\s+([A-Z].*)$/,
  // All-caps titles at the start of a block (e.g. "LIMITATION OF LIABILITY")
  /^([A-Z0-9 ,'\-–—]{4,60})$/
];

/**
 * Segments an array of processed pages into structured document segments.
 *
 * @param {Array<{pageNumber: number, normalizedText: string, rawText: string}>} pages
 * @returns {Array<Object>} List of structured clause segments
 */
export function segmentDocumentPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  const segments = [];
  let globalSegmentIndex = 0;

  for (const page of pages) {
    const pageNumber = page.pageNumber || 1;
    const pageText = (page.normalizedText || page.text || page.rawText || "").trim();

    if (!pageText) {
      continue;
    }

    // Split page text into candidate blocks by double newline
    const blocks = pageText.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const headingInfo = detectHeading(block);

      let title = null;
      let textContent = block;

      if (headingInfo) {
        title = headingInfo.title;
        // If the block contains more text after the heading line, extract it
        if (headingInfo.remainingText) {
          textContent = headingInfo.remainingText;
        }
      }

      // Check if this block is just a standalone heading and the next block has the body
      if (title && !headingInfo?.remainingText && i + 1 < blocks.length) {
        const nextBlock = blocks[i + 1];
        if (!detectHeading(nextBlock)) {
          // Merge heading with the following block body
          textContent = nextBlock;
          i += 1; // Consume next block
        }
      }

      const inferredCategory = inferClauseCategory(title, textContent);

      segments.push({
        segmentIndex: globalSegmentIndex++,
        pageNumber,
        title: title || `Section on Page ${pageNumber}`,
        clauseCategory: inferredCategory,
        text: textContent,
        wordCount: countWords(textContent),
        charCount: countCharacters(textContent)
      });
    }
  }

  // If no structured segments were identified (e.g. dense continuous text), fallback to page-level blocks
  if (segments.length === 0) {
    pages.forEach((page, idx) => {
      const fallbackText = (page.normalizedText || page.text || page.rawText || "").trim();
      if (fallbackText) {
        segments.push({
          segmentIndex: idx,
          pageNumber: page.pageNumber || 1,
          title: `Page ${page.pageNumber || 1} Content`,
          clauseCategory: "general",
          text: fallbackText,
          wordCount: countWords(fallbackText),
          charCount: countCharacters(fallbackText)
        });
      }
    });
  }

  return segments;
}

/**
 * Checks if a block of text starts with a recognized heading or section marker.
 * @param {string} block
 * @returns {{ title: string, remainingText?: string } | null}
 */
function detectHeading(block) {
  const firstLine = block.split("\n")[0].trim();
  const restOfBlock = block.slice(firstLine.length).trim();

  for (const pattern of HEADING_PATTERNS) {
    const match = firstLine.match(pattern);
    if (match) {
      return {
        title: firstLine,
        remainingText: restOfBlock.length > 0 ? restOfBlock : null
      };
    }
  }

  return null;
}

/**
 * Informs a basic heuristic category based on detected title and text keywords.
 * @param {string|null} title
 * @param {string} text
 * @returns {string} Inferred category or "general"
 */
function inferClauseCategory(title, text) {
  const combined = `${title || ""} ${text.slice(0, 300)}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CLAUSE_CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (combined.includes(kw)) {
        return category;
      }
    }
  }

  return "general";
}
