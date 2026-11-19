/**
 * TOS Red Flag Scanner — Policy Link Detection Content Script (Phase 7D)
 *
 * Injected on-demand into the active tab to inspect the rendered DOM for
 * Terms of Service, Privacy Policy, and regional privacy candidate links.
 */

(function () {
  // Regex rules (mirrored from detector-rules.js for standalone in-page execution)
  const TERMS_ANCHOR_PATTERNS = [
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
  const TERMS_WEAK_ANCHOR_PATTERN = /^terms$/i;
  const TERMS_URL_PATTERNS = [
    /\/(?:terms(?:-of-service|-of-use|-and-conditions|-conditions)?|tos|legal\/(?:terms|end-user-agreement|paid-subscription-terms|subscription-terms|subscription-agreement|user-agreement)|user-agreement|end-user-agreement|paid-subscription-terms|subscription-terms|subscription-agreement|conditions-of-use|service-agreement)(?:\/|$|\.html?|\?)/i
  ];

  const PRIVACY_ANCHOR_PATTERNS = [
    /\bprivacy\s+policy\b/i,
    /\bprivacy\s+notice\b/i,
    /\bprivacy\s+statement\b/i,
    /\bdata\s+privacy\b/i,
    /\bdata\s+protection(?:\s+policy|\s+notice|\s+statement)?\b/i,
    /\byour\s+privacy\s+rights\b/i,
    /\bglobal\s+privacy\b/i,
    /\bcustomer\s+privacy\b/i
  ];
  const PRIVACY_WEAK_ANCHOR_PATTERN = /^privacy$/i;
  const PRIVACY_URL_PATTERNS = [
    /\/(?:privacy(?:-policy|-notice|-statement)?|legal\/privacy|data-protection|data-privacy)(?:\/|$|\.html?|\?)/i
  ];

  const OTHER_PRIVACY_ANCHOR_PATTERNS = [
    /\bdo\s+not\s+sell\s+(?:or\s+share\s+)?(?:my\s+)?(?:personal\s+)?(?:info|information|data)\b/i,
    /\byour\s+privacy\s+choices\b/i,
    /\bcalifornia\s+privacy(?:\s+notice|\s+rights|\s+disclosures)?\b/i,
    /\bcookie\s+(?:policy|notice|preferences|settings)\b/i,
    /\bgdpr\s+(?:compliance|rights|notice)?\b/i,
    /\bopt-out\s+choices\b/i,
    /\bconsumer\s+health\s+privacy\b/i
  ];
  const OTHER_PRIVACY_URL_PATTERNS = [
    /\/(?:do-not-sell|privacy-choices|california-privacy|cookie-policy|cookies|cookie-settings|gdpr)(?:\/|$|\.html?|\?)/i
  ];

  const LEGAL_HUB_ANCHOR_PATTERNS = [
    /^legal$/i,
    /\blegal\s+(?:hub|center|centre|portal|menu|information|home|overview|agreements?|notices?|policies)\b/i
  ];
  const LEGAL_HUB_URL_PATTERNS = [
    /\/(?:(?:[a-z]{2}(?:-[a-z]{2})?\/)?legal|legal-hub|legal-center)(?:\/|$|\.html?|\?)/i
  ];

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

  function isSafeHttpUrl(urlString) {
    if (!urlString || typeof urlString !== "string") return false;
    const trimmed = urlString.trim().toLowerCase();
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

  function normalizeText(text) {
    if (typeof text !== "string") return "";
    return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function isMeaningfulCandidateFragment(rawHash) {
    if (typeof rawHash !== "string") return false;
    const hash = rawHash.replace(/^#/, "").trim().toLowerCase();
    if (!hash || hash === "/") return false;
    if (hash.startsWith(":~:text=") || hash.includes(":~:")) return false;
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
    const genericLayoutAnchors = new Set([
      "top", "main", "content", "main-content", "header", "footer",
      "nav", "page-top", "root", "app", "body", "start"
    ]);
    if (genericLayoutAnchors.has(hash)) return false;
    if (/^(section|sec|clause|para|paragraph|p|item|heading|h[1-6]|part|article|art)[-_]?[0-9]+$/.test(hash)) {
      return false;
    }
    return true;
  }

  function canonicalizeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      let pathname = parsed.pathname.replace(/\/+$/, "");
      if (!pathname) pathname = "/";

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

  function isElementInLegalContainer(element) {
    if (!element || typeof element.closest !== "function") return false;
    for (const selector of LEGAL_CONTAINER_SELECTORS) {
      try {
        if (element.closest(selector)) return true;
      } catch {
        // ignore
      }
    }
    const rel = (element.getAttribute("rel") || "").toLowerCase();
    return rel.includes("terms") || rel.includes("privacy");
  }

  function deriveTermsMetadata(rawText, pathname = "") {
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

  function classifyCandidateLink(rawText, rawHref, inLegalContainer) {
    const text = normalizeText(rawText);
    if (!isSafeHttpUrl(rawHref)) return null;

    const urlObj = new URL(rawHref);
    const path = urlObj.pathname.toLowerCase();

    // 1. Other Privacy / Regional
    const isOtherAnchor = OTHER_PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(text));
    const isOtherUrl = OTHER_PRIVACY_URL_PATTERNS.some((re) => re.test(path));
    if (isOtherAnchor || isOtherUrl) {
      const reasons = [];
      if (isOtherAnchor) reasons.push("Anchor text match");
      if (isOtherUrl) reasons.push("URL pattern match");
      if (inLegalContainer) reasons.push("Footer container");
      return {
        category: "OTHER_PRIVACY",
        categoryLabel: "Other Privacy Link",
        title: text || "Privacy Choices",
        url: rawHref,
        reason: reasons.join(" + ") || "Regional privacy disclosure",
        confidence: (isOtherAnchor && (inLegalContainer || isOtherUrl)) ? "High" : "Medium"
      };
    }

    // 2. Primary Privacy Policy
    const isPrivacyAnchor = PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(text));
    const isPrivacyWeak = inLegalContainer && PRIVACY_WEAK_ANCHOR_PATTERN.test(text);
    const isPrivacyUrl = PRIVACY_URL_PATTERNS.some((re) => re.test(path));
    if (isPrivacyAnchor || isPrivacyWeak || isPrivacyUrl) {
      const reasons = [];
      if (isPrivacyAnchor) reasons.push("Anchor text match");
      else if (isPrivacyWeak) reasons.push("Anchor 'Privacy'");
      if (isPrivacyUrl) reasons.push("URL path match");
      if (inLegalContainer) reasons.push("Footer container");

      let confidence = "Medium";
      if ((isPrivacyAnchor || isPrivacyWeak) && (inLegalContainer || isPrivacyUrl)) {
        confidence = "High";
      } else if (!isPrivacyAnchor && isPrivacyUrl && !inLegalContainer) {
        confidence = "Low";
      }

      return {
        category: "PRIVACY",
        categoryLabel: "Privacy Policy",
        title: text || "Privacy Policy",
        url: rawHref,
        reason: reasons.join(" + ") || "Privacy policy pattern",
        confidence
      };
    }

    // 3. Terms of Service
    const isTermsAnchor = TERMS_ANCHOR_PATTERNS.some((re) => re.test(text));
    const isTermsWeak = inLegalContainer && TERMS_WEAK_ANCHOR_PATTERN.test(text);
    const isTermsUrl = TERMS_URL_PATTERNS.some((re) => re.test(path));
    if (isTermsAnchor || isTermsWeak || isTermsUrl) {
      const reasons = [];
      if (isTermsAnchor) reasons.push("Anchor text match");
      else if (isTermsWeak) reasons.push("Anchor 'Terms'");
      if (isTermsUrl) reasons.push("URL path match");
      if (inLegalContainer) reasons.push("Footer container");

      let confidence = "Medium";
      if ((isTermsAnchor || isTermsWeak) && (inLegalContainer || isTermsUrl)) {
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
        reason: reasons.join(" + ") || "Terms of service pattern",
        confidence
      };
    }

    // 4. Legal Documents Hub (Phase 7G-D.7.2)
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

  function detectCurrentPage() {
    const currentUrl = window.location.href;
    if (!isSafeHttpUrl(currentUrl)) return null;

    const urlObj = new URL(currentUrl);
    const path = urlObj.pathname.toLowerCase();
    const pageTitle = normalizeText(document.title);
    const h1Text = normalizeText(document.querySelector("h1, h2")?.textContent || "");

    const termsUrl = TERMS_URL_PATTERNS.some((re) => re.test(path));
    const termsHeading = TERMS_ANCHOR_PATTERNS.some((re) => re.test(h1Text) || re.test(pageTitle));
    if (termsUrl || termsHeading) {
      const reasons = [];
      if (termsUrl) reasons.push("URL path matches Terms");
      if (termsHeading) reasons.push("Page heading/title matches Terms");

      const { categoryLabel, defaultTitle } = deriveTermsMetadata(h1Text || pageTitle, path);

      return {
        isCandidate: true,
        category: "TERMS",
        categoryLabel,
        title: h1Text || pageTitle || defaultTitle,
        url: currentUrl,
        reason: reasons.join(" + ") || "Current page matches Terms",
        confidence: (termsUrl && termsHeading) ? "High" : "Medium"
      };
    }

    const privacyUrl = PRIVACY_URL_PATTERNS.some((re) => re.test(path));
    const privacyHeading = PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(h1Text) || re.test(pageTitle));
    if (privacyUrl || privacyHeading) {
      const reasons = [];
      if (privacyUrl) reasons.push("URL path matches Privacy");
      if (privacyHeading) reasons.push("Page heading/title matches Privacy");
      return {
        isCandidate: true,
        category: "PRIVACY",
        categoryLabel: "Privacy Policy",
        title: h1Text || pageTitle || "Current Privacy Document",
        url: currentUrl,
        reason: reasons.join(" + ") || "Current page matches Privacy",
        confidence: (privacyUrl && privacyHeading) ? "High" : "Medium"
      };
    }

    const otherUrl = OTHER_PRIVACY_URL_PATTERNS.some((re) => re.test(path));
    const otherHeading = OTHER_PRIVACY_ANCHOR_PATTERNS.some((re) => re.test(h1Text) || re.test(pageTitle));
    if (otherUrl || otherHeading) {
      return {
        isCandidate: true,
        category: "OTHER_PRIVACY",
        categoryLabel: "Other Privacy Link",
        title: h1Text || pageTitle || "Current Privacy Choices Page",
        url: currentUrl,
        reason: "Current page URL or heading matches regional privacy disclosures",
        confidence: "Medium"
      };
    }

    // Check Legal Documents Hub
    const legalHubUrl = LEGAL_HUB_URL_PATTERNS.some((re) => re.test(path));
    const legalHubHeading = LEGAL_HUB_ANCHOR_PATTERNS.some((re) => re.test(h1Text) || re.test(pageTitle));
    if (legalHubUrl || legalHubHeading) {
      return {
        isCandidate: true,
        category: "LEGAL_HUB",
        categoryLabel: "Legal Documents Hub",
        title: h1Text || pageTitle || "Legal Documents Hub",
        url: currentUrl,
        reason: "Current page matches Legal Documents Hub",
        confidence: (legalHubUrl && legalHubHeading) ? "High" : "Medium"
      };
    }

    return null;
  }

  function scanDomForPolicies() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seenUrls = new Map(); // canonicalUrl -> candidate

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) continue;

      let resolvedUrl;
      try {
        resolvedUrl = new URL(rawHref, window.location.href).href;
      } catch {
        continue;
      }

      if (!isSafeHttpUrl(resolvedUrl)) continue;

      const rawText = anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "";
      const inLegal = isElementInLegalContainer(anchor);
      const candidate = classifyCandidateLink(rawText, resolvedUrl, inLegal);

      if (candidate) {
        const canonical = canonicalizeUrl(candidate.url);
        const existing = seenUrls.get(canonical);

        if (!existing) {
          seenUrls.set(canonical, candidate);
        } else {
          // Upgrade confidence if footer instance is found
          if (candidate.confidence === "High" && existing.confidence !== "High") {
            seenUrls.set(canonical, candidate);
          }
        }
      }
    }

    const terms = [];
    const privacy = [];
    const otherPrivacy = [];
    const legalHub = [];

    for (const cand of seenUrls.values()) {
      if (cand.category === "TERMS") {
        terms.push(cand);
      } else if (cand.category === "PRIVACY") {
        privacy.push(cand);
      } else if (cand.category === "OTHER_PRIVACY") {
        otherPrivacy.push(cand);
      } else if (cand.category === "LEGAL_HUB") {
        legalHub.push(cand);
      }
    }

    // Sort by confidence: High first
    const sortByConfidence = (a, b) => (a.confidence === "High" ? -1 : 1);
    terms.sort(sortByConfidence);
    privacy.sort(sortByConfidence);
    otherPrivacy.sort(sortByConfidence);
    legalHub.sort(sortByConfidence);

    return {
      ok: true,
      url: window.location.href,
      hostname: window.location.hostname,
      currentPage: detectCurrentPage(),
      terms,
      privacy,
      otherPrivacy,
      legalHub,
      totalDetected: terms.length + privacy.length + otherPrivacy.length + legalHub.length
    };
  }

  // Register message listener for detection requests from background worker
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msgType = (message?.type || message?.action || "").trim().toUpperCase();
      if (msgType === "RUN_DETECTION" || msgType === "DETECT_POLICIES") {
        const results = scanDomForPolicies();
        sendResponse(results);
        return true;
      }
      return false;
    });
  }

  // Expose for testing if in window or module environment
  if (typeof window !== "undefined") {
    window.__tosScannerDetector = { scanDomForPolicies, detectCurrentPage };
  }

  // Execute scan and return for chrome.scripting.executeScript direct result capture
  return scanDomForPolicies();
})();

