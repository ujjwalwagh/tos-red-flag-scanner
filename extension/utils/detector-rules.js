/**
 * TOS Red Flag Scanner — Policy Link Detection Rules & Classifiers (Phase 7D)
 *
 * Provides deterministic classification patterns, container detection heuristics,
 * and tiered confidence scoring for Terms of Service and Privacy Policy links.
 */

// 1. Terms of Service Anchor Text Patterns
export const TERMS_ANCHOR_PATTERNS = [
  /\bterms\s+of\s+(?:service|use|sale|access)\b/i,
  /\bterms\s*(?:&|and)\s*conditions\b/i,
  /\bend\s+user\s+(?:license\s+)?agreement\b/i,
  /\beula\b/i,
  /\buser\s+agreement\b/i,
  /\b(?:paid\s+)?subscription\s+(?:terms|agreement)\b/i,
  /\bpaid\s+subscription\s+terms\b/i,
  /\bsubscription\s+(?:terms|agreement)\b/i,
  /\bgeneral\s+terms(?:\s+and\s+conditions)?\b/i,
  /\bservice\s+agreement\b/i,
  /\bconditions\s+of\s+(?:use|service)\b/i,
  /\bvisitor\s+agreement\b/i,
  /\bcustomer\s+agreement\b/i,
  /\bwebsite\s+terms\b/i
];

// Fallback weak Terms anchor match (only valid when inside footer/legal container)
export const TERMS_WEAK_ANCHOR_PATTERN = /^terms$/i;

// 2. Terms of Service URL Path Patterns
export const TERMS_URL_PATTERNS = [
  /\/(?:terms(?:-of-service|-of-use|-and-conditions|-conditions)?|tos|legal\/(?:terms|end-user-agreement|paid-subscription-terms|subscription-terms|subscription-agreement|user-agreement)|user-agreement|end-user-agreement|paid-subscription-terms|subscription-terms|subscription-agreement|conditions-of-use|service-agreement)(?:\/|$|\.html?|\?)/i
];

// 3. Privacy Policy Anchor Text Patterns
export const PRIVACY_ANCHOR_PATTERNS = [
  /\bprivacy\s+policy\b/i,
  /\bprivacy\s+notice\b/i,
  /\bprivacy\s+statement\b/i,
  /\bdata\s+privacy\b/i,
  /\bdata\s+protection(?:\s+policy|\s+notice|\s+statement)?\b/i,
  /\byour\s+privacy\s+rights\b/i,
  /\bglobal\s+privacy\b/i,
  /\bcustomer\s+privacy\b/i
];

// Fallback weak Privacy anchor match (only valid when inside footer/legal container)
export const PRIVACY_WEAK_ANCHOR_PATTERN = /^privacy$/i;

// 4. Privacy Policy URL Path Patterns
export const PRIVACY_URL_PATTERNS = [
  /\/(?:privacy(?:-policy|-notice|-statement)?|legal\/privacy|data-protection|data-privacy)(?:\/|$|\.html?|\?)/i
];

// 5. Other Privacy / Regional / Statutory Anchor Patterns
export const OTHER_PRIVACY_ANCHOR_PATTERNS = [
  /\bdo\s+not\s+sell\s+(?:or\s+share\s+)?(?:my\s+)?(?:personal\s+)?(?:info|information|data)\b/i,
  /\byour\s+privacy\s+choices\b/i,
  /\bcalifornia\s+privacy(?:\s+notice|\s+rights|\s+disclosures)?\b/i,
  /\bcookie\s+(?:policy|notice|preferences|settings)\b/i,
  /\bgdpr\s+(?:compliance|rights|notice)?\b/i,
  /\bopt-out\s+choices\b/i,
  /\bconsumer\s+health\s+privacy\b/i
];

// 6. Other Privacy URL Path Patterns
export const OTHER_PRIVACY_URL_PATTERNS = [
  /\/(?:do-not-sell|privacy-choices|california-privacy|cookie-policy|cookies|cookie-settings|gdpr)(?:\/|$|\.html?|\?)/i
];

// 7. Legal Documents Hub Patterns (Phase 7G-D.7.2)
export const LEGAL_HUB_ANCHOR_PATTERNS = [
  /^legal$/i,
  /\blegal\s+(?:hub|center|centre|portal|menu|information|home|overview|agreements?|notices?|policies)\b/i
];

export const LEGAL_HUB_URL_PATTERNS = [
  /\/(?:(?:[a-z]{2}(?:-[a-z]{2})?\/)?legal|legal-hub|legal-center)(?:\/|$|\.html?|\?)/i
];

// 8. Structural Legal Container Class / ID / Tag Markers (Tier 1)
const LEGAL_CONTAINER_SELECTORS = [
  "footer",
  '[role="contentinfo"]',
  "nav.footer",
  "nav.legal",
  ".footer",
  "#footer",
  ".site-footer",
  ".legal-links",
  ".footer-links",
  ".sub-footer",
  ".copyright",
  '[aria-label*="legal" i]',
  '[aria-label*="footer" i]'
];

/**
 * Checks if a given URL uses a safe protocol (HTTP or HTTPS).
 * Rejects javascript:, mailto:, tel:, data:, chrome:, and malformed targets.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function isSafeHttpUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return false;
  const trimmed = urlString.trim().toLowerCase();

  // Reject pseudo-protocols and anchor fragments immediately
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("chrome:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("#")
  ) {
    return false;
  }

  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes text by removing line-breaks, collapsing whitespace, and trimming.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Determines whether a URL hash fragment represents a distinct legal document/section
 * rather than an ephemeral tracking parameter, text fragment, generic page layout anchor,
 * or intra-document paragraph/section jump bookmark.
 *
 * @param {string} rawHash
 * @returns {boolean}
 */
export function isMeaningfulCandidateFragment(rawHash) {
  if (typeof rawHash !== "string") return false;
  const hash = rawHash.replace(/^#/, "").trim().toLowerCase();
  if (!hash || hash === "/") return false;

  // 1. Chrome scroll-to-text fragments (e.g. :~:text=...)
  if (hash.startsWith(":~:text=") || hash.includes(":~:")) return false;

  // 2. Tracking / analytics parameters inside fragments
  if (
    hash.startsWith("_") ||
    hash.includes("utm_") ||
    hash.includes("xtor=") ||
    hash.includes("fbclid=") ||
    hash.includes("gclid=") ||
    hash.includes("ref=") ||
    hash.includes("source=") ||
    hash.includes("token=") ||
    hash.includes("session=")
  ) {
    return false;
  }

  // 3. Generic layout / navigation anchors
  const genericLayoutAnchors = new Set([
    "top", "main", "content", "main-content", "header", "footer",
    "nav", "page-top", "root", "app", "body", "start"
  ]);
  if (genericLayoutAnchors.has(hash)) return false;

  // 4. Intra-document section / paragraph numbering bookmarks (e.g. section2, section-3, p-4, clause_12)
  if (/^(section|sec|clause|para|paragraph|p|item|heading|h[1-6]|part|article|art)[-_]?[0-9]+$/.test(hash)) {
    return false;
  }

  return true;
}

/**
 * Normalizes a URL for stable deduplication by lowercasing host and path,
 * stripping trailing slashes, stripping tracking query parameters, and preserving
 * meaningful legal policy fragments while stripping tracking and intra-document bookmarks.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function canonicalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";

    // Clean tracking query parameters
    const trackingQueryKeys = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "gclid", "fbclid", "msclkid", "dclid", "_ga", "_gl", "mc_cid", "mc_eid"
    ]);
    const cleanParams = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      const lowerK = k.toLowerCase();
      if (!trackingQueryKeys.has(lowerK) && !lowerK.startsWith("utm_")) {
        cleanParams.append(k, v);
      }
    }
    const search = cleanParams.toString() ? `?${cleanParams.toString()}` : "";

    // Preserve meaningful legal document anchors, strip noise and section jumps
    let hash = "";
    if (parsed.hash) {
      const rawHash = parsed.hash.replace(/^#/, "").trim();
      if (rawHash && isMeaningfulCandidateFragment(rawHash)) {
        hash = `#${rawHash.toLowerCase()}`;
      }
    }

    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${host}${port}${pathname}${search}${hash}`;
  } catch {
    return String(rawUrl || "").trim().toLowerCase();
  }
}

/**
 * Determines whether a DOM element is located within a legal or footer container (Tier 1).
 *
 * @param {Element} element
 * @returns {boolean}
 */
export function isElementInLegalContainer(element) {
  if (!element || typeof element.closest !== "function") return false;

  for (const selector of LEGAL_CONTAINER_SELECTORS) {
    try {
      if (element.closest(selector)) {
        return true;
      }
    } catch {
      // Ignore invalid DOM selector errors if any
    }
  }

  // Check element attributes directly
  const rel = (element.getAttribute("rel") || "").toLowerCase();
  if (rel.includes("terms") || rel.includes("privacy")) {
    return true;
  }

  return false;
}

/**
 * Helper to determine specific agreement title and category label for Terms candidates (Phase 7G-D.6).
 * Differentiates Paid Subscription Terms, Subscription Agreement, End User Agreement,
 * Terms and Conditions, and Terms of Use from generic Terms of Service.
 *
 * @param {string} rawText - Anchor text or heading
 * @param {string} pathname - URL pathname
 * @returns {{ categoryLabel: string, defaultTitle: string }}
 */
export function deriveTermsMetadata(rawText, pathname = "") {
  const text = (rawText || "").trim();
  const path = (pathname || "").toLowerCase();

  // 1. Paid Subscription Terms
  if (
    /\bpaid\s+subscription/i.test(text) ||
    path.includes("paid-subscription-terms") ||
    path.includes("paid-subscription")
  ) {
    return {
      categoryLabel: "Paid Subscription Terms",
      defaultTitle: "Paid Subscription Terms"
    };
  }

  // 2. Subscription Agreement / Terms
  if (
    /\bsubscription\s+(?:agreement|terms)\b/i.test(text) ||
    path.includes("subscription-terms") ||
    path.includes("subscription-agreement")
  ) {
    return {
      categoryLabel: "Subscription Agreement",
      defaultTitle: "Subscription Agreement"
    };
  }

  // 3. End User Agreement / EULA
  if (
    /\bend\s+user\s+(?:license\s+)?agreement\b/i.test(text) ||
    /\beula\b/i.test(text) ||
    path.includes("end-user-agreement") ||
    path.includes("eula")
  ) {
    return {
      categoryLabel: "End User Agreement",
      defaultTitle: "End User Agreement"
    };
  }

  // 4. Terms and Conditions
  if (
    /\bterms\s*(?:&|and)\s*conditions\b/i.test(text) ||
    path.includes("terms-and-conditions") ||
    path.includes("terms-conditions")
  ) {
    return {
      categoryLabel: "Terms and Conditions",
      defaultTitle: "Terms and Conditions"
    };
  }

  // 5. Terms of Use
  if (
    /\bterms\s+of\s+use\b/i.test(text) ||
    path.includes("terms-of-use")
  ) {
    return {
      categoryLabel: "Terms of Use",
      defaultTitle: "Terms of Use"
    };
  }

  // 6. User Agreement
  if (
    /\buser\s+agreement\b/i.test(text) ||
    path.includes("user-agreement")
  ) {
    return {
      categoryLabel: "User Agreement",
      defaultTitle: "User Agreement"
    };
  }

  // Default: Terms of Service
  return {
    categoryLabel: "Terms of Service",
    defaultTitle: "Terms of Service"
  };
}

/**
 * Classifies a candidate link and computes detection reason and confidence.
 *
 * @param {string} rawText - Anchor text, aria-label, or title
 * @param {string} rawHref - Resolved destination URL
 * @param {boolean} inLegalContainer - Whether anchor is inside a footer/legal container
 * @returns {Object|null} Classification object or null if unrelated
 */
export function classifyCandidateLink(rawText, rawHref, inLegalContainer = false) {
  const text = normalizeText(rawText);
  if (!isSafeHttpUrl(rawHref)) return null;

  const urlObj = new URL(rawHref);
  const path = urlObj.pathname.toLowerCase();

  // A. Check Other Privacy / Regional Links first (to prevent misclassifying cookie/choice links)
  const isOtherPrivacyAnchor = OTHER_PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(text));
  const isOtherPrivacyUrl = OTHER_PRIVACY_URL_PATTERNS.some((re) => re.test(path));

  if (isOtherPrivacyAnchor || isOtherPrivacyUrl) {
    const reasonParts = [];
    if (isOtherPrivacyAnchor) reasonParts.push("Anchor text match");
    if (isOtherPrivacyUrl) reasonParts.push("URL pattern match");
    if (inLegalContainer) reasonParts.push("Footer container");

    return {
      category: "OTHER_PRIVACY",
      categoryLabel: "Other Privacy Link",
      title: text || "Privacy Choices",
      url: rawHref,
      reason: reasonParts.join(" + ") || "Regional privacy disclosure",
      confidence: (isOtherPrivacyAnchor && (inLegalContainer || isOtherPrivacyUrl)) ? "High" : "Medium"
    };
  }

  // B. Check Primary Privacy Policy
  const isPrivacyAnchor = PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(text));
  const isPrivacyWeakAnchor = inLegalContainer && PRIVACY_WEAK_ANCHOR_PATTERN.test(text);
  const isPrivacyUrl = PRIVACY_URL_PATTERNS.some((re) => re.test(path));

  if (isPrivacyAnchor || isPrivacyWeakAnchor || isPrivacyUrl) {
    const reasonParts = [];
    if (isPrivacyAnchor) reasonParts.push("Anchor text match");
    else if (isPrivacyWeakAnchor) reasonParts.push("Anchor 'Privacy'");
    if (isPrivacyUrl) reasonParts.push("URL path match");
    if (inLegalContainer) reasonParts.push("Footer container");

    let confidence = "Medium";
    if ((isPrivacyAnchor || isPrivacyWeakAnchor) && (inLegalContainer || isPrivacyUrl)) {
      confidence = "High";
    } else if (!isPrivacyAnchor && isPrivacyUrl && !inLegalContainer) {
      confidence = "Low";
    }

    return {
      category: "PRIVACY",
      categoryLabel: "Privacy Policy",
      title: text || "Privacy Policy",
      url: rawHref,
      reason: reasonParts.join(" + ") || "Privacy policy pattern",
      confidence
    };
  }

  // C. Check Terms of Service
  const isTermsAnchor = TERMS_ANCHOR_PATTERNS.some((re) => re.test(text));
  const isTermsWeakAnchor = inLegalContainer && TERMS_WEAK_ANCHOR_PATTERN.test(text);
  const isTermsUrl = TERMS_URL_PATTERNS.some((re) => re.test(path));

  if (isTermsAnchor || isTermsWeakAnchor || isTermsUrl) {
    const reasonParts = [];
    if (isTermsAnchor) reasonParts.push("Anchor text match");
    else if (isTermsWeakAnchor) reasonParts.push("Anchor 'Terms'");
    if (isTermsUrl) reasonParts.push("URL path match");
    if (inLegalContainer) reasonParts.push("Footer container");

    let confidence = "Medium";
    if ((isTermsAnchor || isTermsWeakAnchor) && (inLegalContainer || isTermsUrl)) {
      confidence = "High";
    } else if (!isTermsAnchor && isTermsUrl && !inLegalContainer) {
      confidence = "Low";
    }

    const { categoryLabel, defaultTitle } = deriveTermsMetadata(text, path);

    return {
      category: "TERMS",
      categoryLabel,
      title: text || defaultTitle,
      url: rawHref,
      reason: reasonParts.join(" + ") || "Terms of service pattern",
      confidence
    };
  }

  // D. Check Legal Documents Hub (Phase 7G-D.7.2)
  const isLegalHubAnchor = LEGAL_HUB_ANCHOR_PATTERNS.some((re) => re.test(text));
  const isLegalHubUrl = LEGAL_HUB_URL_PATTERNS.some((re) => re.test(path));

  if (isLegalHubAnchor || isLegalHubUrl) {
    if (inLegalContainer || (isLegalHubAnchor && isLegalHubUrl)) {
      const reasonParts = [];
      if (isLegalHubAnchor) reasonParts.push("Anchor 'Legal'");
      if (isLegalHubUrl) reasonParts.push("Legal hub URL");
      if (inLegalContainer) reasonParts.push("Footer container");

      return {
        category: "LEGAL_HUB",
        categoryLabel: "Legal Documents Hub",
        title: text || "Legal Documents Hub",
        url: rawHref,
        reason: reasonParts.join(" + ") || "Legal hub navigation",
        confidence: inLegalContainer ? "High" : "Medium"
      };
    }
  }

  return null;
}

/**
 * Evaluates whether the currently viewed page represents a legal document candidate.
 *
 * @param {string} currentUrl - Active page URL
 * @param {string} pageTitle - document.title
 * @param {string} [h1Text] - Main heading text (e.g. from <h1>)
 * @returns {Object|null}
 */
export function classifyCurrentPage(currentUrl, pageTitle = "", h1Text = "") {
  if (!isSafeHttpUrl(currentUrl)) return null;

  const urlObj = new URL(currentUrl);
  const path = urlObj.pathname.toLowerCase();
  const title = normalizeText(pageTitle);
  const heading = normalizeText(h1Text);

  // Check Terms of Service
  const termsUrl = TERMS_URL_PATTERNS.some((re) => re.test(path));
  const termsHeading = TERMS_ANCHOR_PATTERNS.some((re) => re.test(heading) || re.test(title));

  if (termsUrl || termsHeading) {
    const reasons = [];
    if (termsUrl) reasons.push("URL path matches Terms");
    if (termsHeading) reasons.push("Page heading/title matches Terms");

    const { categoryLabel, defaultTitle } = deriveTermsMetadata(heading || title, path);

    return {
      isCandidate: true,
      category: "TERMS",
      categoryLabel,
      title: heading || title || defaultTitle,
      url: currentUrl,
      reason: reasons.join(" + ") || "Current page matches Terms",
      confidence: (termsUrl && termsHeading) ? "High" : "Medium"
    };
  }

  // Check Privacy Policy
  const privacyUrl = PRIVACY_URL_PATTERNS.some((re) => re.test(path));
  const privacyHeading = PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(heading) || re.test(title));

  if (privacyUrl || privacyHeading) {
    const reasons = [];
    if (privacyUrl) reasons.push("URL path matches Privacy");
    if (privacyHeading) reasons.push("Page heading/title matches Privacy");

    return {
      isCandidate: true,
      category: "PRIVACY",
      categoryLabel: "Privacy Policy",
      title: heading || title || "Current Privacy Document",
      url: currentUrl,
      reason: reasons.join(" + ") || "Current page matches Privacy",
      confidence: (privacyUrl && privacyHeading) ? "High" : "Medium"
    };
  }

  // Check Other Privacy Links
  const otherUrl = OTHER_PRIVACY_URL_PATTERNS.some((re) => re.test(path));
  const otherHeading = OTHER_PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(heading) || re.test(title));

  if (otherUrl || otherHeading) {
    return {
      isCandidate: true,
      category: "OTHER_PRIVACY",
      categoryLabel: "Other Privacy Link",
      title: heading || title || "Current Privacy Choices Page",
      url: currentUrl,
      reason: "Current page URL or heading matches regional privacy disclosures",
      confidence: "Medium"
    };
  }

  // Check Legal Documents Hub (Phase 7G-D.7.2)
  const legalHubUrl = LEGAL_HUB_URL_PATTERNS.some((re) => re.test(path));
  const legalHubHeading = LEGAL_HUB_ANCHOR_PATTERNS.some((re) => re.test(heading) || re.test(title));

  if (legalHubUrl || legalHubHeading) {
    return {
      isCandidate: true,
      category: "LEGAL_HUB",
      categoryLabel: "Legal Documents Hub",
      title: heading || title || "Legal Documents Hub",
      url: currentUrl,
      reason: "Current page matches Legal Documents Hub",
      confidence: (legalHubUrl && legalHubHeading) ? "High" : "Medium"
    };
  }

  return null;
}

