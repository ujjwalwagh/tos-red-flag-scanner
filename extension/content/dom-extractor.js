/**
 * TOS Red Flag Scanner — Policy DOM Text Extractor (Phase 7E)
 *
 * Injected on-demand into the legal document page (either active tab or isolated tab)
 * to locate, prune, and extract clean structured text without page alteration.
 */

(function () {
  const MAX_EXTRACTION_CHARS = 500000;
  const MIN_EXTRACTION_WORDS = 30;
  const MIN_EXTRACTION_CHARS = 150;

  const PRIORITY_CONTAINERS = [
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

  const EXCLUDE_SELECTORS = [
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

  function cleanAndFormatText(rawBlocks) {
    if (!Array.isArray(rawBlocks)) return "";
    const cleanedLines = [];
    let previousLine = "";

    for (const block of rawBlocks) {
      if (!block || typeof block !== "string") continue;
      const line = block
        .replace(/\u00A0/g, " ")
        .replace(/[\r\t]+/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .trim();

      if (!line) continue;
      if (line.toLowerCase() === previousLine.toLowerCase()) continue;

      cleanedLines.push(line);
      previousLine = line;
    }

    return cleanedLines.join("\n\n").trim();
  }

  function extractFromCurrentDom() {
    // 1. Check if page is PDF
    const isPdfType = document.contentType === "application/pdf";
    const isPdfPath = window.location.pathname.toLowerCase().endsWith(".pdf");
    const hasPdfEmbed = Boolean(document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]'));

    if (isPdfType || isPdfPath || hasPdfEmbed) {
      return {
        ok: false,
        status: "PDF_DOCUMENT",
        isPdf: true,
        error: "Selected document is a PDF. Dedicated in-browser PDF extraction is not supported in this phase.",
        url: window.location.href
      };
    }

    // 2. Locate priority container
    let container = null;
    for (const sel of PRIORITY_CONTAINERS) {
      const match = document.querySelector(sel);
      if (match && match.textContent.trim().length > 200) {
        container = match;
        break;
      }
    }

    if (!container) {
      container = document.body;
    }

    if (!container) {
      return {
        ok: false,
        status: "EMPTY_DOCUMENT",
        error: "Document body is not accessible or empty.",
        wordCount: 0,
        charCount: 0
      };
    }

    // 3. Clone container for isolated pruning (does not alter the live page)
    const cloned = container.cloneNode(true);

    // Prune noise elements from cloned subtree
    for (const sel of EXCLUDE_SELECTORS) {
      const els = cloned.querySelectorAll(sel);
      els.forEach((el) => el.remove());
    }

    // Remove hidden elements
    const hiddenEls = cloned.querySelectorAll('[style*="display: none"], [style*="display:none"], [style*="visibility: hidden"]');
    hiddenEls.forEach((el) => el.remove());

    // 4. Extract title and headings
    const docTitle = document.title ? document.title.trim() : "";
    const h1 = document.querySelector("h1");
    const mainTitle = (h1 && h1.textContent.trim()) || docTitle || "Legal Document";

    const headings = [];
    cloned.querySelectorAll("h1, h2, h3, h4").forEach((h) => {
      const hText = (h.textContent || "").trim();
      if (hText && hText.length < 150) {
        headings.push(hText);
      }
    });

    // 5. Extract structured text blocks
    const blocks = [];
    const elements = cloned.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, tr");

    if (elements.length > 0) {
      elements.forEach((el) => {
        const tagName = el.tagName.toLowerCase();
        const text = (el.textContent || "").trim();
        if (!text) return;

        if (tagName.startsWith("h")) {
          blocks.push(`### ${text}`);
        } else if (tagName === "li") {
          blocks.push(`• ${text}`);
        } else {
          blocks.push(text);
        }
      });
    } else {
      // Fallback: collect clean text from cloned container
      const rawText = cloned.textContent || "";
      if (rawText.trim()) {
        blocks.push(rawText.trim());
      }
    }

    const cleanText = cleanAndFormatText(blocks);
    const charCount = cleanText.length;
    const words = cleanText ? cleanText.trim().split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;

    // 6. Validation
    if (charCount === 0 || wordCount === 0) {
      return {
        ok: false,
        status: "EMPTY_DOCUMENT",
        error: "Extracted document contains no readable text content.",
        wordCount: 0,
        charCount: 0,
        url: window.location.href
      };
    }

    // Check CAPTCHA / Access Blocked
    const firstSnippet = cleanText.slice(0, 1000).toLowerCase();
    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(firstSnippet) && wordCount < 100) {
        return {
          ok: false,
          status: "ACCESS_BLOCKED",
          error: "Access to this policy page was blocked or requires CAPTCHA verification.",
          wordCount,
          charCount,
          url: window.location.href
        };
      }
    }

    // Insufficient legal content
    if (wordCount < MIN_EXTRACTION_WORDS || charCount < MIN_EXTRACTION_CHARS) {
      return {
        ok: false,
        status: "INSUFFICIENT_CONTENT",
        error: `Page contains insufficient legal content (found ${wordCount} words, minimum required is ${MIN_EXTRACTION_WORDS}).`,
        wordCount,
        charCount,
        url: window.location.href
      };
    }

    // Oversized threshold
    if (charCount > MAX_EXTRACTION_CHARS) {
      return {
        ok: false,
        status: "OVERSIZED_DOCUMENT",
        error: `Document exceeds maximum extraction threshold of ${MAX_EXTRACTION_CHARS.toLocaleString()} characters (${charCount.toLocaleString()} chars found).`,
        wordCount,
        charCount,
        maxLimit: MAX_EXTRACTION_CHARS,
        url: window.location.href
      };
    }

    return {
      ok: true,
      status: "SUCCESS",
      title: mainTitle,
      text: cleanText,
      wordCount,
      charCount,
      headings,
      url: window.location.href,
      hostname: window.location.hostname,
      extractedAt: new Date().toISOString()
    };
  }

  // Register listener for fallback message queries
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msgType = (message?.type || message?.action || "").trim().toUpperCase();
      if (msgType === "EXTRACT_POLICY_TEXT" || msgType === "EXTRACT_PAGE") {
        const result = extractFromCurrentDom();
        sendResponse(result);
        return true;
      }
      return false;
    });
  }

  // Direct return for chrome.scripting.executeScript injection result capture
  return extractFromCurrentDom();
})();

