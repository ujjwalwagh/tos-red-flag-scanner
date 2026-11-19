/**
 * TOS Red Flag Scanner — Background Service Worker (Manifest V3)
 *
 * Coordinates extension communication with the local Node.js Express backend
 * and orchestrates on-demand policy link detection via chrome.scripting.
 * Operates statelessly with zero browsing data retention.
 */

import {
  validateCandidateForExtraction,
  isExtractablePolicyUrl,
  isPdfUrl
} from "../utils/extractor-core.js";
import { canonicalizeUrl, isSafeHttpUrl } from "../utils/detector-rules.js";
import {
  DEFAULT_BACKEND_URL,
  getStoredBackendConfig,
  saveStoredBackendConfig,
  resetStoredBackendConfig,
  buildAuthHeaders,
  testBackendConnection,
  validateBackendUrl
} from "../utils/backend-config.js";

const BACKEND_BASE_URL = DEFAULT_BACKEND_URL;
const HEALTH_TIMEOUT_MS = 3500;
export const MAX_ANALYSIS_CHARACTERS = 100000;
export const MAX_SCAN_CHARS = MAX_ANALYSIS_CHARACTERS;

/**
 * Checks backend health by querying GET /health.
 * Reads dynamically from chrome.storage.local when baseUrl is omitted.
 *
 * @param {string} [baseUrl]
 * @param {string} [token]
 * @returns {Promise<{ ok: boolean, status: string, message: string, backendUrl?: string, timestamp?: string, error?: string }>}
 */
export async function checkBackendHealth(baseUrl = null, token = null) {
  let effectiveBaseUrl = baseUrl;
  let effectiveToken = token;
  if (!effectiveBaseUrl) {
    const cfg = await getStoredBackendConfig();
    effectiveBaseUrl = cfg.backendUrl || BACKEND_BASE_URL;
    if (effectiveToken === null) {
      effectiveToken = cfg.token;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const headers = buildAuthHeaders(effectiveToken, {
      Accept: "application/json"
    });

    const res = await fetch(`${effectiveBaseUrl}/health`, {
      method: "GET",
      headers,
      redirect: "error", // Prevent credential forwarding on redirects
      signal: controller.signal
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json().catch(() => ({ status: "ok" }));
      return {
        ok: true,
        status: "connected",
        message: "Backend Connected",
        backendUrl: effectiveBaseUrl,
        timestamp: data.timestamp || new Date().toISOString()
      };
    }

    if (res.status === 401) {
      return {
        ok: false,
        status: "auth_required",
        message: "Authentication Required — Configure your Bearer Token in Extension Options.",
        backendUrl: effectiveBaseUrl,
        error: "401 Unauthorized"
      };
    }

    if (res.status === 403) {
      return {
        ok: false,
        status: "cors_unconfigured",
        message: "CORS Unconfigured — Add extension origin to .env and restart backend.",
        backendUrl: effectiveBaseUrl,
        error: "403 Forbidden: Extension origin not authorized"
      };
    }

    return {
      ok: false,
      status: "disconnected",
      message: `Backend returned HTTP ${res.status}.`,
      backendUrl: effectiveBaseUrl,
      error: `HTTP ${res.status}`
    };
  } catch (err) {
    clearTimeout(timer);

    const isTimeout = err.name === "AbortError";
    const errorMessage = isTimeout
      ? "Connection timed out"
      : (err.message || "Network error");

    return {
      ok: false,
      status: "disconnected",
      message: "Backend Offline — Start the TOS Red Flag Scanner backend.",
      backendUrl: effectiveBaseUrl,
      error: errorMessage
    };
  }
}

/**
 * Validates whether a tab URL can be safely scanned.
 * Rejects chrome://, edge://, about:, and Chrome Web Store domains.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isScanSupportedUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "chromewebstore.google.com" ||
      host === "chrome.google.com" ||
      host === "microsoftedge.microsoft.com"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Injects detection content script and requests policy detection on the active tab.
 *
 * @param {number} [tabId]
 * @param {string} [tabUrl]
 * @returns {Promise<Object>}
 */
export async function detectPoliciesOnTab(tabId, tabUrl) {
  let targetTabId = tabId;
  let targetTabUrl = tabUrl;

  // Fallback: If tab info was not passed, resolve the active tab in current window
  if ((!targetTabId || !targetTabUrl) && typeof chrome !== "undefined" && chrome.tabs?.query) {
    try {
      const tabs = await new Promise((resolve) => {
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (res) => {
            resolve(res || []);
          });
        } catch {
          resolve([]);
        }
      });
      if (tabs && tabs[0]) {
        targetTabId = targetTabId || tabs[0].id;
        targetTabUrl = targetTabUrl || tabs[0].url;
      }
    } catch {
      // ignore query errors
    }
  }

  if (!targetTabId || typeof targetTabId !== "number") {
    return { ok: false, error: "Valid tab ID is required for policy detection." };
  }

  if (targetTabUrl && !isScanSupportedUrl(targetTabUrl)) {
    return {
      ok: false,
      error: "Cannot scan internal or restricted browser pages (e.g. chrome://, Chrome Web Store). Please navigate to a standard public website."
    };
  }

  if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
    return {
      ok: false,
      error: "Chrome scripting API is not available in current environment."
    };
  }

  try {
    // 1. Programmatically inject content script on-demand and capture direct return value
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ["content/content-script.js"]
    });

    // Content script returns scanDomForPolicies() directly from its top-level IIFE
    if (injectionResults && injectionResults[0] && injectionResults[0].result && injectionResults[0].result.ok) {
      return injectionResults[0].result;
    }

    // 2. Fallback: Query detection results via tabs.sendMessage if direct return was empty
    const results = await new Promise((resolve) => {
      chrome.tabs.sendMessage(
        targetTabId,
        { type: "RUN_DETECTION", action: "RUN_DETECTION" },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || "Failed to communicate with page content script."
            });
          } else {
            resolve(response || { ok: false, error: "No response from detection script." });
          }
        }
      );
    });

    return results;
  } catch (err) {
    return {
      ok: false,
      error: err.message || "Failed to inject detection content script."
    };
  }
}

/**
 * Extracts policy text from a user-selected candidate document.
 * If candidate matches active tab, extracts in-place.
 * Otherwise creates an isolated temporary tab, waits for load, injects dom-extractor,
 * and safely closes the tab in a finally block.
 *
 * @param {Object} candidate - Selected candidate document metadata
 * @param {number} [activeTabId] - Currently active tab ID
 * @param {string} [activeTabUrl] - Currently active tab URL
 * @returns {Promise<Object>}
 */
export async function extractPolicyDocument(candidate, activeTabId, activeTabUrl) {
  // 1. Validate candidate selection
  const validation = validateCandidateForExtraction(candidate);
  if (!validation.valid) {
    return {
      ok: false,
      status: validation.status || "VALIDATION_FAILED",
      error: validation.error || "Selected document candidate is invalid.",
      isPdf: Boolean(validation.isPdf)
    };
  }

  // 2. Resolve active tab if not provided
  let currentTabId = activeTabId;
  let currentTabUrl = activeTabUrl;
  if ((!currentTabId || !currentTabUrl) && typeof chrome !== "undefined" && chrome.tabs?.query) {
    try {
      const tabs = await new Promise((resolve) => {
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (res) => resolve(res || []));
        } catch {
          resolve([]);
        }
      });
      if (tabs && tabs[0]) {
        currentTabId = currentTabId || tabs[0].id;
        currentTabUrl = currentTabUrl || tabs[0].url;
      }
    } catch {
      // ignore query errors
    }
  }

  // 3. Check if extraction can be performed in-place on current page
  const isCurrentPage = currentTabUrl && canonicalizeUrl(candidate.url) === canonicalizeUrl(currentTabUrl);

  if (isCurrentPage && currentTabId) {
    try {
      if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
        return { ok: false, error: "Chrome scripting API is not available." };
      }
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ["content/dom-extractor.js"]
      });

      const res = injectionResults?.[0]?.result;
      if (res) {
        res.category = candidate.category;
        res.categoryLabel = candidate.categoryLabel;
        res.sourceUrl = candidate.url;
        return res;
      }
      return { ok: false, error: "No response from DOM extractor on active page." };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to extract content from active page." };
    }
  }

  // 4. Cross-Origin / Isolated Tab Extraction
  // Verify host permissions if chrome.permissions API is available
  if (typeof chrome !== "undefined" && chrome.permissions?.contains) {
    try {
      const originPattern = new URL(candidate.url).origin + "/*";
      const hasPerm = await chrome.permissions.contains({ origins: [originPattern] });
      if (!hasPerm) {
        return {
          ok: false,
          status: "PERMISSION_DENIED",
          error: `Permission to access ${new URL(candidate.url).hostname} was not granted.`
        };
      }
    } catch {
      // ignore check error
    }
  }

  if (typeof chrome === "undefined" || !chrome.tabs?.create || !chrome.scripting?.executeScript) {
    return {
      ok: false,
      error: "Browser tabs and scripting APIs are not available in current environment."
    };
  }

  let tempTabId = null;
  try {
    // Create an isolated background tab
    const tempTab = await chrome.tabs.create({
      url: candidate.url,
      active: false
    });
    tempTabId = tempTab.id;

    // Wait for tab load completion with timeout
    await new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated?.removeListener) {
          try { chrome.tabs.onUpdated.removeListener(tabListener); } catch {}
        }
        reject(new Error("Document page loading timed out after 15 seconds."));
      }, 15000);

      function tabListener(updatedTabId, changeInfo, tab) {
        if (updatedTabId === tempTabId && changeInfo.status === "complete") {
          clearTimeout(timeoutTimer);
          if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated?.removeListener) {
            try { chrome.tabs.onUpdated.removeListener(tabListener); } catch {}
          }

          // Validate redirected URL if any
          if (tab.url && !isSafeHttpUrl(tab.url)) {
            reject(new Error("Document redirected to an unsafe or prohibited protocol."));
          } else {
            resolve(tab);
          }
        }
      }

      if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated?.addListener) {
        chrome.tabs.onUpdated.addListener(tabListener);
      } else {
        clearTimeout(timeoutTimer);
        resolve(tempTab);
      }
    });

    // Inject DOM extractor into isolated tab
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tempTabId },
      files: ["content/dom-extractor.js"]
    });

    const result = injectionResults?.[0]?.result;
    if (result) {
      result.category = candidate.category;
      result.categoryLabel = candidate.categoryLabel;
      result.sourceUrl = candidate.url;
      return result;
    }

    return { ok: false, error: "No response from DOM extractor script." };
  } catch (err) {
    return {
      ok: false,
      error: err.message || "Failed to extract policy text from target page."
    };
  } finally {
    // ALWAYS remove the temporary tab to ensure zero dangling tabs
    if (tempTabId && typeof chrome !== "undefined" && chrome.tabs?.remove) {
      try {
        await chrome.tabs.remove(tempTabId);
      } catch {
        // Tab may have already been closed
      }
    }
  }
}

/**
 * Submits confirmed legal document text to POST /api/scan on the local Node.js backend.
 * Reuses the existing backend analysis pipeline and deterministic risk engine.
 *
 * @param {Object} payload
 * @param {Object} payload.candidate - Selected candidate document metadata
 * @param {string} payload.extractedText - Substantive extracted legal document text
 * @param {boolean} payload.confirmed - Explicit user confirmation flag
 * @param {string} [payload.documentType] - Document category (TERMS, PRIVACY)
 * @param {string} [baseUrl] - Backend base URL
 * @returns {Promise<Object>}
 */
export async function analyzeConfirmedPolicy(payload, baseUrl = null, token = null) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid analysis request payload." };
  }

  let effectiveBaseUrl = baseUrl;
  let effectiveToken = token;
  if (!effectiveBaseUrl) {
    const cfg = await getStoredBackendConfig();
    effectiveBaseUrl = cfg.backendUrl || BACKEND_BASE_URL;
    if (effectiveToken === null) {
      effectiveToken = cfg.token;
    }
  }

  const { candidate, extractedText, confirmed, documentType, allowPartial } = payload;

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, error: "No document candidate selected." };
  }

  if (!confirmed) {
    return { ok: false, error: "Document must be explicitly confirmed before analysis." };
  }

  if (!extractedText || typeof extractedText !== "string" || !extractedText.trim()) {
    return { ok: false, error: "Extracted policy text is empty." };
  }

  const text = extractedText.trim();
  if (text.length < 500) {
    return {
      ok: false,
      error: "Extracted content is too short to analyze (minimum 500 characters required by backend)."
    };
  }

  const cat = String(documentType || candidate.category || "TERMS").trim().toUpperCase();
  if (cat !== "TERMS" && cat !== "PRIVACY" && cat !== "OTHER_PRIVACY") {
    return { ok: false, error: `Unsupported document category '${cat}'.` };
  }

  const originalCharCount = text.length;
  const isOversized = originalCharCount > MAX_ANALYSIS_CHARACTERS;

  // Prevent silent truncation: if document exceeds 100k chars, require explicit user consent
  if (isOversized && allowPartial !== true) {
    return {
      ok: false,
      status: "OVERSIZED_DOCUMENT_REQUIRES_CONSENT",
      requiresConsent: true,
      originalCharCount,
      maxChars: MAX_ANALYSIS_CHARACTERS,
      error: `Document length (${originalCharCount.toLocaleString()} characters) exceeds the backend scanning limit of ${MAX_ANALYSIS_CHARACTERS.toLocaleString()} characters. Submitting would omit later clauses. Explicit user consent is required for partial analysis.`
    };
  }

  const policyTextToSend = isOversized ? text.slice(0, MAX_ANALYSIS_CHARACTERS) : text;

  const controller = new AbortController();
  const timeoutMs = 45000; // 45s analysis timeout
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = buildAuthHeaders(effectiveToken, {
      "Content-Type": "application/json",
      Accept: "application/json"
    });

    const res = await fetch(`${effectiveBaseUrl}/api/scan`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        policyText: policyTextToSend,
        scanMode: "broad"
      }),
      redirect: "error", // Prevent credential forwarding on redirects
      signal: controller.signal
    });

    clearTimeout(timer);

    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        error: "Authentication required or Bearer Token invalid (HTTP 401). Please check credentials in Extension Options."
      };
    }

    if (res.status === 413) {
      return {
        ok: false,
        status: 413,
        error: "Policy document exceeds backend payload limit (HTTP 413 Payload Too Large)."
      };
    }

    if (res.status === 429) {
      return {
        ok: false,
        status: 429,
        error: "Backend rate limit exceeded (HTTP 429). Please wait a moment before retrying."
      };
    }

    if (!res.ok) {
      let errorDetail = `Backend returned HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error) {
          errorDetail = errJson.error;
        }
      } catch {}
      return {
        ok: false,
        status: res.status,
        error: errorDetail
      };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      return {
        ok: false,
        error: "Invalid JSON response received from backend analysis service."
      };
    }

    return {
      ok: true,
      documentType: cat,
      candidateUrl: candidate.url,
      candidateTitle: candidate.title,
      isPartial: isOversized,
      submittedCharCount: policyTextToSend.length,
      originalCharCount,
      result: data
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      error: isTimeout
        ? "Analysis request timed out after 45 seconds."
        : (err.message || "Failed to reach backend analysis service.")
    };
  }
}

/**
 * Session storage helpers for preserving Q&A state across popup close/reopen (Phase 7G-D.1).
 * Uses chrome.storage.session (in-memory, zero permanent retention).
 */
export async function saveSessionQaTurn(url, category, turn, candidateKey = null) {
  if (typeof chrome === "undefined" || !chrome.storage?.session || !url || !turn) return false;
  try {
    const host = new URL(url).hostname;
    const cat = category || "TERMS";
    const key = `tos_qa_${host}_${cat}`;
    const pendingKey = `tos_qa_pending_${host}_${cat}`;

    const effectiveCandKey = candidateKey || turn.candidateKey || null;
    let candStorageKey = null;
    let legacyUrlKey = null;
    const keysToGet = [key];

    if (effectiveCandKey) {
      candStorageKey = `tos_qa_${host}_${encodeURIComponent(effectiveCandKey)}`;
      keysToGet.push(candStorageKey);
    }
    if (turn.candidateUrl) {
      const cleanCandUrl = canonicalizeUrl(turn.candidateUrl);
      legacyUrlKey = `tos_qa_${host}_${encodeURIComponent(cleanCandUrl)}`;
      if (legacyUrlKey !== candStorageKey) {
        keysToGet.push(legacyUrlKey);
      }
    }

    const res = await new Promise((resolve) => {
      chrome.storage.session.get(keysToGet, (val) => resolve(val || {}));
    });

    const turnId = turn.id || turn.requestId;
    const updates = {};

    // 1. Update candidate-specific key
    if (candStorageKey) {
      const cList = Array.isArray(res?.[candStorageKey]) ? res[candStorageKey] : [];
      const cIdx = cList.findIndex((t) => turnId && (t.id === turnId || t.requestId === turnId));
      if (cIdx >= 0) cList[cIdx] = turn;
      else cList.push(turn);
      updates[candStorageKey] = cList;
    }

    // 2. Update legacy canonical URL key
    if (legacyUrlKey && legacyUrlKey !== candStorageKey) {
      const lList = Array.isArray(res?.[legacyUrlKey]) ? res[legacyUrlKey] : [];
      const lIdx = lList.findIndex((t) => turnId && (t.id === turnId || t.requestId === turnId));
      if (lIdx >= 0) lList[lIdx] = turn;
      else lList.push(turn);
      updates[legacyUrlKey] = lList;
    }

    // 3. Update category key (for backward compatibility)
    const list = Array.isArray(res?.[key]) ? res[key] : [];
    const existingIdx = list.findIndex((t) => turnId && (t.id === turnId || t.requestId === turnId));
    if (existingIdx >= 0) {
      list[existingIdx] = turn;
    } else {
      list.push(turn);
    }
    updates[key] = list;

    await new Promise((resolve) => {
      chrome.storage.session.set(updates, () => resolve());
    });

    await new Promise((resolve) => {
      chrome.storage.session.remove([pendingKey], () => resolve());
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearSessionPendingQa(url, category) {
  if (typeof chrome === "undefined" || !chrome.storage?.session || !url) return false;
  try {
    const host = new URL(url).hostname;
    const cat = category || "TERMS";
    const pendingKey = `tos_qa_pending_${host}_${cat}`;
    await new Promise((resolve) => {
      chrome.storage.session.remove([pendingKey], () => resolve());
    });
    return true;
  } catch {
    return false;
  }
}

export async function recordSessionPendingQa(url, category, pendingInfo) {
  if (typeof chrome === "undefined" || !chrome.storage?.session || !url || !pendingInfo) return false;
  try {
    const host = new URL(url).hostname;
    const cat = category || "TERMS";
    const pendingKey = `tos_qa_pending_${host}_${cat}`;
    await new Promise((resolve) => {
      chrome.storage.session.set({ [pendingKey]: pendingInfo }, () => resolve());
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Submits a user question grounded in policy clauses or text to POST /api/analyze/qa.
 *
 * @param {Object} payload
 * @param {string} payload.question
 * @param {Array<Object>} [payload.clauses]
 * @param {string} [payload.policyText]
 * @param {boolean} [payload.isPartial]
 * @param {boolean} [payload.allowPartial]
 * @param {string} [payload.documentType]
 * @param {string} [payload.requestId]
 * @param {string} [payload.activeTabUrl]
 * @param {string} [payload.tabUrl]
 * @param {string} [payload.url]
 * @param {string} [baseUrl]
 * @returns {Promise<Object>}
 */
export async function queryPolicyDocument(payload, baseUrl = null, token = null) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid Q&A request payload." };
  }

  let effectiveBaseUrl = baseUrl;
  let effectiveToken = token;
  if (!effectiveBaseUrl) {
    const cfg = await getStoredBackendConfig();
    effectiveBaseUrl = cfg.backendUrl || BACKEND_BASE_URL;
    if (effectiveToken === null) {
      effectiveToken = cfg.token;
    }
  }

  const { question, clauses, policyText, isPartial, allowPartial, documentType } = payload;
  const docUrl = payload.activeTabUrl || payload.tabUrl || payload.url;
  const cat = documentType || "TERMS";
  const requestId = payload.requestId || `qa_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Capture candidate identity at request start to prevent asynchronous response cross-contamination (RC-3)
  const candidateUrl = payload.candidateUrl || null;
  const candidateKey = payload.candidateKey || (candidateUrl ? `${canonicalizeUrl(candidateUrl)}::${cat}` : null);
  const candidateTitle = payload.candidateTitle || null;
  const documentLabel = payload.documentLabel || candidateTitle || (cat === "PRIVACY" ? "Privacy Policy" : (cat === "OTHER_PRIVACY" ? "Cookie / Privacy Notice" : "Terms of Service"));

  if (typeof question !== "string" || !question.trim()) {
    return { ok: false, error: "A valid question is required." };
  }

  const q = question.trim();
  if (q.length < 3) {
    return { ok: false, error: "Question must be at least 3 characters long." };
  }
  if (q.length > 500) {
    return { ok: false, error: "Question must not exceed 500 characters." };
  }

  let requestBody = { question: q, documentType: cat, documentLabel };
  let partialFlag = Boolean(isPartial);

  if (Array.isArray(clauses) && clauses.length > 0) {
    if (clauses.length > 1000) {
      return {
        ok: false,
        error: "Document clause count exceeds the maximum limit of 1,000 clauses for Q&A analysis."
      };
    }
    requestBody.clauses = clauses.slice(0, 1000).map((c, idx) => ({
      clauseId: String(c.clauseId || c.clause_id || `clause_${idx}`),
      text: typeof c === "string" ? c.trim() : String(c.text || c.rawText || "").trim(),
      section: String(c.section || c.title || "")
    })).filter((c) => c.text.length > 0);
  } else if (typeof policyText === "string" && policyText.trim()) {
    const rawText = policyText.trim();
    if (rawText.length > MAX_ANALYSIS_CHARACTERS) {
      if (!allowPartial && !isPartial) {
        return {
          ok: false,
          status: "OVERSIZED_DOCUMENT_REQUIRES_CONSENT",
          requiresConsent: true,
          originalCharCount: rawText.length,
          maxChars: MAX_ANALYSIS_CHARACTERS,
          error: "Document exceeds 100,000 characters. Explicit consent required for partial analysis."
        };
      }
      requestBody.policyText = rawText.slice(0, MAX_ANALYSIS_CHARACTERS);
      partialFlag = true;
    } else {
      requestBody.policyText = rawText;
    }
  } else {
    return {
      ok: false,
      error: "No document context provided for Q&A. Please extract or scan a document first."
    };
  }

  // Persist pending request state in background session storage
  if (docUrl) {
    await recordSessionPendingQa(docUrl, cat, {
      requestId,
      question: q,
      isPartial: partialFlag,
      timestamp: Date.now()
    });
  }

  const controller = new AbortController();
  const timeoutMs = 45000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = buildAuthHeaders(effectiveToken, {
      "Content-Type": "application/json",
      Accept: "application/json"
    });

    const res = await fetch(`${effectiveBaseUrl}/api/analyze/qa`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      redirect: "error", // Prevent credential forwarding on redirects
      signal: controller.signal
    });

    clearTimeout(timer);

    if (res.status === 401) {
      if (docUrl) await clearSessionPendingQa(docUrl, cat);
      return {
        ok: false,
        status: 401,
        error: "Authentication required or Bearer Token invalid (HTTP 401). Please check credentials in Extension Options."
      };
    }

    if (res.status === 429) {
      if (docUrl) await clearSessionPendingQa(docUrl, cat);
      return {
        ok: false,
        status: 429,
        error: "Backend rate limit exceeded (HTTP 429). Please wait a moment before trying again."
      };
    }

    if (!res.ok) {
      if (docUrl) await clearSessionPendingQa(docUrl, cat);
      let errorDetail = `Backend returned HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error) errorDetail = errJson.error;
      } catch {}
      return {
        ok: false,
        status: res.status,
        error: errorDetail
      };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      if (docUrl) await clearSessionPendingQa(docUrl, cat);
      return {
        ok: false,
        error: "Invalid JSON response received from backend Q&A service."
      };
    }

    if (!data?.success || !data?.qa) {
      if (docUrl) await clearSessionPendingQa(docUrl, cat);
      return {
        ok: false,
        error: data?.error || "Q&A service returned an unexpected response structure."
      };
    }

    const completedTurn = {
      id: requestId,
      requestId,
      question: q,
      qa: data.qa,
      isPartial: partialFlag,
      timestamp: Date.now(),
      candidateUrl,
      candidateKey,
      candidateTitle,
      documentLabel
    };

    // Save completed turn directly into chrome.storage.session using original request candidate identity
    if (docUrl) {
      await saveSessionQaTurn(docUrl, cat, completedTurn, candidateKey);
    }

    return {
      ok: true,
      documentType: cat,
      documentLabel,
      candidateUrl,
      candidateKey,
      candidateTitle,
      qa: data.qa,
      isPartial: partialFlag,
      requestId,
      turn: completedTurn
    };
  } catch (err) {
    clearTimeout(timer);
    if (docUrl) await clearSessionPendingQa(docUrl, cat);
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      error: isTimeout
        ? "Q&A request timed out after 45 seconds."
        : (err.message || "Failed to reach backend Q&A service.")
    };
  }
}

export const askPolicyQuestion = queryPolicyDocument;

/**
 * Set of privileged message actions that alter state, execute scripts,
 * or perform remote AI / Q&A operations. Restricted exclusively to internal popup context.
 */
export const PRIVILEGED_MESSAGE_ACTIONS = new Set([
  "ANALYZE_CONFIRMED_POLICY",
  "ANALYZE_POLICY",
  "SCAN_CONFIRMED_POLICY",
  "ASK_POLICY_QUESTION",
  "ASK_QUESTION",
  "QUERY_POLICY_DOCUMENT",
  "QUERY_DOCUMENT",
  "QA_DOCUMENT",
  "EXTRACT_POLICY",
  "EXTRACT_POLICY_DOCUMENT",
  "EXTRACT_TEXT",
  "DETECT_POLICIES",
  "DETECT_POLICY_LINKS",
  "FIND_LEGAL_DOCUMENTS",
  "RUN_DETECTION",
  "CHECK_HEALTH",
  "HEALTH_CHECK",
  "PING",
  "GET_BACKEND_CONFIG",
  "GET_CONFIG",
  "SAVE_BACKEND_CONFIG",
  "SAVE_CONFIG",
  "RESET_BACKEND_CONFIG",
  "RESET_CONFIG",
  "TEST_CONNECTION",
  "TEST_BACKEND_CONNECTION"
]);

/**
 * Validates whether a message sender is an authorized extension context.
 *
 * Enforces strict boundary checks (Finding SEC-EXT-1):
 * 1. Extension Identity: sender.id must match the running extension ID.
 * 2. Origin & URL Security: internal messages must originate from chrome-extension://${id}.
 * 3. Context Isolation: privileged operations cannot be invoked from web pages, tabs, or content scripts.
 *
 * @param {Object} sender - Chrome MessageSender object
 * @param {Object} [message] - Message payload to inspect action privilege
 * @param {string} [expectedExtensionId] - Optional explicit extension ID for testing
 * @returns {{ valid: boolean, status?: string, error?: string }}
 */
export function validateMessageSender(sender, message = null, expectedExtensionId = null) {
  if (!sender || typeof sender !== "object") {
    return {
      valid: false,
      status: "forbidden",
      error: "Message sender is missing or invalid."
    };
  }

  // 1. Resolve expected extension ID
  const resolvedExpectedId = expectedExtensionId ||
    (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome.runtime.id : null) ||
    sender.id;

  if (resolvedExpectedId && sender.id !== resolvedExpectedId) {
    return {
      valid: false,
      status: "forbidden",
      error: `Unauthorized message sender: extension ID '${sender.id || "unknown"}' does not match expected '${resolvedExpectedId}'.`
    };
  }

  // 2. Validate sender origin and URL
  const expectedPrefix = resolvedExpectedId ? `chrome-extension://${resolvedExpectedId}` : "chrome-extension://";
  const senderUrl = typeof sender.url === "string" ? sender.url.trim() : "";
  const senderOrigin = typeof sender.origin === "string" ? sender.origin.trim() : "";

  const isInternalOrigin = senderOrigin ? senderOrigin.startsWith(expectedPrefix) : false;
  const isInternalUrl = senderUrl ? senderUrl.startsWith(expectedPrefix) : false;
  const isFromTab = Boolean(sender.tab && typeof sender.tab === "object");

  // An internal context is an extension page (popup, options, background).
  // When an options page opens in a tab (open_in_tab: true), sender.tab is populated,
  // but sender.url and/or sender.tab.url starts with chrome-extension://${resolvedExpectedId}.
  const isExtensionPageTab = isFromTab && ((typeof sender.tab?.url === "string" && sender.tab.url.startsWith(expectedPrefix)) || isInternalUrl);
  const isInternalContext = (isInternalOrigin || isInternalUrl) && (!isFromTab || isExtensionPageTab);

  // 3. Inspect requested action privilege
  const rawType = message?.type || message?.action || message?.command || "";
  const msgType = String(rawType).trim().toUpperCase();

  if (PRIVILEGED_MESSAGE_ACTIONS.has(msgType)) {
    if (!isInternalContext) {
      return {
        valid: false,
        status: "forbidden",
        error: `Unauthorized message context: '${msgType}' is restricted to internal extension popup and options contexts and cannot be called from tabs or external origins.`
      };
    }
  }

  // 4. Reject messages from untrusted external origins
  if (!isInternalContext && (!isInternalOrigin && !isInternalUrl)) {
    return {
      valid: false,
      status: "forbidden",
      error: `Unauthorized message sender: untrusted origin '${senderOrigin || senderUrl || "unknown"}'.`
    };
  }

  return { valid: true };
}

/**
 * Dispatches runtime messages received from the extension popup or content scripts.
 *
 * @param {Object} message
 * @param {Object} [sender=null] - Optional Chrome MessageSender for security validation
 * @returns {Promise<Object>}
 */
export async function handleRuntimeMessage(message, sender = null) {
  if (sender !== null && sender !== undefined) {
    const senderValidation = validateMessageSender(sender, message);
    if (!senderValidation.valid) {
      return {
        ok: false,
        status: senderValidation.status || "forbidden",
        error: senderValidation.error || "Unauthorized message sender"
      };
    }
  }

  if (!message || typeof message !== "object") {
    return { ok: false, error: "Invalid message payload" };
  }

  const rawType = message.type || message.action || message.command || "";
  const msgType = String(rawType).trim().toUpperCase();

  switch (msgType) {
    case "CHECK_HEALTH":
    case "HEALTH_CHECK":
    case "PING":
      return await checkBackendHealth();

    case "DETECT_POLICIES":
    case "DETECT_POLICY_LINKS":
    case "FIND_LEGAL_DOCUMENTS":
    case "RUN_DETECTION":
      return await detectPoliciesOnTab(message.tabId, message.tabUrl);

    case "EXTRACT_POLICY":
    case "EXTRACT_POLICY_DOCUMENT":
    case "EXTRACT_TEXT":
      return await extractPolicyDocument(
        message.candidate,
        message.activeTabId || message.tabId,
        message.activeTabUrl || message.tabUrl
      );

    case "ANALYZE_CONFIRMED_POLICY":
    case "ANALYZE_POLICY":
    case "SCAN_CONFIRMED_POLICY":
      return await analyzeConfirmedPolicy(message.payload || message);

    case "ASK_POLICY_QUESTION":
    case "ASK_QUESTION":
    case "QUERY_POLICY_DOCUMENT":
    case "QUERY_DOCUMENT":
    case "QA_DOCUMENT":
      return await queryPolicyDocument(message.payload || message);

    case "GET_BACKEND_CONFIG":
    case "GET_CONFIG": {
      const cfg = await getStoredBackendConfig();
      return {
        ok: true,
        backendUrl: cfg.backendUrl,
        hasToken: Boolean(cfg.token),
        isDefault: cfg.isDefault,
        token: cfg.token
      };
    }

    case "SAVE_BACKEND_CONFIG":
    case "SAVE_CONFIG":
      return await saveStoredBackendConfig(message.payload || message);

    case "RESET_BACKEND_CONFIG":
    case "RESET_CONFIG":
      return await resetStoredBackendConfig();

    case "TEST_CONNECTION":
    case "TEST_BACKEND_CONNECTION":
      return await testBackendConnection(message.payload || message);

    case "GET_INFO":
    case "INFO": {
      const cfg = await getStoredBackendConfig();
      return {
        ok: true,
        version: "1.0.0",
        backendUrl: cfg.backendUrl || BACKEND_BASE_URL
      };
    }

    default:
      return { ok: false, error: `Unknown message type: ${message.type || message.action || rawType}` };
  }
}

// Register message listener in Chrome extension runtime environment
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const validation = validateMessageSender(sender, message);
    if (!validation.valid) {
      sendResponse({
        ok: false,
        status: validation.status || "forbidden",
        error: validation.error || "Unauthorized message sender"
      });
      return false;
    }

    handleRuntimeMessage(message, sender).then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        status: "error",
        error: err.message || "Unexpected service worker error"
      });
    });
    // Return true to indicate asynchronous sendResponse handling
    return true;
  });
}
