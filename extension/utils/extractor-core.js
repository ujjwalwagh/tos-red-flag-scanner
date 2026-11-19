/**
 * TOS Red Flag Scanner — Policy Text Extraction Core (Phase 7E)
 *
 * Implements deterministic DOM and HTML extraction, container prioritization,
 * aggressive clutter removal (scripts, cookie banners, navigation, ads),
 * whitespace normalization, and substance validation.
 */

import { isSafeHttpUrl, normalizeText } from "./detector-rules.js";

// Extraction Safety & Substance Limits
export const MAX_EXTRACTION_CHARS = 500000;
export const MIN_EXTRACTION_WORDS = 30;
export const MIN_EXTRACTION_CHARS = 150;

// High-priority legal content container selectors
export const PRIORITY_CONTAINERS = [
  "main",
  "article",
  '[role="main"]',
  ".legal-content",
  ".policy-content",
  ".terms-content",
  ".privacy-content",
  ".markdown-body",
  ".entry-content",
  ".document-content",
  "#content",
  "#main-content",
  ".main-content",
  ".site-content",
  "#content-area",
  ".content-area"
];

// Elements and noise containers to prune completely
export const EXCLUDE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "canvas",
  "audio",
  "video",
  "object",
  "embed",
  "header",
  "footer",
  "nav",
  "aside",
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="navigation"]',
  '[role="complementary"]',
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "dialog",
  "menu",
  '[aria-hidden="true"]',
  "[hidden]",
  ".ad",
  ".advertisement",
  ".ad-banner",
  '[class*="cookie" i]',
  '[id*="cookie" i]',
  '[class*="consent" i]',
  '[id*="consent" i]',
  '[class*="advert" i]',
  '[id*="advert" i]',
  ".sidebar",
  ".related-links",
  ".share-buttons",
  ".social-share"
];

const BLOCKED_PATTERNS = [
  /\b(?:attention required! \| cloudflare|just a moment\.\.\.|access denied|verify you are human|security check)\b/i,
  /\b(?:please enable cookies and reload the page|checking your browser before accessing)\b/i,
  /\b(?:403 forbidden|404 not found|page not found)\b/i
];

/**
 * Checks if a given URL points directly to a PDF resource.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPdfUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/**
 * Validates whether a URL is extractable and not an internal, restricted, or private destination.
 *
 * @param {string} urlString
 * @returns {{ valid: boolean, error?: string }}
 */
export function isExtractablePolicyUrl(urlString) {
  if (!isSafeHttpUrl(urlString)) {
    return { valid: false, error: "Invalid or unsafe URL scheme. Must be http or https." };
  }
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();

    // Reject localhost and private IP address ranges
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return { valid: false, error: "Extraction from private or localhost networks is not permitted." };
    }

    // Reject browser web stores
    if (
      host === "chromewebstore.google.com" ||
      host === "chrome.google.com" ||
      host === "microsoftedge.microsoft.com"
    ) {
      return { valid: false, error: "Cannot extract from browser extension stores." };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Malformed destination URL." };
  }
}

/**
 * Validates a candidate object before extraction begins.
 *
 * @param {Object} candidate
 * @returns {{ valid: boolean, status?: string, isPdf?: boolean, error?: string }}
 */
export function validateCandidateForExtraction(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, error: "No document candidate selected." };
  }
  if (!candidate.url || typeof candidate.url !== "string") {
    return { valid: false, error: "Candidate URL is missing or invalid." };
  }

  const allowedCategories = ["TERMS", "PRIVACY", "OTHER_PRIVACY"];
  const cat = String(candidate.category || "").trim().toUpperCase();
  if (!cat || !allowedCategories.includes(cat)) {
    return { valid: false, error: `Unsupported document category '${candidate.category}'.` };
  }

  if (isPdfUrl(candidate.url)) {
    return {
      valid: false,
      status: "PDF_DOCUMENT",
      isPdf: true,
      error: "Selected policy is a PDF document. Dedicated in-browser PDF extraction is not supported in this phase."
    };
  }

  const urlCheck = isExtractablePolicyUrl(candidate.url);
  if (!urlCheck.valid) {
    return { valid: false, error: urlCheck.error };
  }

  return { valid: true };
}

/**
 * Normalizes text paragraphs, removes duplicate adjacent blocks, and formats whitespace.
 *
 * @param {string[]} rawBlocks
 * @returns {string}
 */
export function cleanAndFormatText(rawBlocks) {
  if (!Array.isArray(rawBlocks)) return "";

  const cleanedLines = [];
  let previousLine = "";

  for (const block of rawBlocks) {
    if (!block || typeof block !== "string") continue;
    // Replace non-breaking spaces and line-break artifacts
    const line = block
      .replace(/\u00A0/g, " ")
      .replace(/[\r\t]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .trim();

    if (!line) continue;

    // Deduplicate identical consecutive paragraphs/headings
    if (line.toLowerCase() === previousLine.toLowerCase()) {
      continue;
    }

    cleanedLines.push(line);
    previousLine = line;
  }

  return cleanedLines.join("\n\n").trim();
}

/**
 * Evaluates extracted text for substance, size limits, and empty states.
 *
 * @param {string} text
 * @param {Object} meta
 * @returns {Object}
 */
export function validateExtractionResult(text, meta = {}) {
  const charCount = typeof text === "string" ? text.length : 0;
  const words = text ? text.trim().split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  if (charCount === 0 || wordCount === 0) {
    return {
      ok: false,
      status: "EMPTY_DOCUMENT",
      error: "The extracted policy document is completely empty.",
      wordCount: 0,
      charCount: 0
    };
  }

  // Check for CAPTCHA or access blocked pages
  const first1000 = text.slice(0, 1000).toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(first1000) && wordCount < 100) {
      return {
        ok: false,
        status: "ACCESS_BLOCKED",
        error: "Access to this policy document was blocked or requires authentication/CAPTCHA verification.",
        wordCount,
        charCount
      };
    }
  }

  // Insufficient substantive content
  if (wordCount < MIN_EXTRACTION_WORDS || charCount < MIN_EXTRACTION_CHARS) {
    return {
      ok: false,
      status: "INSUFFICIENT_CONTENT",
      error: `Document contains insufficient legal content (found ${wordCount} words, minimum required is ${MIN_EXTRACTION_WORDS}).`,
      wordCount,
      charCount
    };
  }

  // Oversized document threshold
  if (charCount > MAX_EXTRACTION_CHARS) {
    return {
      ok: false,
      status: "OVERSIZED_DOCUMENT",
      error: `Document exceeds maximum extraction threshold of ${MAX_EXTRACTION_CHARS.toLocaleString()} characters (${charCount.toLocaleString()} chars found). Extraction aborted to prevent browser unresponsiveness.`,
      wordCount,
      charCount,
      maxLimit: MAX_EXTRACTION_CHARS
    };
  }

  return {
    ok: true,
    status: "SUCCESS",
    text,
    wordCount,
    charCount,
    title: meta.title || "Legal Document",
    sourceUrl: meta.url || "",
    category: meta.category || "TERMS",
    categoryLabel: meta.categoryLabel || "Terms of Service",
    headings: meta.headings || []
  };
}

/**
 * Extracts policy text from an HTML string using Cheerio (ideal for unit testing and backend-adjacent validation).
 *
 * @param {string} html
 * @param {Object} [options]
 * @param {Object} [cheerioLib] - Optional cheerio module instance
 * @returns {Object}
 */
export function extractPolicyTextFromHtml(html, options = {}, cheerioLib = null) {
  if (!html || typeof html !== "string") {
    return { ok: false, status: "EMPTY_DOCUMENT", error: "No HTML content provided for extraction." };
  }

  // In Node.js testing, cheerioLib or standard import can be used
  const $ = cheerioLib ? cheerioLib.load(html) : null;
  if (!$) {
    return { ok: false, error: "Cheerio parser required for HTML string extraction in Node environment." };
  }

  // Check PDF
  if (html.includes("%PDF-") && html.slice(0, 20).includes("%PDF-")) {
    return {
      ok: false,
      status: "PDF_DOCUMENT",
      isPdf: true,
      error: "The selected document is a PDF. Dedicated in-browser PDF extraction is not supported in this phase."
    };
  }

  // 1. Remove noise elements
  for (const selector of EXCLUDE_SELECTORS) {
    $(selector).remove();
  }

  // Remove hidden elements by style attribute
  $('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"]').remove();

  // 2. Locate best container
  let $container = null;
  for (const sel of PRIORITY_CONTAINERS) {
    const found = $(sel);
    if (found.length > 0) {
      $container = found.first();
      break;
    }
  }

  if (!$container || $container.length === 0) {
    $container = $("body");
  }

  // 3. Extract title & headings
  const pageTitle = $("title").first().text().trim() || $("h1").first().text().trim() || options.title || "Legal Document";
  const headings = [];
  $container.find("h1, h2, h3, h4").each((_, el) => {
    const hText = $(el).text().trim();
    if (hText && hText.length < 150) {
      headings.push(hText);
    }
  });

  // 4. Extract structured blocks
  const blocks = [];
  $container.find("h1, h2, h3, h4, h5, h6, p, li, blockquote, tr").each((_, el) => {
    const tagName = el.tagName ? el.tagName.toLowerCase() : "";
    const rawText = $(el).text().trim();
    if (!rawText) return;

    if (tagName.startsWith("h")) {
      blocks.push(`### ${rawText}`);
    } else if (tagName === "li") {
      blocks.push(`• ${rawText}`);
    } else {
      blocks.push(rawText);
    }
  });

  // Fallback if no structured tags found: get text
  if (blocks.length === 0) {
    const fallbackText = $container.text();
    if (fallbackText) {
      blocks.push(fallbackText);
    }
  }

  const cleanedText = cleanAndFormatText(blocks);

  return validateExtractionResult(cleanedText, {
    title: pageTitle,
    url: options.url || "",
    category: options.category || "TERMS",
    categoryLabel: options.categoryLabel || "Terms of Service",
    headings
  });
}

