/**
 * TOS Red Flag Scanner — Popup Controller (Phase 7D)
 *
 * Manages active tab detection, backend connectivity status,
 * and user-triggered legal document link discovery.
 */

/**
 * Formats evidence similarity score for display.
 * Reads supported field names: similarityScore, similarity_score, similarity.
 * Preserves genuine 0% scores. Displays 'Similarity unavailable' for missing or invalid scores.
 *
 * @param {Object} item
 * @returns {string}
 */
export function formatSimilarityScore(item) {
  if (!item || typeof item !== "object") return "Similarity unavailable";
  const raw = item.similarityScore ?? item.similarity_score ?? item.similarity;

  let scoreNum = null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    scoreNum = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const parsedPct = Number(trimmed.slice(0, -1).trim());
      if (Number.isFinite(parsedPct)) {
        scoreNum = parsedPct / 100;
      }
    } else {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        scoreNum = parsed;
      }
    }
  }

  if (scoreNum === null) {
    return "Similarity unavailable";
  }

  const pct = (scoreNum > 1.0 && scoreNum <= 100) ? Math.round(scoreNum) : Math.round(scoreNum * 100);
  return `Similarity: ${pct}%`;
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
  // Elements: Header & Site
  const hostnameEl = document.getElementById("site-hostname");
  const btnDetectEl = document.getElementById("btn-detect-policies");
  const btnDetectTextEl = document.getElementById("btn-detect-text");
  const detectStatusMsgEl = document.getElementById("detect-status-msg");

  // Elements: Backend Status
  const statusDotEl = document.getElementById("status-dot");
  const statusTextEl = document.getElementById("status-text");
  const statusHintEl = document.getElementById("status-hint");
  const timestampEl = document.getElementById("status-timestamp");
  const btnCheckEl = document.getElementById("btn-check-connection");
  const btnTextEl = document.getElementById("btn-text");
  const linkWebAppEl = document.getElementById("link-open-webapp");
  const btnOpenOptionsEl = document.getElementById("btn-open-options");
  const btnConfigureBackendEl = document.getElementById("btn-configure-backend");
  const backendTargetHostEl = document.getElementById("backend-target-host");

  function openOptions() {
    if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else if (typeof window !== "undefined") {
      window.open("../options/options.html", "_blank");
    }
  }

  btnOpenOptionsEl?.addEventListener("click", openOptions);
  btnConfigureBackendEl?.addEventListener("click", openOptions);

  function updateBackendHostDisplay(url) {
    if (!backendTargetHostEl) return;
    try {
      const u = new URL(url || "http://localhost:3000");
      backendTargetHostEl.textContent = u.host;
    } catch {
      backendTargetHostEl.textContent = url || "localhost:3000";
    }
  }

  // Load configured backend hostname on startup
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "GET_BACKEND_CONFIG" }, (res) => {
      if (res?.backendUrl) {
        updateBackendHostDisplay(res.backendUrl);
      }
    });
  }

  // Elements: Results & Selection
  const resultsContainerEl = document.getElementById("results-container");
  const selectedBannerEl = document.getElementById("selected-banner");
  const selectedCategoryEl = document.getElementById("selected-category");
  const selectedTitleEl = document.getElementById("selected-title");
  const selectedUrlEl = document.getElementById("selected-url");

  const currentPageSectionEl = document.getElementById("current-page-section");
  const currentPageTitleEl = document.getElementById("current-page-title");
  const currentPageUrlEl = document.getElementById("current-page-url");
  const currentPageReasonEl = document.getElementById("current-page-reason");
  const btnSelectCurrentEl = document.getElementById("btn-select-current");

  const termsSectionEl = document.getElementById("terms-section");
  const termsCountEl = document.getElementById("terms-count");
  const termsListEl = document.getElementById("terms-list");

  const privacySectionEl = document.getElementById("privacy-section");
  const privacyCountEl = document.getElementById("privacy-count");
  const privacyListEl = document.getElementById("privacy-list");

  const otherPrivacySectionEl = document.getElementById("other-privacy-section");
  const otherPrivacyCountEl = document.getElementById("other-privacy-count");
  const otherPrivacyListEl = document.getElementById("other-privacy-list");

  const legalHubSectionEl = document.getElementById("legal-hub-section");
  const legalHubCountEl = document.getElementById("legal-hub-count");
  const legalHubListEl = document.getElementById("legal-hub-list");

  const noDocumentsMsgEl = document.getElementById("no-documents-msg");

  // Elements: Extraction & Preview (Phase 7E)
  const btnExtractEl = document.getElementById("btn-extract-document");
  const btnExtractTextEl = document.getElementById("btn-extract-text");
  const extractProgressMsgEl = document.getElementById("extract-progress-msg");

  const previewSectionEl = document.getElementById("preview-section");
  const tabTermsEl = document.getElementById("tab-terms");
  const tabPrivacyEl = document.getElementById("tab-privacy");

  const previewCategoryBadgeEl = document.getElementById("preview-category-badge");
  const previewStatusBadgeEl = document.getElementById("preview-status-badge");
  const previewDocTypeEl = document.getElementById("preview-doc-type");
  const previewWebsiteEl = document.getElementById("preview-website");
  const previewSourceUrlEl = document.getElementById("preview-source-url");
  const previewWordCountEl = document.getElementById("preview-word-count");
  const previewCharCountEl = document.getElementById("preview-char-count");
  const previewHeadingCountEl = document.getElementById("preview-heading-count");
  const previewTextContentEl = document.getElementById("preview-text-content");
  const previewAlertEl = document.getElementById("preview-alert");

  const previewActionsRowEl = document.getElementById("preview-actions-row");
  const btnConfirmDocEl = document.getElementById("btn-confirm-document");
  const btnDiscardDocEl = document.getElementById("btn-discard-document");
  const previewConfirmedBannerEl = document.getElementById("preview-confirmed-banner");
  const confirmedWordSummaryEl = document.getElementById("confirmed-word-summary");

  // Elements: Risk Analysis & Dashboard (Phase 7F)
  const btnAnalyzeDocEl = document.getElementById("btn-analyze-document");
  const btnAnalyzeTextEl = document.getElementById("btn-analyze-text");
  const analyzeProgressBoxEl = document.getElementById("analyze-progress-box");
  const analyzeProgressTextEl = document.getElementById("analyze-progress-text");
  const analyzeErrorBoxEl = document.getElementById("analyze-error-box");

  // Oversized Consent Elements (Phase 7F.1)
  const oversizedConsentBoxEl = document.getElementById("oversized-consent-box");
  const consentOrigCharsEl = document.getElementById("consent-orig-chars");
  const btnConsentProceedEl = document.getElementById("btn-consent-proceed");
  const btnConsentCancelEl = document.getElementById("btn-consent-cancel");

  const dashboardSectionEl = document.getElementById("dashboard-section");
  const dashTabTermsEl = document.getElementById("dash-tab-terms");
  const dashTabPrivacyEl = document.getElementById("dash-tab-privacy");

  const dashDocTypeEl = document.getElementById("dash-doc-type");
  const dashOverallRiskEl = document.getElementById("dash-overall-risk");
  const dashPartialBannerEl = document.getElementById("dash-partial-banner");
  const dashPartialTextEl = document.getElementById("dash-partial-text");
  const metricHighCountEl = document.getElementById("metric-high-count");
  const metricMedCountEl = document.getElementById("metric-med-count");
  const metricLowCountEl = document.getElementById("metric-low-count");
  const metricReadabilityScoreEl = document.getElementById("metric-readability-score");
  const dashReadabilityBannerEl = document.getElementById("dash-readability-banner");
  const dashReadabilityTextEl = document.getElementById("dash-readability-text");
  const dashFlagsCountEl = document.getElementById("dash-flags-count");
  const dashFlagsContainerEl = document.getElementById("dash-flags-container");
  const dashNoFlagsEl = document.getElementById("dash-no-flags");

  // Elements: Document Q&A (Phase 7G)
  const qaSectionEl = document.getElementById("qa-section");
  const qaDocTypeEl = document.getElementById("qa-doc-type");
  const qaPartialBannerEl = document.getElementById("qa-partial-banner");
  const qaPartialTextEl = document.getElementById("qa-partial-text");
  const qaFormEl = document.getElementById("qa-form");
  const qaQuestionInputEl = document.getElementById("qa-question-input");
  const qaCharCountEl = document.getElementById("qa-char-count");
  const btnSubmitQaEl = document.getElementById("btn-submit-qa");
  const qaLoadingBoxEl = document.getElementById("qa-loading-box");
  const qaErrorBoxEl = document.getElementById("qa-error-box");
  const qaHistoryContainerEl = document.getElementById("qa-history-container");
  const qaEmptyHistoryEl = document.getElementById("qa-empty-history");
  const qaChips = document.querySelectorAll(".qa-chip");

  let isQaSubmitting = false;
  let activeTabId = null;
  let activeTabUrl = null;

  // Maximum document size supported for full analysis (Phase 7G-D: 100k characters)
  const MAX_ANALYSIS_CHARACTERS = 100000;

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

  function getNormalizedCategory(candidate) {
    if (!candidate || !candidate.category) return "TERMS";
    const cat = String(candidate.category).toUpperCase();
    if (cat === "OTHER_PRIVACY" || cat === "REGIONAL_PRIVACY" || cat === "SUB_PRIVACY") return "OTHER_PRIVACY";
    if (cat === "PRIVACY") return "PRIVACY";
    if (cat === "LEGAL_HUB") return "LEGAL_HUB";
    return "TERMS";
  }

  function getCandidateKey(candidate) {
    if (!candidate || !candidate.url) return "";
    const canonUrl = canonicalizeUrl(candidate.url);
    const cat = getNormalizedCategory(candidate);
    return `${canonUrl}::${cat}`;
  }

  function createDefaultDocState(candidate = null) {
    return {
      candidate,
      extracted: null,
      confirmed: false,
      scanStatus: "IDLE", // "IDLE" | "SCANNING" | "COMPLETED" | "ERROR"
      scanResult: null,
      scanError: null,
      isPartial: false,
      submittedCharCount: 0,
      originalCharCount: 0,
      qaHistory: [],
      itemEl: null,
      btnEl: null
    };
  }

  // Registry preserving document states across candidate selections (Phase 7G-D.7)
  const documentRegistry = new Map();

  function getOrCreateDocumentState(candidate) {
    if (!candidate || !candidate.url) {
      return createDefaultDocState(candidate);
    }
    const key = getCandidateKey(candidate);
    if (!documentRegistry.has(key)) {
      documentRegistry.set(key, createDefaultDocState(candidate));
    }
    const state = documentRegistry.get(key);
    state.candidate = candidate;
    return state;
  }

  // Active document state pointers for Terms and Privacy
  const documentState = {
    TERMS: createDefaultDocState(),
    PRIVACY: createDefaultDocState(),
    OTHER_PRIVACY: createDefaultDocState()
  };
  let activePreviewTab = "TERMS";
  let activeDashboardTab = "TERMS";
  let activeCandidate = null;

  // 1. Detect Active Tab
  if (typeof chrome !== "undefined" && chrome.tabs?.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      if (activeTab) {
        activeTabId = activeTab.id;
        activeTabUrl = activeTab.url;

        if (activeTab.url) {
          try {
            const urlObj = new URL(activeTab.url);
            if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
              hostnameEl.textContent = urlObj.hostname;
              loadSessionAnalysis(activeTab.url);
            } else {
              hostnameEl.textContent = `${urlObj.protocol}// internal`;
              disableDetection("Cannot scan browser internal pages.");
            }
          } catch {
            hostnameEl.textContent = "Current Webpage";
          }
        } else {
          hostnameEl.textContent = "No active webpage";
          disableDetection("No active web page found.");
        }
      }
    });
  } else {
    hostnameEl.textContent = "Browser Environment";
  }

  function disableDetection(reason) {
    btnDetectEl.disabled = true;
    showDetectionError(reason);
  }

  function showDetectionError(msg) {
    detectStatusMsgEl.textContent = msg;
    detectStatusMsgEl.className = "detect-status-msg is-error";
    detectStatusMsgEl.classList.remove("hidden");
  }

  function hideDetectionError() {
    detectStatusMsgEl.classList.add("hidden");
    detectStatusMsgEl.textContent = "";
  }

  // 2. Health Check Function
  function performHealthCheck() {
    statusDotEl.className = "status-dot status-checking";
    statusTextEl.textContent = "Checking backend connection...";
    statusHintEl.textContent = "";
    statusHintEl.className = "status-hint";
    btnCheckEl.disabled = true;
    btnTextEl.textContent = "Checking...";

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "CHECK_HEALTH" }, (response) => {
        btnCheckEl.disabled = false;
        btnTextEl.textContent = "Check Connection";

        if (chrome.runtime.lastError) {
          renderOffline("Extension service worker unavailable.");
          return;
        }

        renderStatusResponse(response);
      });
    } else {
      setTimeout(() => {
        btnCheckEl.disabled = false;
        btnTextEl.textContent = "Check Connection";
        renderOffline("Not running in Chrome extension runtime.");
      }, 300);
    }
  }

  function renderStatusResponse(res) {
    if (!res) {
      renderOffline("No response from service worker.");
      return;
    }

    if (res.backendUrl) {
      updateBackendHostDisplay(res.backendUrl);
    }

    if (res.ok && res.status === "connected") {
      statusDotEl.className = "status-dot status-connected";
      statusTextEl.textContent = "Backend Connected";
      statusHintEl.textContent = "Ready to scan policies and verify clauses.";
      statusHintEl.className = "status-hint";
      if (res.timestamp) {
        const time = new Date(res.timestamp).toLocaleTimeString();
        timestampEl.textContent = time;
      }
      return;
    }

    if (res.status === "auth_required") {
      statusDotEl.className = "status-dot status-checking";
      statusTextEl.textContent = "Authentication Required";
      statusHintEl.textContent = "Backend requires a Bearer Token. Click Settings to configure credentials.";
      statusHintEl.className = "status-hint is-warning";
      return;
    }

    if (res.status === "cors_unconfigured") {
      statusDotEl.className = "status-dot status-checking";
      statusTextEl.textContent = "CORS Not Configured";
      statusHintEl.textContent = "Add CHROME_EXTENSION_ORIGIN to backend .env and restart backend.";
      statusHintEl.className = "status-hint is-warning";
      return;
    }

    renderOffline(res.error || "Unable to reach configured backend.");
  }

  function renderOffline(reason) {
    statusDotEl.className = "status-dot status-offline";
    statusTextEl.textContent = "Backend Offline — Start the TOS Red Flag Scanner backend.";
    statusHintEl.textContent = reason ? `Details: ${reason}` : "Ensure 'npm start' is running in the backend directory.";
    statusHintEl.className = "status-hint is-error";
  }

  // 3. Policy Detection Function
  function performPolicyDetection() {
    const executeScan = (tabId, tabUrl) => {
      hideDetectionError();
      btnDetectEl.disabled = true;
      btnDetectTextEl.textContent = "Scanning Page...";

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: "DETECT_POLICIES",
            action: "DETECT_POLICIES",
            tabId,
            tabUrl
          },
          (response) => {
            btnDetectEl.disabled = false;
            btnDetectTextEl.textContent = "Find Legal Documents";

            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || "";
              if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
                showDetectionError("Service worker inactive. Please click the extension reload button at chrome://extensions.");
              } else {
                showDetectionError(errMsg || "Failed to communicate with background service worker.");
              }
              return;
            }

            if (!response || !response.ok) {
              const err = response?.error || "Detection script failed to analyze this page.";
              if (err.includes("Unknown message type")) {
                showDetectionError("Extension service worker updated. Please visit chrome://extensions and click the Reload icon to activate the latest worker.");
              } else {
                showDetectionError(err);
              }
              return;
            }

            renderDetectionResults(response);
          }
        );
      } else {
        setTimeout(() => {
          btnDetectEl.disabled = false;
          btnDetectTextEl.textContent = "Find Legal Documents";
          showDetectionError("Detection requires Chrome extension runtime.");
        }, 300);
      }
    };

    // If tab info already cached, scan immediately
    if (activeTabId && activeTabUrl) {
      executeScan(activeTabId, activeTabUrl);
      return;
    }

    // Otherwise resolve active tab dynamically
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (activeTab?.id) {
          activeTabId = activeTab.id;
          activeTabUrl = activeTab.url;
          executeScan(activeTabId, activeTabUrl);
        } else {
          showDetectionError("No active webpage tab identified.");
        }
      });
    } else {
      showDetectionError("No active webpage tab identified.");
    }
  }

  // 4. Render Results
  function renderDetectionResults(data) {
    resultsContainerEl.classList.remove("hidden");

    // A. Current Page Candidate
    if (data.currentPage && data.currentPage.isCandidate) {
      currentPageSectionEl.classList.remove("hidden");
      currentPageTitleEl.textContent = data.currentPage.title;
      currentPageUrlEl.textContent = data.currentPage.url;
      currentPageReasonEl.textContent = `Evidence: ${data.currentPage.reason} (${data.currentPage.confidence} confidence)`;

      btnSelectCurrentEl.onclick = () => {
        selectCandidate(data.currentPage, document.getElementById("current-page-card"), btnSelectCurrentEl);
      };
    } else {
      currentPageSectionEl.classList.add("hidden");
    }

    // B. Terms of Service Candidates
    const terms = Array.isArray(data.terms) ? data.terms : [];
    termsCountEl.textContent = terms.length;
    termsListEl.innerHTML = "";
    if (terms.length > 0) {
      termsSectionEl.classList.remove("hidden");
      terms.forEach((cand) => {
        termsListEl.appendChild(createCandidateElement(cand));
      });
    } else {
      termsSectionEl.classList.add("hidden");
    }

    // C. Privacy Policy Candidates
    const privacy = Array.isArray(data.privacy) ? data.privacy : [];
    privacyCountEl.textContent = privacy.length;
    privacyListEl.innerHTML = "";
    if (privacy.length > 0) {
      privacySectionEl.classList.remove("hidden");
      privacy.forEach((cand) => {
        privacyListEl.appendChild(createCandidateElement(cand));
      });
    } else {
      privacySectionEl.classList.add("hidden");
    }

    // D. Other Privacy / Regional Links
    const otherPrivacy = Array.isArray(data.otherPrivacy) ? data.otherPrivacy : [];
    otherPrivacyCountEl.textContent = otherPrivacy.length;
    otherPrivacyListEl.innerHTML = "";
    if (otherPrivacy.length > 0) {
      otherPrivacySectionEl.classList.remove("hidden");
      otherPrivacy.forEach((cand) => {
        otherPrivacyListEl.appendChild(createCandidateElement(cand));
      });
    } else {
      otherPrivacySectionEl.classList.add("hidden");
    }

    // E. Legal Documents Hub
    const legalHub = Array.isArray(data.legalHub) ? data.legalHub : [];
    if (legalHubCountEl) legalHubCountEl.textContent = legalHub.length;
    if (legalHubListEl) legalHubListEl.innerHTML = "";
    if (legalHub.length > 0 && legalHubSectionEl) {
      legalHubSectionEl.classList.remove("hidden");
      legalHub.forEach((cand) => {
        legalHubListEl.appendChild(createLegalHubElement(cand));
      });
    } else if (legalHubSectionEl) {
      legalHubSectionEl.classList.add("hidden");
    }

    // F. Empty State
    const totalFound = (data.currentPage?.isCandidate ? 1 : 0) + terms.length + privacy.length + otherPrivacy.length + legalHub.length;
    if (totalFound === 0) {
      noDocumentsMsgEl.classList.remove("hidden");
    } else {
      noDocumentsMsgEl.classList.add("hidden");
    }
  }

  function createLegalHubElement(candidate) {
    const item = document.createElement("div");
    item.className = "candidate-item";

    const headerRow = document.createElement("div");
    headerRow.className = "cand-header-row";

    const titleEl = document.createElement("span");
    titleEl.className = "cand-title";
    titleEl.textContent = candidate.title || "Legal Documents Hub";

    const badgesContainer = document.createElement("div");
    badgesContainer.className = "cand-badges";

    const hubBadge = document.createElement("span");
    hubBadge.className = "badge badge-accent";
    hubBadge.textContent = "Legal Hub";
    badgesContainer.appendChild(hubBadge);

    const confClass = candidate.confidence === "High" ? "conf-high" : (candidate.confidence === "Medium" ? "conf-medium" : "conf-low");
    const confBadge = document.createElement("span");
    confBadge.className = `cand-confidence ${confClass}`;
    confBadge.textContent = `${candidate.confidence || "High"} Confidence`;
    badgesContainer.appendChild(confBadge);

    headerRow.appendChild(titleEl);
    headerRow.appendChild(badgesContainer);

    const urlEl = document.createElement("div");
    urlEl.className = "cand-url";
    urlEl.textContent = candidate.url;

    const metaEl = document.createElement("div");
    metaEl.className = "cand-meta";
    metaEl.textContent = `Hub: ${candidate.reason || "Central legal repository"}`;

    const openBtn = document.createElement("button");
    openBtn.className = "btn btn-sm btn-select";
    openBtn.textContent = "Open Legal Hub ↗";
    openBtn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs?.create && candidate.url) {
        chrome.tabs.create({ url: candidate.url });
      } else if (candidate.url) {
        window.open(candidate.url, "_blank");
      }
    });

    item.appendChild(headerRow);
    item.appendChild(urlEl);
    item.appendChild(metaEl);
    item.appendChild(openBtn);

    return item;
  }

  function createCandidateElement(candidate) {
    const item = document.createElement("div");
    item.className = "candidate-item";

    const headerRow = document.createElement("div");
    headerRow.className = "cand-header-row";

    const titleEl = document.createElement("span");
    titleEl.className = "cand-title";
    titleEl.textContent = candidate.title;

    const badgesContainer = document.createElement("div");
    badgesContainer.className = "cand-badges";

    if (candidate.categoryLabel && candidate.categoryLabel !== "Terms of Service" && candidate.categoryLabel !== "Privacy Policy") {
      const typeBadge = document.createElement("span");
      typeBadge.className = "badge badge-accent";
      typeBadge.textContent = candidate.categoryLabel;
      badgesContainer.appendChild(typeBadge);
    }

    const confClass = candidate.confidence === "High" ? "conf-high" : (candidate.confidence === "Medium" ? "conf-medium" : "conf-low");
    const confBadge = document.createElement("span");
    confBadge.className = `cand-confidence ${confClass}`;
    confBadge.textContent = `${candidate.confidence || "Medium"} Confidence`;
    badgesContainer.appendChild(confBadge);

    headerRow.appendChild(titleEl);
    headerRow.appendChild(badgesContainer);

    const urlEl = document.createElement("div");
    urlEl.className = "cand-url";
    urlEl.textContent = candidate.url;

    const metaEl = document.createElement("div");
    metaEl.className = "cand-meta";
    metaEl.textContent = `Detection: ${candidate.reason}`;

    const selectBtn = document.createElement("button");
    selectBtn.className = "btn btn-sm btn-select";
    selectBtn.textContent = "Select";

    const cat = getNormalizedCategory(candidate);
    const isCurrentlySelected = activeCandidate &&
      getCandidateKey(activeCandidate) === getCandidateKey(candidate);

    if (isCurrentlySelected) {
      item.classList.add("is-selected");
      selectBtn.textContent = "Selected ✓";
      const state = getOrCreateDocumentState(candidate);
      state.itemEl = item;
      state.btnEl = selectBtn;
      documentState[cat] = state;
    }

    selectBtn.addEventListener("click", () => {
      selectCandidate(candidate, item, selectBtn);
    });

    item.appendChild(headerRow);
    item.appendChild(urlEl);
    item.appendChild(metaEl);
    item.appendChild(selectBtn);

    return item;
  }

  function restoreCandidateSessionQa(candidate, callback) {
    if (typeof chrome === "undefined" || !chrome.storage?.session || !activeTabUrl || !candidate?.url) {
      if (callback) callback();
      return;
    }
    const targetState = getOrCreateDocumentState(candidate);
    if (Array.isArray(targetState.qaHistory) && targetState.qaHistory.length > 0) {
      if (callback) callback();
      return;
    }

    try {
      const host = new URL(activeTabUrl).hostname;
      const cKey = getCandidateKey(candidate);
      const candKey = `tos_qa_${host}_${encodeURIComponent(cKey)}`;
      const legacyUrlKey = `tos_qa_${host}_${encodeURIComponent(canonicalizeUrl(candidate.url))}`;

      chrome.storage.session.get([candKey, legacyUrlKey], (res) => {
        if (Array.isArray(res?.[candKey]) && res[candKey].length > 0) {
          const seen = new Set();
          const cleanHistory = [];
          for (const item of res[candKey]) {
            const id = item.id || item.requestId;
            if (id && !seen.has(id)) {
              seen.add(id);
              cleanHistory.push(item);
            } else if (!id) {
              cleanHistory.push(item);
            }
          }
          targetState.qaHistory = cleanHistory;
        } else if (Array.isArray(res?.[legacyUrlKey]) && res[legacyUrlKey].length > 0) {
          const seen = new Set();
          const cleanHistory = [];
          for (const item of res[legacyUrlKey]) {
            const id = item.id || item.requestId;
            if (id && !seen.has(id)) {
              seen.add(id);
              cleanHistory.push(item);
            } else if (!id) {
              cleanHistory.push(item);
            }
          }
          targetState.qaHistory = cleanHistory;
        } else {
          // Never fallback to category-level history for an active candidate (RC-2)
          targetState.qaHistory = [];
        }
        if (callback) callback();
      });
    } catch {
      if (callback) callback();
    }
  }

  function selectCandidate(candidate, itemEl, btnEl) {
    const cat = getNormalizedCategory(candidate);

    // Save previous active candidate state into documentRegistry if different (Phase 7G-D.7)
    const prev = activeCandidate ? getOrCreateDocumentState(activeCandidate) : documentState[cat];
    if (prev && prev.candidate && prev.candidate.url) {
      const prevKey = getCandidateKey(prev.candidate);
      documentRegistry.set(prevKey, { ...prev });
      if (prev.itemEl && prev.itemEl !== itemEl) {
        prev.itemEl.classList.remove("is-selected");
      }
      if (prev.btnEl && prev.btnEl !== btnEl) {
        prev.btnEl.textContent = "Select";
        prev.btnEl.disabled = false;
      }
    }

    // Retrieve or initialize state for selected candidate
    const targetState = getOrCreateDocumentState(candidate);
    targetState.itemEl = itemEl;
    targetState.btnEl = btnEl;

    // Apply new selection state for this category and synchronize active tabs (RC-1)
    documentState[cat] = targetState;
    activeCandidate = candidate;
    activePreviewTab = cat;
    activeDashboardTab = cat;

    if (itemEl) itemEl.classList.add("is-selected");
    if (btnEl) btnEl.textContent = "Selected ✓";

    selectedCategoryEl.textContent = candidate.categoryLabel || candidate.category || "Legal Document";
    selectedTitleEl.textContent = candidate.title;
    selectedUrlEl.textContent = candidate.url;
    selectedBannerEl.classList.remove("hidden");
    hideExtractProgress();

    // Render preview and dashboard
    renderPreview();
    renderRiskDashboard();

    // Restore candidate-specific session Q&A, then update Q&A visibility (RC-2)
    restoreCandidateSessionQa(candidate, () => {
      updateQaVisibility();
    });

    // Scroll to selection banner smoothly
    selectedBannerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // 5. Document Text Extraction (Phase 7E)
  function showExtractProgress(text) {
    extractProgressMsgEl.textContent = text;
    extractProgressMsgEl.className = "extract-progress-msg";
    extractProgressMsgEl.classList.remove("hidden");
  }

  function showExtractError(err) {
    extractProgressMsgEl.textContent = err;
    extractProgressMsgEl.className = "extract-progress-msg is-error";
    extractProgressMsgEl.classList.remove("hidden");
  }

  function hideExtractProgress() {
    extractProgressMsgEl.classList.add("hidden");
    extractProgressMsgEl.textContent = "";
  }

  function resetExtractButton() {
    btnExtractEl.disabled = false;
    btnExtractTextEl.textContent = "Extract Selected Document";
  }

  async function performTextExtraction() {
    if (!activeCandidate) {
      showExtractError("No candidate document selected for extraction.");
      return;
    }

    const cat = getNormalizedCategory(activeCandidate);
    btnExtractEl.disabled = true;
    btnExtractTextEl.textContent = "Extracting...";
    showExtractProgress("Opening selected policy...");

    // 1. Check and request optional host permission if cross-origin
    if (typeof chrome !== "undefined" && chrome.permissions?.request) {
      try {
        const destUrl = new URL(activeCandidate.url);
        const originPattern = `${destUrl.origin}/*`;

        let currentTabOrigin = "";
        if (activeTabUrl) {
          try {
            currentTabOrigin = new URL(activeTabUrl).origin;
          } catch {
            // ignore
          }
        }

        // Only request explicit host permission if target is a different origin
        if (destUrl.origin !== currentTabOrigin) {
          const hasPerm = await new Promise((resolve) => {
            chrome.permissions.contains({ origins: [originPattern] }, (res) => resolve(res));
          });

          if (!hasPerm) {
            const granted = await new Promise((resolve) => {
              chrome.permissions.request({ origins: [originPattern] }, (res) => resolve(res));
            });

            if (!granted) {
              showExtractError(`Permission to access ${destUrl.hostname} was denied by user.`);
              resetExtractButton();
              return;
            }
          }
        }
      } catch (err) {
        // Proceed and let service worker validate URL
      }
    }

    showExtractProgress("Extracting legal content...");

    // 2. Dispatch extraction request to background worker
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: "EXTRACT_POLICY",
          action: "EXTRACT_POLICY",
          candidate: activeCandidate,
          activeTabId,
          activeTabUrl
        },
        (response) => {
          resetExtractButton();

          if (chrome.runtime.lastError) {
            showExtractError(chrome.runtime.lastError.message || "Failed to communicate with extraction worker.");
            return;
          }

          if (!response) {
            showExtractError("No response received from extraction worker.");
            return;
          }

          if (!response.ok) {
            const errMsg = response.error || "Policy text extraction failed.";
            showExtractError(errMsg);

            // If specialized status (PDF, Oversized, Insufficient), render preview alert
            if (
              response.status === "PDF_DOCUMENT" ||
              response.status === "OVERSIZED_DOCUMENT" ||
              response.status === "INSUFFICIENT_CONTENT"
            ) {
              documentState[cat].extracted = response;
              activePreviewTab = cat;
              renderPreview();
            }
            return;
          }

          showExtractProgress("Preparing preview...");
          setTimeout(() => {
            hideExtractProgress();
            documentState[cat].extracted = response;
            documentState[cat].confirmed = false;
            activePreviewTab = cat;
            renderPreview();
          }, 250);
        }
      );
    } else {
      setTimeout(() => {
        resetExtractButton();
        showExtractError("Extraction requires Chrome extension runtime.");
      }, 300);
    }
  }

  // 6. Render Document Preview (Phase 7E)
  function renderPreview() {
    oversizedConsentBoxEl?.classList.add("hidden");
    const data = documentState[activePreviewTab]?.extracted;
    const hasAnyExtracted =
      documentState.TERMS.extracted ||
      documentState.PRIVACY.extracted ||
      documentState.OTHER_PRIVACY.extracted;

    if (!hasAnyExtracted && !data) {
      previewSectionEl.classList.add("hidden");
      return;
    }

    previewSectionEl.classList.remove("hidden");

    // Update tab indicators
    tabTermsEl.classList.toggle("active", activePreviewTab === "TERMS");
    tabPrivacyEl.classList.toggle("active", activePreviewTab === "PRIVACY" || activePreviewTab === "OTHER_PRIVACY");

    if (data) {
      previewDocTypeEl.textContent = activePreviewTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service";
      previewCategoryBadgeEl.textContent = data.categoryLabel || (activePreviewTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service");

      let host = data.hostname || "";
      if (!host && data.sourceUrl) {
        try { host = new URL(data.sourceUrl).hostname; } catch {}
      }
      previewWebsiteEl.textContent = host || "Webpage";
      previewSourceUrlEl.textContent = data.sourceUrl || data.url || "";
      previewWordCountEl.textContent = `${(data.wordCount || 0).toLocaleString()} words`;
      previewCharCountEl.textContent = `${(data.charCount || 0).toLocaleString()} characters`;
      previewHeadingCountEl.textContent = data.headings?.length ? `(${data.headings.length} sections found)` : "";

      // Render strictly via textContent (safe against XSS)
      previewTextContentEl.textContent = data.text || "(No text content extracted)";

      // Status badges and alerts
      if (data.ok) {
        previewStatusBadgeEl.textContent = "Successful";
        previewStatusBadgeEl.className = "badge badge-success";
        previewAlertEl.classList.add("hidden");
      } else if (data.status === "PDF_DOCUMENT") {
        previewStatusBadgeEl.textContent = "PDF Document";
        previewStatusBadgeEl.className = "badge badge-warning";
        previewAlertEl.textContent = data.error;
        previewAlertEl.classList.remove("hidden");
      } else if (data.status === "OVERSIZED_DOCUMENT") {
        previewStatusBadgeEl.textContent = "Oversized";
        previewStatusBadgeEl.className = "badge badge-warning";
        previewAlertEl.textContent = data.error;
        previewAlertEl.classList.remove("hidden");
      } else if (data.status === "INSUFFICIENT_CONTENT") {
        previewStatusBadgeEl.textContent = "Insufficient Content";
        previewStatusBadgeEl.className = "badge badge-warning";
        previewAlertEl.textContent = data.error;
        previewAlertEl.classList.remove("hidden");
      } else {
        previewStatusBadgeEl.textContent = "Extraction Notice";
        previewStatusBadgeEl.className = "badge badge-warning";
        previewAlertEl.textContent = data.error || "Extraction completed with notices.";
        previewAlertEl.classList.remove("hidden");
      }

      // Confirmation actions vs Confirmed banner
      if (documentState[activePreviewTab].confirmed) {
        previewActionsRowEl.classList.add("hidden");
        previewConfirmedBannerEl.classList.remove("hidden");
        const wc = data.wordCount || 0;
        if (confirmedWordSummaryEl) {
          confirmedWordSummaryEl.textContent = `${wc.toLocaleString()} extracted words — ready to analyse.`;
        }
      } else {
        previewActionsRowEl.classList.remove("hidden");
        previewConfirmedBannerEl.classList.add("hidden");
      }
    } else {
      // Empty slot for selected tab
      previewDocTypeEl.textContent = activePreviewTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service";
      previewWebsiteEl.textContent = "Not Extracted";
      previewSourceUrlEl.textContent = "Select a document candidate above and click Extract.";
      previewWordCountEl.textContent = "0 words";
      previewCharCountEl.textContent = "0 characters";
      previewHeadingCountEl.textContent = "";
      previewTextContentEl.textContent = `No ${activePreviewTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service"} has been extracted yet.`;
      previewStatusBadgeEl.textContent = "Idle";
      previewStatusBadgeEl.className = "badge badge-outline";
      previewAlertEl.classList.add("hidden");
      previewActionsRowEl.classList.add("hidden");
      previewConfirmedBannerEl.classList.add("hidden");
    }

    // Scroll to preview smoothly
    previewSectionEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    updateQaVisibility();
  }

  // 7. Policy Risk Analysis & Submission (Phase 7F)
  function setAnalyzeProgress(text) {
    analyzeProgressTextEl.textContent = text;
    analyzeProgressBoxEl.classList.remove("hidden");
    analyzeErrorBoxEl.classList.add("hidden");
  }

  function setAnalyzeError(err) {
    analyzeErrorBoxEl.textContent = err;
    analyzeErrorBoxEl.classList.remove("hidden");
    analyzeProgressBoxEl.classList.add("hidden");
  }

  function resetAnalyzeButton() {
    btnAnalyzeDocEl.disabled = false;
    btnAnalyzeTextEl.textContent = "Analyse Document";
    analyzeProgressBoxEl.classList.add("hidden");
  }

  async function performPolicyAnalysis(allowPartial = false) {
    const doc = documentState[activePreviewTab];
    if (!doc || !doc.candidate) {
      setAnalyzeError("No document candidate selected.");
      return;
    }

    if (!doc.confirmed) {
      setAnalyzeError("Document must be explicitly confirmed before running analysis.");
      return;
    }

    if (!doc.extracted?.text || typeof doc.extracted.text !== "string") {
      setAnalyzeError("Extracted policy text is missing or unreadable.");
      return;
    }

    const textLength = doc.extracted.text.trim().length;
    if (textLength < 500) {
      setAnalyzeError(`Extracted content has only ${textLength} characters. Backend analysis requires at least 500 characters.`);
      return;
    }

    // Phase 7G-D: Check if document exceeds backend limit (100,000 characters)
    if (textLength > MAX_ANALYSIS_CHARACTERS && !allowPartial) {
      if (consentOrigCharsEl) {
        consentOrigCharsEl.textContent = textLength.toLocaleString();
      }
      oversizedConsentBoxEl?.classList.remove("hidden");
      analyzeErrorBoxEl?.classList.add("hidden");
      analyzeProgressBoxEl?.classList.add("hidden");
      resetAnalyzeButton();
      return;
    }

    // Hide consent box if user is proceeding
    oversizedConsentBoxEl?.classList.add("hidden");

    // Disable button to prevent duplicate submissions
    btnAnalyzeDocEl.disabled = true;
    btnAnalyzeTextEl.textContent = "Analysing...";
    doc.scanStatus = "SCANNING";

    // Progress updates
    setAnalyzeProgress("Submitting document...");
    const pTimer1 = setTimeout(() => {
      setAnalyzeProgress("Analysing legal clauses...");
    }, 900);
    const pTimer2 = setTimeout(() => {
      setAnalyzeProgress("Preparing risk report...");
    }, 2800);

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: "ANALYZE_CONFIRMED_POLICY",
          action: "ANALYZE_CONFIRMED_POLICY",
          candidate: doc.candidate,
          extractedText: doc.extracted.text,
          confirmed: doc.confirmed,
          documentType: activePreviewTab,
          allowPartial: Boolean(allowPartial)
        },
        (response) => {
          clearTimeout(pTimer1);
          clearTimeout(pTimer2);
          resetAnalyzeButton();

          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || "Failed to communicate with analysis service.";
            setAnalyzeError(err);
            doc.scanStatus = "ERROR";
            doc.scanError = err;
            return;
          }

          if (response?.status === "OVERSIZED_DOCUMENT_REQUIRES_CONSENT") {
            if (consentOrigCharsEl) {
              consentOrigCharsEl.textContent = (response.originalCharCount || textLength).toLocaleString();
            }
            oversizedConsentBoxEl?.classList.remove("hidden");
            doc.scanStatus = "IDLE";
            return;
          }

          if (!response || !response.ok) {
            const err = response?.error || "Document risk analysis failed.";
            setAnalyzeError(err);
            doc.scanStatus = "ERROR";
            doc.scanError = err;
            return;
          }

          // Successful analysis response from backend
          doc.scanStatus = "COMPLETED";
          doc.scanResult = response.result;
          doc.isPartial = Boolean(response.isPartial);
          doc.submittedCharCount = response.submittedCharCount || (response.isPartial ? MAX_ANALYSIS_CHARACTERS : textLength);
          doc.originalCharCount = response.originalCharCount || textLength;
          doc.scanError = null;

          if (doc.scanResult && typeof doc.scanResult === "object") {
            doc.scanResult.isPartial = doc.isPartial;
            doc.scanResult.submittedCharCount = doc.submittedCharCount;
            doc.scanResult.originalCharCount = doc.originalCharCount;
          }

          activeDashboardTab = activePreviewTab;

          // Save lightweight report in session storage
          saveSessionAnalysis(activeTabUrl, activePreviewTab, doc.scanResult);

          renderRiskDashboard();
        }
      );
    } else {
      clearTimeout(pTimer1);
      clearTimeout(pTimer2);
      setTimeout(() => {
        resetAnalyzeButton();
        setAnalyzeError("Analysis requires Chrome extension runtime.");
      }, 300);
    }
  }

  // 8. Risk Dashboard Rendering (Phase 7F)
  function renderRiskDashboard() {
    const data = documentState[activeDashboardTab]?.scanResult;
    const hasAnyResults =
      Boolean(documentState.TERMS.scanResult) ||
      Boolean(documentState.PRIVACY.scanResult) ||
      Boolean(documentState.OTHER_PRIVACY.scanResult);

    if (!hasAnyResults && !data) {
      dashboardSectionEl.classList.add("hidden");
      return;
    }

    dashboardSectionEl.classList.remove("hidden");

    // Tab buttons active states
    dashTabTermsEl.classList.toggle("active", activeDashboardTab === "TERMS");
    dashTabPrivacyEl.classList.toggle("active", activeDashboardTab === "PRIVACY" || activeDashboardTab === "OTHER_PRIVACY");

    if (data) {
      dashDocTypeEl.textContent = activeDashboardTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service";

      // Phase 7F.1: Render Partial Analysis Banner if applicable
      const isPartial = Boolean(data.isPartial || documentState[activeDashboardTab]?.isPartial);
      if (isPartial && dashPartialBannerEl) {
        const origCount = (data.originalCharCount || documentState[activeDashboardTab]?.originalCharCount || 0).toLocaleString();
        if (dashPartialTextEl) {
          dashPartialTextEl.textContent = `Analysed initial 100,000 of ${origCount} characters. Remaining clauses were omitted.`;
        }
        dashPartialBannerEl.classList.remove("hidden");
      } else if (dashPartialBannerEl) {
        dashPartialBannerEl.classList.add("hidden");
      }

      // Overall Risk Badge
      const rawRisk = String(data.overallRisk || "low").toLowerCase();
      const riskClass = rawRisk === "critical" ? "threat-critical" : (rawRisk === "high" ? "threat-high" : (rawRisk === "medium" ? "threat-medium" : "threat-low"));
      dashOverallRiskEl.textContent = `${rawRisk.toUpperCase()} RISK`;
      dashOverallRiskEl.className = `threat-badge ${riskClass}`;

      // Calculate severity counts
      const flags = Array.isArray(data.flags) ? data.flags : [];
      const highCount = flags.filter((f) => String(f.severity).toLowerCase() === "high" || String(f.severity).toLowerCase() === "critical").length;
      const medCount = flags.filter((f) => String(f.severity).toLowerCase() === "medium").length;
      const lowCount = flags.filter((f) => String(f.severity).toLowerCase() === "low").length;

      metricHighCountEl.textContent = highCount;
      metricMedCountEl.textContent = medCount;
      metricLowCountEl.textContent = lowCount;

      // Readability score
      if (data.readability?.score != null) {
        metricReadabilityScoreEl.textContent = `${data.readability.score}/100`;
      } else {
        metricReadabilityScoreEl.textContent = "--";
      }

      // Readability warning banner
      if (data.readability?.warning) {
        dashReadabilityTextEl.textContent = `${data.readability.level || "Language"}: ${data.readability.warning}`;
        dashReadabilityBannerEl.classList.remove("hidden");
      } else {
        dashReadabilityBannerEl.classList.add("hidden");
      }

      // Red Flag Cards
      dashFlagsCountEl.textContent = flags.length;
      dashFlagsContainerEl.innerHTML = "";

      if (flags.length === 0) {
        dashNoFlagsEl.classList.remove("hidden");
        dashFlagsContainerEl.classList.add("hidden");
      } else {
        dashNoFlagsEl.classList.add("hidden");
        dashFlagsContainerEl.classList.remove("hidden");

        flags.forEach((flag) => {
          dashFlagsContainerEl.appendChild(createRedFlagElement(flag));
        });
      }
    } else {
      // Empty category slot
      dashDocTypeEl.textContent = activeDashboardTab === "PRIVACY" ? "Privacy Policy" : "Terms of Service";
      dashOverallRiskEl.textContent = "NOT ANALYSED";
      dashOverallRiskEl.className = "threat-badge badge-outline";
      dashPartialBannerEl?.classList.add("hidden");
      metricHighCountEl.textContent = "0";
      metricMedCountEl.textContent = "0";
      metricLowCountEl.textContent = "0";
      metricReadabilityScoreEl.textContent = "--";
      dashReadabilityBannerEl.classList.add("hidden");
      dashFlagsCountEl.textContent = "0";
      dashFlagsContainerEl.innerHTML = "";
      dashNoFlagsEl.classList.remove("hidden");
    }

    // Scroll smoothly to dashboard
    dashboardSectionEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    updateQaVisibility();
  }

  function createRedFlagElement(flag) {
    const card = document.createElement("div");
    const sev = String(flag.severity || "medium").toLowerCase();
    card.className = `flag-card flag-severity-${sev}`;

    // Header row
    const header = document.createElement("div");
    header.className = "flag-header";

    const title = document.createElement("span");
    title.className = "flag-title";
    title.textContent = flag.title || "Detected Legal Risk";

    const badge = document.createElement("span");
    badge.className = `badge badge-${sev}`;
    badge.textContent = `${sev.toUpperCase()}`;

    header.appendChild(title);
    header.appendChild(badge);
    card.appendChild(header);

    // Category identifier
    const catLabel = flag.categoryDisplayName || flag.clauseType || flag.category;
    if (catLabel) {
      const catEl = document.createElement("div");
      catEl.className = "flag-category";
      catEl.textContent = `Category: ${catLabel}`;
      card.appendChild(catEl);
    }

    // Original clause quote
    if (flag.quote) {
      const quoteBox = document.createElement("div");
      quoteBox.className = "flag-quote-box";
      const qLbl = document.createElement("div");
      qLbl.className = "flag-sublabel";
      qLbl.textContent = "Original Clause:";
      const qText = document.createElement("div");
      qText.className = "flag-quote";
      qText.textContent = `"${flag.quote}"`;
      quoteBox.appendChild(qLbl);
      quoteBox.appendChild(qText);
      card.appendChild(quoteBox);
    }

    // Plain English explanation
    if (flag.plainEnglish) {
      const body = document.createElement("div");
      body.className = "flag-body";
      const bLbl = document.createElement("div");
      bLbl.className = "flag-sublabel";
      bLbl.textContent = "Plain English Explanation:";
      const bText = document.createElement("div");
      bText.className = "flag-text";
      bText.textContent = flag.plainEnglish;
      body.appendChild(bLbl);
      body.appendChild(bText);
      card.appendChild(body);
    }

    // Why it matters explanation
    if (flag.whyItMatters && flag.whyItMatters !== flag.plainEnglish) {
      const why = document.createElement("div");
      why.className = "flag-why";
      const wLbl = document.createElement("div");
      wLbl.className = "flag-sublabel";
      wLbl.textContent = "Why It Matters:";
      const wText = document.createElement("div");
      wText.className = "flag-why-text";
      wText.textContent = flag.whyItMatters;
      why.appendChild(wLbl);
      why.appendChild(wText);
      card.appendChild(why);
    }

    return card;
  }

  // 9. Document Q&A Implementation (Phase 7G)
  function getActiveDocumentCategory() {
    if (dashboardSectionEl && !dashboardSectionEl.classList.contains("hidden")) {
      return activeDashboardTab || "TERMS";
    }
    if (previewSectionEl && !previewSectionEl.classList.contains("hidden")) {
      return activePreviewTab || "TERMS";
    }
    if (activeCandidate) {
      return getNormalizedCategory(activeCandidate);
    }
    return activePreviewTab || activeDashboardTab || "TERMS";
  }

  function getActiveDocumentContext(category) {
    const resolvedCat = category || getActiveDocumentCategory();
    const candCat = activeCandidate ? getNormalizedCategory(activeCandidate) : null;
    const doc = (activeCandidate && candCat === resolvedCat)
      ? getOrCreateDocumentState(activeCandidate)
      : documentState[resolvedCat];
    if (!doc) return null;

    const isPartial = Boolean(doc.isPartial);

    // 1. Prefer scanResult.segments if available and compatible
    if (Array.isArray(doc.scanResult?.segments) && doc.scanResult.segments.length > 0) {
      return {
        clauses: doc.scanResult.segments,
        isPartial,
        documentType: resolvedCat,
        candidate: doc.candidate || (candCat === resolvedCat ? activeCandidate : null)
      };
    }

    // 2. Otherwise use extracted policy text
    if (doc.extracted?.text && typeof doc.extracted.text === "string" && doc.extracted.text.trim()) {
      const cleanText = doc.extracted.text.trim();
      return {
        policyText: isPartial ? cleanText.slice(0, MAX_ANALYSIS_CHARACTERS) : cleanText,
        isPartial,
        allowPartial: isPartial,
        documentType: resolvedCat,
        candidate: doc.candidate || (candCat === resolvedCat ? activeCandidate : null)
      };
    }

    return null;
  }

  function updateQaVisibility() {
    if (!qaSectionEl) return;
    const cat = getActiveDocumentCategory();
    const candCat = activeCandidate ? getNormalizedCategory(activeCandidate) : null;
    const doc = (activeCandidate && candCat === cat)
      ? getOrCreateDocumentState(activeCandidate)
      : documentState[cat];
    const hasDoc = Boolean(doc?.extracted?.text || doc?.scanResult);

    if (hasDoc) {
      qaSectionEl.classList.remove("hidden");
      renderQaHistory(cat);
    } else {
      qaSectionEl.classList.add("hidden");
    }
  }

  function updateQaInputState() {
    if (!qaQuestionInputEl || !btnSubmitQaEl) return;
    const len = qaQuestionInputEl.value.length;
    if (qaCharCountEl) {
      qaCharCountEl.textContent = `${len} / 500`;
    }
    const trimmed = qaQuestionInputEl.value.trim();
    btnSubmitQaEl.disabled = isQaSubmitting || trimmed.length < 3 || trimmed.length > 500;
  }

  function showQaLoading(text) {
    if (qaLoadingBoxEl) {
      const txtEl = document.getElementById("qa-loading-text");
      if (txtEl) txtEl.textContent = text;
      qaLoadingBoxEl.classList.remove("hidden");
    }
    if (qaErrorBoxEl) qaErrorBoxEl.classList.add("hidden");
  }

  function hideQaLoading() {
    if (qaLoadingBoxEl) qaLoadingBoxEl.classList.add("hidden");
  }

  function setQaError(err) {
    if (qaErrorBoxEl) {
      const msg = (err && typeof err === "object" ? err.message : String(err || "")).trim() ||
        "An unexpected error occurred while processing your question.";
      qaErrorBoxEl.textContent = msg;
      qaErrorBoxEl.classList.remove("hidden");
      try {
        qaErrorBoxEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch {}
    }
    hideQaLoading();
  }

  function clearQaError() {
    if (qaErrorBoxEl) {
      qaErrorBoxEl.classList.add("hidden");
      qaErrorBoxEl.textContent = "";
    }
  }

  function savePendingQa(url, category, pendingInfo) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url && pendingInfo) {
      try {
        const host = new URL(url).hostname;
        const key = `tos_qa_pending_${host}_${category}`;
        const data = { [key]: pendingInfo };
        if (pendingInfo.candidateKey) {
          const candPendKey = `tos_qa_pending_${host}_${encodeURIComponent(pendingInfo.candidateKey)}`;
          data[candPendKey] = pendingInfo;
        }
        chrome.storage.session.set(data).catch(() => {});
      } catch {}
    }
  }

  function clearPendingQa(url, category, candidateKey = null) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url) {
      try {
        const host = new URL(url).hostname;
        const keysToRemove = [`tos_qa_pending_${host}_${category}`];
        const cKey = candidateKey || (typeof activeCandidate !== "undefined" && activeCandidate ? getCandidateKey(activeCandidate) : null);
        if (cKey) {
          keysToRemove.push(`tos_qa_pending_${host}_${encodeURIComponent(cKey)}`);
        }
        chrome.storage.session.remove(keysToRemove).catch(() => {});
      } catch {}
    }
  }

  async function performQaQuery() {
    if (isQaSubmitting) return;
    clearQaError();

    const category = getActiveDocumentCategory();
    const candCat = activeCandidate ? getNormalizedCategory(activeCandidate) : null;
    const targetCandidate = (activeCandidate && candCat === category) ? activeCandidate : (documentState[category]?.candidate || null);
    const targetCandidateKey = targetCandidate ? getCandidateKey(targetCandidate) : null;
    const targetCandidateUrl = targetCandidate?.url ? canonicalizeUrl(targetCandidate.url) : null;
    const targetCandidateTitle = targetCandidate?.title || null;
    const targetDocumentLabel = targetCandidateTitle || targetCandidate?.categoryLabel || (category === "PRIVACY" ? "Privacy Policy" : (category === "OTHER_PRIVACY" ? "Other Privacy Link" : "Terms of Service"));
    const doc = targetCandidate ? getOrCreateDocumentState(targetCandidate) : documentState[category];
    const context = getActiveDocumentContext(category);

    if (!context) {
      setQaError(`Please extract or confirm a ${category === "PRIVACY" || category === "OTHER_PRIVACY" ? "Privacy Policy" : "Terms of Service"} document first.`);
      return;
    }

    const question = qaQuestionInputEl ? qaQuestionInputEl.value.trim() : "";
    if (question.length < 3) {
      setQaError("Question must be at least 3 characters long.");
      return;
    }
    if (question.length > 500) {
      setQaError("Question must not exceed 500 characters.");
      return;
    }

    // Partial document safeguard
    if (context.policyText && context.policyText.length > MAX_ANALYSIS_CHARACTERS && !context.isPartial) {
      setQaError("This document exceeds 100,000 characters. Please confirm partial analysis first.");
      return;
    }

    const requestId = `qa_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    isQaSubmitting = true;
    updateQaInputState();
    showQaLoading("Analyzing document evidence with Gemini & verifying with DeBERTa NLI...");

    // Persist pending request state in session storage so it survives popup closure
    savePendingQa(activeTabUrl, category, {
      requestId,
      question,
      isPartial: Boolean(context.isPartial),
      candidateKey: targetCandidateKey,
      candidateUrl: targetCandidateUrl,
      candidateTitle: targetCandidateTitle,
      documentLabel: targetDocumentLabel,
      timestamp: Date.now()
    });

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          {
            type: "ASK_POLICY_QUESTION",
            action: "ASK_POLICY_QUESTION",
            requestId,
            activeTabUrl,
            question,
            clauses: context.clauses,
            policyText: context.policyText,
            isPartial: context.isPartial,
            allowPartial: context.allowPartial,
            documentType: category,
            documentLabel: targetDocumentLabel,
            candidateUrl: targetCandidateUrl,
            candidateKey: targetCandidateKey,
            candidateTitle: targetCandidateTitle
          },
          (response) => {
            try {
              hideQaLoading();
              isQaSubmitting = false;

              if (chrome.runtime.lastError) {
                clearPendingQa(activeTabUrl, category, targetCandidateKey);
                setQaError(chrome.runtime.lastError.message || "Failed to communicate with Q&A service.");
                updateQaInputState();
                return;
              }

              if (!response) {
                clearPendingQa(activeTabUrl, category, targetCandidateKey);
                setQaError("No response received from background service worker. Please try again.");
                updateQaInputState();
                return;
              }

              if (response.status === "OVERSIZED_DOCUMENT_REQUIRES_CONSENT") {
                clearPendingQa(activeTabUrl, category, targetCandidateKey);
                setQaError("Document exceeds 100,000 characters and requires explicit consent for partial analysis.");
                updateQaInputState();
                return;
              }

              if (!response.ok) {
                clearPendingQa(activeTabUrl, category, targetCandidateKey);
                setQaError(response.error || "Q&A request failed. Please try again.");
                updateQaInputState();
                return;
              }

              if (!response.qa || typeof response.qa !== "object" || typeof response.qa.answer !== "string") {
                clearPendingQa(activeTabUrl, category, targetCandidateKey);
                setQaError("Q&A service returned an invalid or malformed response structure.");
                updateQaInputState();
                return;
              }

              // Ensure pending state is cleared upon success
              clearPendingQa(activeTabUrl, category, targetCandidateKey);

              // RC-3: Route Q&A turn strictly into target candidate state
              const destDoc = targetCandidate ? getOrCreateDocumentState(targetCandidate) : doc;
              if (!Array.isArray(destDoc.qaHistory)) {
                destDoc.qaHistory = [];
              }
              const turnId = response.requestId || requestId;
              const completedTurn = response.turn || {
                id: turnId,
                requestId: turnId,
                question,
                qa: response.qa,
                isPartial: Boolean(response.isPartial),
                candidateKey: targetCandidateKey,
                candidateUrl: targetCandidateUrl,
                candidateTitle: targetCandidateTitle,
                documentLabel: targetDocumentLabel,
                timestamp: Date.now()
              };

              const existingIdx = destDoc.qaHistory.findIndex((t) => t.id === turnId || t.requestId === turnId);
              if (existingIdx >= 0) {
                destDoc.qaHistory[existingIdx] = completedTurn;
              } else {
                destDoc.qaHistory.push(completedTurn);
              }

              // Also persist in documentRegistry
              if (targetCandidateKey) {
                documentRegistry.set(targetCandidateKey, destDoc);
              }

              // Save to session storage
              saveSessionQa(activeTabUrl, category, destDoc.qaHistory, targetCandidate);

              // Clear question input if user is still viewing the target candidate
              const currentCandidateKey = activeCandidate ? getCandidateKey(activeCandidate) : null;
              const isStillActive = targetCandidateKey
                ? (currentCandidateKey === targetCandidateKey)
                : (getActiveDocumentCategory() === category);

              if (isStillActive) {
                if (qaQuestionInputEl) {
                  qaQuestionInputEl.value = "";
                }
              }
              updateQaInputState();

              // Render updated history only if user hasn't switched away to a different candidate
              if (isStillActive) {
                renderQaHistory(category);
              }
            } catch (innerErr) {
              hideQaLoading();
              isQaSubmitting = false;
              clearPendingQa(activeTabUrl, category, targetCandidateKey);
              setQaError(innerErr?.message || "Failed to process Q&A response.");
              updateQaInputState();
            }
          }
        );
      } catch (sendErr) {
        hideQaLoading();
        isQaSubmitting = false;
        clearPendingQa(activeTabUrl, category, targetCandidateKey);
        setQaError(sendErr?.message || "Failed to dispatch Q&A request.");
        updateQaInputState();
      }
    } else {
      setTimeout(() => {
        hideQaLoading();
        isQaSubmitting = false;
        clearPendingQa(activeTabUrl, category, targetCandidateKey);
        setQaError("Q&A requires Chrome extension runtime.");
        updateQaInputState();
      }, 300);
    }
  }

  function renderQaHistory(category) {
    if (!qaSectionEl || !qaHistoryContainerEl) return;
    const cat = category || (typeof getActiveDocumentCategory === "function" ? getActiveDocumentCategory() : "TERMS");
    const activeCand = (typeof activeCandidate !== "undefined") ? activeCandidate : null;
    const candCat = activeCand ? (typeof getNormalizedCategory === "function" ? getNormalizedCategory(activeCand) : null) : null;
    const doc = (activeCand && candCat === cat && typeof getOrCreateDocumentState === "function")
      ? getOrCreateDocumentState(activeCand)
      : (typeof documentState !== "undefined" && documentState ? documentState[cat] : null);
    const history = doc?.qaHistory || [];

    qaHistoryContainerEl.innerHTML = "";

    if (qaDocTypeEl) {
      const cand = (activeCand && candCat === cat) ? activeCand : doc?.candidate;
      qaDocTypeEl.textContent = cand?.title || cand?.categoryLabel || (cat === "PRIVACY" ? "Privacy Policy" : (cat === "OTHER_PRIVACY" ? "Other Privacy Link" : "Terms of Service"));
    }

    if (qaPartialBannerEl) {
      qaPartialBannerEl.classList.toggle("hidden", !doc?.isPartial);
      if (qaPartialTextEl && doc?.isPartial) {
        qaPartialTextEl.textContent = "Partial Document: Answers are grounded in the first 100,000 characters.";
      }
    }

    if (history.length === 0) {
      if (qaEmptyHistoryEl) qaEmptyHistoryEl.classList.remove("hidden");
      qaHistoryContainerEl.classList.add("hidden");
    } else {
      if (qaEmptyHistoryEl) qaEmptyHistoryEl.classList.add("hidden");
      qaHistoryContainerEl.classList.remove("hidden");

      history.forEach((turn, idx) => {
        qaHistoryContainerEl.appendChild(createQaTurnElement(turn, idx));
      });
    }
  }

  function formatSimilarityScore(item) {
    if (!item || typeof item !== "object") return "Similarity unavailable";
    const raw = item.similarityScore ?? item.similarity_score ?? item.similarity;

    let scoreNum = null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      scoreNum = raw;
    } else if (typeof raw === "string" && raw.trim() !== "") {
      const trimmed = raw.trim();
      if (trimmed.endsWith("%")) {
        const parsedPct = Number(trimmed.slice(0, -1).trim());
        if (Number.isFinite(parsedPct)) {
          scoreNum = parsedPct / 100;
        }
      } else {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          scoreNum = parsed;
        }
      }
    }

    if (scoreNum === null) {
      return "Similarity unavailable";
    }

    const pct = (scoreNum > 1.0 && scoreNum <= 100) ? Math.round(scoreNum) : Math.round(scoreNum * 100);
    return `Similarity: ${pct}%`;
  }

  function createQaTurnElement(turn, index) {
    const card = document.createElement("div");
    card.className = "qa-turn-card";

    // 1. Question Header
    const header = document.createElement("div");
    header.className = "qa-turn-header";

    const qRow = document.createElement("div");
    qRow.className = "qa-q-row";

    const qPrefix = document.createElement("span");
    qPrefix.className = "qa-q-prefix";
    qPrefix.textContent = "Q:";

    const qText = document.createElement("span");
    qText.className = "qa-question-text";
    qText.textContent = turn.question || "";

    qRow.appendChild(qPrefix);
    qRow.appendChild(qText);
    header.appendChild(qRow);
    card.appendChild(header);

    // 2. Answer Box
    const ansBox = document.createElement("div");
    ansBox.className = "qa-answer-box";
    ansBox.textContent = turn.qa?.answer || "No answer provided.";
    card.appendChild(ansBox);

    // 3. Grounding Status
    const isGrounded = Boolean(turn.qa?.grounded);
    const grRow = document.createElement("div");
    grRow.className = "qa-grounding-row";

    const grBadge = document.createElement("span");
    grBadge.className = `qa-grounded-badge ${isGrounded ? "qa-grounded-yes" : "qa-grounded-no"}`;
    grBadge.textContent = isGrounded ? "Grounded in Document" : "Not Grounded / Insufficient Evidence";
    grRow.appendChild(grBadge);

    if (turn.isPartial) {
      const partBadge = document.createElement("span");
      partBadge.className = "qa-grounded-badge qa-grounded-no";
      partBadge.textContent = "Partial Document Analysis";
      grRow.appendChild(partBadge);
    }
    card.appendChild(grRow);

    // 4. Independent NLI Verification Card (DeBERTa-v3)
    if (turn.qa?.nliValidation && typeof turn.qa.nliValidation === "object") {
      const nli = turn.qa.nliValidation;
      const rawStatus = typeof nli.status === "string" ? nli.status.toLowerCase().trim() : "unavailable";
      const status = (rawStatus === "supported" || rawStatus === "contradicted" || rawStatus === "uncertain") ? rawStatus : "unavailable";

      const nliCard = document.createElement("div");
      nliCard.className = "qa-nli-card";

      const nliHeader = document.createElement("div");
      nliHeader.className = "qa-nli-header";

      const titleGroup = document.createElement("div");
      titleGroup.className = "qa-nli-title-group";

      const nliTitle = document.createElement("span");
      nliTitle.className = "qa-nli-title";
      nliTitle.textContent = "Independent NLI Verification";

      const modelTag = document.createElement("span");
      modelTag.className = "qa-nli-model-tag";
      modelTag.textContent = "(DeBERTa-v3)";

      titleGroup.appendChild(nliTitle);
      titleGroup.appendChild(modelTag);

      const nliBadge = document.createElement("span");
      nliBadge.className = `qa-nli-badge qa-nli-${status}`;
      if (status === "supported") {
        nliBadge.textContent = "✓ Supported";
      } else if (status === "contradicted") {
        nliBadge.textContent = "✕ Contradicted";
      } else if (status === "uncertain") {
        nliBadge.textContent = "? Uncertain";
      } else {
        nliBadge.textContent = "Unavailable";
      }

      nliHeader.appendChild(titleGroup);
      nliHeader.appendChild(nliBadge);
      nliCard.appendChild(nliHeader);

      // Score pills (ONLY if valid numbers exist, never fabricate!)
      const scores = nli.scores;
      if (
        scores &&
        typeof scores === "object" &&
        typeof scores.entailment === "number" &&
        !isNaN(scores.entailment) &&
        typeof scores.neutral === "number" &&
        !isNaN(scores.neutral) &&
        typeof scores.contradiction === "number" &&
        !isNaN(scores.contradiction)
      ) {
        const scoresRow = document.createElement("div");
        scoresRow.className = "qa-nli-scores-row";

        const entPill = document.createElement("span");
        entPill.className = "qa-nli-pill qa-nli-pill-ent";
        entPill.textContent = `Entailment: ${Math.round(scores.entailment * 100)}%`;

        const neuPill = document.createElement("span");
        neuPill.className = "qa-nli-pill qa-nli-pill-neu";
        neuPill.textContent = `Neutral: ${Math.round(scores.neutral * 100)}%`;

        const conPill = document.createElement("span");
        conPill.className = "qa-nli-pill qa-nli-pill-con";
        conPill.textContent = `Contradiction: ${Math.round(scores.contradiction * 100)}%`;

        scoresRow.appendChild(entPill);
        scoresRow.appendChild(neuPill);
        scoresRow.appendChild(conPill);
        nliCard.appendChild(scoresRow);
      }

      // Best Clause ID
      if (typeof nli.bestClauseId === "string" && nli.bestClauseId.trim()) {
        const cRow = document.createElement("div");
        cRow.className = "qa-nli-clause-row";

        const cLbl = document.createElement("span");
        cLbl.textContent = "Best evidence clause:";

        const cCode = document.createElement("code");
        cCode.className = "qa-nli-clause-id";
        cCode.textContent = nli.bestClauseId.trim();

        cRow.appendChild(cLbl);
        cRow.appendChild(cCode);
        nliCard.appendChild(cRow);
      }

      // Reason if unavailable or when factual NLI is skipped (Phase 7G-D.6)
      if ((status === "unavailable" || status === "uncertain") && nli.reason) {
        const rText = document.createElement("p");
        rText.className = "qa-nli-reason";
        rText.textContent = nli.reason === "insufficient_evidence_unanswered"
          ? "Validation notice: Factual NLI skipped due to insufficient evidence."
          : `Validation notice: ${nli.reason}`;
        nliCard.appendChild(rText);
      }

      card.appendChild(nliCard);
    }

    // 5. Supporting Evidence (strictly textContent, zero innerHTML)
    if (Array.isArray(turn.qa?.evidence) && turn.qa.evidence.length > 0) {
      const evBox = document.createElement("div");
      evBox.className = "qa-evidence-box";

      const evHeader = document.createElement("div");
      evHeader.className = "qa-evidence-toggle";
      evHeader.textContent = `Supporting Evidence (${turn.qa.evidence.length} clauses):`;
      evBox.appendChild(evHeader);

      const evList = document.createElement("div");
      evList.className = "qa-evidence-list";

      turn.qa.evidence.forEach((item) => {
        const itemEl = document.createElement("div");
        itemEl.className = "qa-evidence-item";

        const meta = document.createElement("div");
        meta.className = "qa-evidence-meta";

        const sec = document.createElement("span");
        sec.className = "qa-evidence-sec";
        sec.textContent = item.section || "Clause Context";

        const score = document.createElement("span");
        score.className = "qa-evidence-score";
        score.textContent = formatSimilarityScore(item);

        meta.appendChild(sec);
        meta.appendChild(score);
        itemEl.appendChild(meta);

        const quote = document.createElement("blockquote");
        quote.className = "qa-evidence-quote";
        quote.textContent = `“${item.text || ""}”`;
        itemEl.appendChild(quote);

        evList.appendChild(itemEl);
      });

      evBox.appendChild(evList);
      card.appendChild(evBox);
    }

    return card;
  }

  // 10. Session Storage Helpers (In-Memory per browser session)
  function saveSessionAnalysis(url, category, result, candidate = null) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url) {
      try {
        const host = new URL(url).hostname;
        const key = `tos_scan_${host}_${category}`;
        const data = { [key]: result };

        const cand = candidate || (activeCandidate ? activeCandidate : documentState[category]?.candidate);
        if (cand?.url) {
          const cKey = getCandidateKey(cand);
          const candKey = `tos_scan_${host}_${encodeURIComponent(cKey)}`;
          data[candKey] = result;
        }

        chrome.storage.session.set(data).catch(() => {});
      } catch {}
    }
  }

  function saveSessionQa(url, category, history, candidate = null) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url) {
      try {
        const host = new URL(url).hostname;
        const key = `tos_qa_${host}_${category}`;
        const data = { [key]: history };

        // Also save under candidate-specific key (Phase 7G-D.7)
        const cand = candidate || (activeCandidate ? activeCandidate : documentState[category]?.candidate);
        if (cand?.url) {
          const cKey = getCandidateKey(cand);
          const candKey = `tos_qa_${host}_${encodeURIComponent(cKey)}`;
          data[candKey] = history;
          // Legacy URL key for backward compatibility
          const legacyUrlKey = `tos_qa_${host}_${encodeURIComponent(canonicalizeUrl(cand.url))}`;
          data[legacyUrlKey] = history;
        }

        chrome.storage.session.set(data).catch(() => {});
      } catch {}
    }
  }

  const QA_PENDING_TIMEOUT_MS = 60000; // 60 seconds

  function loadSessionQa(url) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url) {
      try {
        const host = new URL(url).hostname;
        const termsKey = `tos_qa_${host}_TERMS`;
        const privKey = `tos_qa_${host}_PRIVACY`;
        const otherPrivKey = `tos_qa_${host}_OTHER_PRIVACY`;
        const pendTermsKey = `tos_qa_pending_${host}_TERMS`;
        const pendPrivKey = `tos_qa_pending_${host}_PRIVACY`;
        const pendOtherPrivKey = `tos_qa_pending_${host}_OTHER_PRIVACY`;

        // Check document-specific keys if candidate is currently active
        const activeKey = activeCandidate ? `tos_qa_${host}_${encodeURIComponent(getCandidateKey(activeCandidate))}` : null;
        const candTerms = documentState.TERMS?.candidate;
        const candTermsKey = candTerms?.url ? `tos_qa_${host}_${encodeURIComponent(getCandidateKey(candTerms))}` : null;
        const candPriv = documentState.PRIVACY?.candidate;
        const candPrivKey = candPriv?.url ? `tos_qa_${host}_${encodeURIComponent(getCandidateKey(candPriv))}` : null;
        const candOtherPriv = documentState.OTHER_PRIVACY?.candidate;
        const candOtherPrivKey = candOtherPriv?.url ? `tos_qa_${host}_${encodeURIComponent(getCandidateKey(candOtherPriv))}` : null;

        const keysToFetch = [termsKey, privKey, otherPrivKey, pendTermsKey, pendPrivKey, pendOtherPrivKey];
        if (activeKey) keysToFetch.push(activeKey);
        if (candTermsKey) keysToFetch.push(candTermsKey);
        if (candPrivKey) keysToFetch.push(candPrivKey);
        if (candOtherPrivKey) keysToFetch.push(candOtherPrivKey);

        chrome.storage.session.get(
          keysToFetch,
          (res) => {
            if (activeCandidate) {
              const activeDoc = getOrCreateDocumentState(activeCandidate);
              if (activeKey && Array.isArray(res?.[activeKey])) {
                activeDoc.qaHistory = res[activeKey];
              }
            }

            if (candTermsKey && Array.isArray(res?.[candTermsKey])) {
              documentState.TERMS.qaHistory = res[candTermsKey];
            } else if (!activeCandidate && Array.isArray(res?.[termsKey])) {
              documentState.TERMS.qaHistory = res[termsKey];
            }

            if (candPrivKey && Array.isArray(res?.[candPrivKey])) {
              documentState.PRIVACY.qaHistory = res[candPrivKey];
            } else if (!activeCandidate && Array.isArray(res?.[privKey])) {
              documentState.PRIVACY.qaHistory = res[privKey];
            }

            if (candOtherPrivKey && Array.isArray(res?.[candOtherPrivKey])) {
              documentState.OTHER_PRIVACY.qaHistory = res[candOtherPrivKey];
            } else if (Array.isArray(res?.[otherPrivKey]) && !activeCandidate) {
              documentState.OTHER_PRIVACY.qaHistory = res[otherPrivKey];
            }

            // Inspect pending request for current category or active candidate
            const currentCat = getActiveDocumentCategory();
            const candPendKey = activeCandidate ? `tos_qa_pending_${host}_${encodeURIComponent(getCandidateKey(activeCandidate))}` : null;
            const currentPendKey = `tos_qa_pending_${host}_${currentCat}`;
            const pending = (candPendKey && res?.[candPendKey]) || res?.[currentPendKey];

            if (pending && typeof pending === "object") {
              const elapsed = Date.now() - Number(pending.timestamp || 0);
              const cKey = pending.candidateKey || null;
              if (elapsed > QA_PENDING_TIMEOUT_MS) {
                // Interrupted request: service worker was terminated or exceeded timeout
                clearPendingQa(url, currentCat);
                if (qaQuestionInputEl && pending.question) {
                  qaQuestionInputEl.value = pending.question;
                }
                isQaSubmitting = false;
                hideQaLoading();
                updateQaInputState();
                setQaError("The previous Q&A request was interrupted before completion. Your question has been restored—please submit again.");
              } else {
                // Pending request is still actively running in background
                isQaSubmitting = true;
                if (qaQuestionInputEl && pending.question) {
                  qaQuestionInputEl.value = pending.question;
                }
                updateQaInputState();
                showQaLoading("Analyzing document evidence with Gemini & verifying with DeBERTa NLI...");
              }
            }

            updateQaVisibility();
          }
        );
      } catch {}
    }
  }

  function loadSessionAnalysis(url) {
    if (typeof chrome !== "undefined" && chrome.storage?.session && url) {
      try {
        const host = new URL(url).hostname;
        const termsKey = `tos_scan_${host}_TERMS`;
        const privKey = `tos_scan_${host}_PRIVACY`;
        chrome.storage.session.get([termsKey, privKey], (res) => {
          if (res?.[termsKey]) {
            documentState.TERMS.scanResult = res[termsKey];
            documentState.TERMS.scanStatus = "COMPLETED";
            if (res[termsKey].isPartial) {
              documentState.TERMS.isPartial = true;
              documentState.TERMS.originalCharCount = res[termsKey].originalCharCount;
              documentState.TERMS.submittedCharCount = res[termsKey].submittedCharCount;
            }
          }
          if (res?.[privKey]) {
            documentState.PRIVACY.scanResult = res[privKey];
            documentState.PRIVACY.scanStatus = "COMPLETED";
            if (res[privKey].isPartial) {
              documentState.PRIVACY.isPartial = true;
              documentState.PRIVACY.originalCharCount = res[privKey].originalCharCount;
              documentState.PRIVACY.submittedCharCount = res[privKey].submittedCharCount;
            }
          }
          if (res?.[termsKey] || res?.[privKey]) {
            renderRiskDashboard();
          }
          loadSessionQa(url);
        });
      } catch {}
    }
  }

  // 11. Event Listeners
  btnCheckEl.addEventListener("click", performHealthCheck);
  btnDetectEl.addEventListener("click", performPolicyDetection);
  btnExtractEl.addEventListener("click", performTextExtraction);
  btnAnalyzeDocEl.addEventListener("click", () => performPolicyAnalysis(false));

  btnConsentProceedEl?.addEventListener("click", () => {
    oversizedConsentBoxEl?.classList.add("hidden");
    performPolicyAnalysis(true);
  });

  btnConsentCancelEl?.addEventListener("click", () => {
    oversizedConsentBoxEl?.classList.add("hidden");
    resetAnalyzeButton();
  });

  btnConfirmDocEl.addEventListener("click", () => {
    if (documentState[activePreviewTab]?.extracted?.ok) {
      documentState[activePreviewTab].confirmed = true;
      renderPreview();
    }
  });

  btnDiscardDocEl.addEventListener("click", () => {
    documentState[activePreviewTab].extracted = null;
    documentState[activePreviewTab].confirmed = false;
    documentState[activePreviewTab].scanResult = null;
    documentState[activePreviewTab].scanStatus = "IDLE";
    documentState[activePreviewTab].isPartial = false;
    documentState[activePreviewTab].submittedCharCount = 0;
    documentState[activePreviewTab].originalCharCount = 0;
    documentState[activePreviewTab].qaHistory = [];
    oversizedConsentBoxEl?.classList.add("hidden");
    renderPreview();
    renderRiskDashboard();
    updateQaVisibility();
  });

  tabTermsEl.addEventListener("click", () => {
    activePreviewTab = "TERMS";
    activeDashboardTab = "TERMS";
    activeCandidate = documentState.TERMS?.candidate || null;
    oversizedConsentBoxEl?.classList.add("hidden");
    renderPreview();
    updateQaVisibility();
  });

  tabPrivacyEl.addEventListener("click", () => {
    activePreviewTab = "PRIVACY";
    activeDashboardTab = "PRIVACY";
    activeCandidate = documentState.PRIVACY?.candidate || null;
    oversizedConsentBoxEl?.classList.add("hidden");
    renderPreview();
    updateQaVisibility();
  });

  dashTabTermsEl.addEventListener("click", () => {
    activeDashboardTab = "TERMS";
    activePreviewTab = "TERMS";
    activeCandidate = documentState.TERMS?.candidate || null;
    renderRiskDashboard();
    updateQaVisibility();
  });

  dashTabPrivacyEl.addEventListener("click", () => {
    activeDashboardTab = "PRIVACY";
    activePreviewTab = "PRIVACY";
    activeCandidate = documentState.PRIVACY?.candidate || null;
    renderRiskDashboard();
    updateQaVisibility();
  });

  // Wire Q&A Form and Example Chips
  qaQuestionInputEl?.addEventListener("input", updateQaInputState);
  qaQuestionInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!btnSubmitQaEl?.disabled) {
        performQaQuery();
      }
    }
  });

  qaFormEl?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!btnSubmitQaEl?.disabled) {
      performQaQuery();
    }
  });

  qaChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-question");
      if (q && qaQuestionInputEl) {
        qaQuestionInputEl.value = q;
        updateQaInputState();
        qaQuestionInputEl.focus();
      }
    });
  });

  if (linkWebAppEl && typeof chrome !== "undefined" && chrome.tabs?.create) {
    linkWebAppEl.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "http://localhost:3000" });
    });
  }

  // Listen for background session storage updates (e.g. background Q&A completion)
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "session" || !activeTabUrl) return;
      try {
        const host = new URL(activeTabUrl).hostname;
        const currentCat = getActiveDocumentCategory();
        const activeKey = activeCandidate ? getCandidateKey(activeCandidate) : null;
        const candHistoryKey = activeKey ? `tos_qa_${host}_${encodeURIComponent(activeKey)}` : null;
        const categoryHistoryKey = `tos_qa_${host}_${currentCat}`;
        const candPendingKey = activeKey ? `tos_qa_pending_${host}_${encodeURIComponent(activeKey)}` : null;
        const categoryPendingKey = `tos_qa_pending_${host}_${currentCat}`;

        // Also check if any other candidate's history changed, update documentRegistry in background
        Object.keys(changes).forEach((key) => {
          if (key.startsWith(`tos_qa_${host}_`)) {
            if (candHistoryKey && key === candHistoryKey) {
              const newHistory = changes[key].newValue;
              if (Array.isArray(newHistory)) {
                const activeDoc = getOrCreateDocumentState(activeCandidate);
                activeDoc.qaHistory = newHistory;
                if (isQaSubmitting) {
                  isQaSubmitting = false;
                  hideQaLoading();
                  if (qaQuestionInputEl) qaQuestionInputEl.value = "";
                  updateQaInputState();
                }
                renderQaHistory(currentCat);
              }
            } else if (!activeCandidate && key === categoryHistoryKey) {
              const newHistory = changes[key].newValue;
              if (Array.isArray(newHistory)) {
                documentState[currentCat].qaHistory = newHistory;
                if (isQaSubmitting) {
                  isQaSubmitting = false;
                  hideQaLoading();
                  if (qaQuestionInputEl) qaQuestionInputEl.value = "";
                  updateQaInputState();
                }
                renderQaHistory(currentCat);
              }
            }
          }
        });

        // Handle pending state removal
        const pendingRemoved = (candPendingKey && changes[candPendingKey] && !changes[candPendingKey].newValue) ||
                               (changes[categoryPendingKey] && !changes[categoryPendingKey].newValue);
        if (pendingRemoved && isQaSubmitting) {
          const historyUpdated = (candHistoryKey && changes[candHistoryKey]?.newValue) || changes[categoryHistoryKey]?.newValue;
          if (!historyUpdated) {
            isQaSubmitting = false;
            hideQaLoading();
            updateQaInputState();
          }
        }
      } catch {}
    });
  }

  // Run initial health check on open
  performHealthCheck();
  });
}
