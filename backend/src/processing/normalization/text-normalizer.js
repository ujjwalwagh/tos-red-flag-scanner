/**
 * Text Normalization & Preprocessing Layer for TOS Red Flag Scanner.
 * Cleans extracted legal text while strictly preserving legal terminology and original phrasing.
 */

// Replace smart/curly quotes with standard ASCII equivalents
const SMART_QUOTES_MAP = {
  "\u2018": "'", // Left single quotation mark
  "\u2019": "'", // Right single quotation mark / apostrophe
  "\u201A": "'", // Single low-9 quotation mark
  "\u201B": "'", // Single high-reversed-9 quotation mark
  "\u201C": '"', // Left double quotation mark
  "\u201D": '"', // Right double quotation mark
  "\u201E": '"', // Double low-9 quotation mark
  "\u201F": '"', // Double high-reversed-9 quotation mark
  "\u00AB": '"', // Left-pointing double angle quotation mark
  "\u00BB": '"'  // Right-pointing double angle quotation mark
};

const SMART_QUOTES_REGEX = /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u00AB\u00BB]/g;

// Normalize dashes (em-dash, en-dash, horizontal bar)
const DASH_REGEX = /[\u2013\u2014\u2015]/g;

// Control characters (excluding \t, \n, \r)
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Normalizes raw extracted text from a PDF or legal document.
 * Preserves legal language exactly as written while cleaning extraction artifacts.
 *
 * @param {string} rawText - Unprocessed text from PDF extraction
 * @returns {string} Cleaned, normalized text with preserved paragraph breaks
 */
export function normalizeText(rawText) {
  if (typeof rawText !== "string") {
    return "";
  }

  // 1. Unicode NFKC normalization (canonical decomposition + canonical composition)
  let text = rawText.normalize("NFKC");

  // 2. Strip non-printable / control characters (safe removal of PDF junk bytes)
  text = text.replace(CONTROL_CHARS_REGEX, "");

  // 3. Normalize non-breaking spaces and other irregular Unicode spaces
  text = text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");

  // 4. Normalize smart quotes and special dashes
  text = text.replace(SMART_QUOTES_REGEX, (char) => SMART_QUOTES_MAP[char] || char);
  text = text.replace(DASH_REGEX, " - ");

  // 5. Standardize line endings to \n
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 6. Fix hyphenated line breaks (e.g. "infor-\nmation" -> "information", "agree-\nment" -> "agreement")
  // Only merges when hyphen is directly preceded and followed by letters
  text = text.replace(/([a-zA-Z]{2,})-\n([a-zA-Z]{2,})/g, "$1$2");

  // 7. Unwrap soft line wraps within sentences while preserving paragraph boundaries
  // Two or more newlines represent a paragraph break: protect them
  const paragraphs = text.split(/\n{2,}/);

  const cleanedParagraphs = paragraphs
    .map((para) => {
      // Split into lines within paragraph
      const lines = para.split("\n").map((l) => l.trim());
      // Join lines with single space, unless line looks like a bullet or list item
      let merged = "";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        if (!merged) {
          merged = line;
        } else {
          // If line starts with bullet or number (e.g., "1.", "a.", "-", "*"), keep newline
          const isListItem = /^(\d+[\.\)]|[a-zA-Z][\.\)]|[-*•])\s+/.test(line);
          if (isListItem) {
            merged += "\n" + line;
          } else {
            merged += " " + line;
          }
        }
      }
      // Collapse excessive horizontal spaces within paragraph
      return merged.replace(/[ \t]+/g, " ").trim();
    })
    .filter((para) => para.length > 0);

  return cleanedParagraphs.join("\n\n");
}

/**
 * Counts words in a string using word boundary matching.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (typeof text !== "string" || !text.trim()) return 0;
  const matches = text.match(/\b[\w'-]+\b/g);
  return matches ? matches.length : 0;
}

/**
 * Counts characters excluding leading/trailing whitespace.
 * @param {string} text
 * @returns {number}
 */
export function countCharacters(text) {
  return typeof text === "string" ? text.trim().length : 0;
}
