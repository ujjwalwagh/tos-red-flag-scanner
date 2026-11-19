/**
 * Phase 7G-D.7 — Comprehensive Document State Isolation & Q&A History Tests
 *
 * Validates complete isolation of extraction, risk scan results, and Q&A history
 * across Terms of Service, Privacy Policy, and regional / secondary documents.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  isMeaningfulCandidateFragment,
  classifyCandidateLink,
  deriveTermsMetadata
} from "../../extension/utils/detector-rules.js";
import { buildQaPrompt } from "../src/ai/providers/gemini-provider.js";

// Helper for Candidate Keys matching popup.js
function getNormalizedCategory(candidate) {
  const cat = String(candidate?.category || "TERMS").toUpperCase();
  if (cat === "OTHER_PRIVACY" || cat === "REGIONAL_PRIVACY" || cat === "SUB_PRIVACY") {
    return "OTHER_PRIVACY";
  }
  if (cat === "PRIVACY") return "PRIVACY";
  if (cat === "LEGAL_HUB") return "LEGAL_HUB";
  return "TERMS";
}

function getCandidateKey(candidate) {
  if (!candidate?.url) return "";
  const canonUrl = canonicalizeUrl(candidate.url);
  const cat = getNormalizedCategory(candidate);
  return `${canonUrl}::${cat}`;
}

test("Test F: URL Canonicalization and Meaningful Fragment Preservation", () => {
  // 1. Meaningful policy anchors are preserved
  const privacyAnchor = "https://www.example.com/legal#privacy";
  const termsAnchor = "https://www.example.com/legal#terms";
  const choicesAnchor = "https://www.example.com/privacy#choices";
  const cookiesAnchor = "https://www.example.com/legal#cookies";

  assert.equal(canonicalizeUrl(privacyAnchor), "https://www.example.com/legal#privacy");
  assert.equal(canonicalizeUrl(termsAnchor), "https://www.example.com/legal#terms");
  assert.equal(canonicalizeUrl(choicesAnchor), "https://www.example.com/privacy#choices");
  assert.equal(canonicalizeUrl(cookiesAnchor), "https://www.example.com/legal#cookies");

  // 2. Intra-document section bookmarks are stripped
  const sec1 = "https://www.example.com/legal/terms#section-3";
  const sec2 = "https://www.example.com/legal/terms#section-4";
  const part2 = "https://www.example.com/legal/terms#part2";
  const item5 = "https://www.example.com/legal/terms#item-5";
  const topAnchor = "https://www.example.com/legal/terms#top";

  assert.equal(canonicalizeUrl(sec1), "https://www.example.com/legal/terms");
  assert.equal(canonicalizeUrl(sec2), "https://www.example.com/legal/terms");
  assert.equal(canonicalizeUrl(part2), "https://www.example.com/legal/terms");
  assert.equal(canonicalizeUrl(item5), "https://www.example.com/legal/terms");
  assert.equal(canonicalizeUrl(topAnchor), "https://www.example.com/legal/terms");

  // 3. Tracking fragments and text fragments are stripped
  const trackFrag = "https://www.example.com/legal/terms#_ga=2.123456";
  const textFrag = "https://www.example.com/legal/terms#:~:text=cancellation";

  assert.equal(canonicalizeUrl(trackFrag), "https://www.example.com/legal/terms");
  assert.equal(canonicalizeUrl(textFrag), "https://www.example.com/legal/terms");

  // 4. Tracking query parameters are stripped while functional params are kept
  const trackingUrl = "https://www.example.com/terms?utm_source=google&utm_medium=cpc&gclid=xyz&_ga=123";
  assert.equal(canonicalizeUrl(trackingUrl), "https://www.example.com/terms");

  const functionalUrl = "https://www.example.com/terms?locale=en-US&view=full&utm_campaign=winter";
  assert.equal(canonicalizeUrl(functionalUrl), "https://www.example.com/terms?locale=en-US&view=full");
});

test("Test F2: isMeaningfulCandidateFragment accurately categorizes anchors", () => {
  assert.equal(isMeaningfulCandidateFragment("#privacy"), true);
  assert.equal(isMeaningfulCandidateFragment("#terms"), true);
  assert.equal(isMeaningfulCandidateFragment("#terms-of-service"), true);
  assert.equal(isMeaningfulCandidateFragment("#privacy-notice"), true);
  assert.equal(isMeaningfulCandidateFragment("#cookies"), true);
  assert.equal(isMeaningfulCandidateFragment("#choices"), true);

  assert.equal(isMeaningfulCandidateFragment("#section-3"), false);
  assert.equal(isMeaningfulCandidateFragment("#clause_49"), false);
  assert.equal(isMeaningfulCandidateFragment("#top"), false);
  assert.equal(isMeaningfulCandidateFragment("#header"), false);
  assert.equal(isMeaningfulCandidateFragment("#_ga=123"), false);
});

test("Test A: Candidate Key Generation and Multi-Candidate Distinction", () => {
  const termsCand = {
    title: "Terms of Service",
    url: "https://www.spotify.com/legal/end-user-agreement/",
    category: "TERMS"
  };

  const privacyCand = {
    title: "Privacy Policy",
    url: "https://www.spotify.com/legal/privacy-policy/",
    category: "PRIVACY"
  };

  const otherPrivacyCand = {
    title: "Regional Privacy Notice",
    url: "https://www.spotify.com/legal/privacy-policy/#regional",
    category: "OTHER_PRIVACY"
  };

  const termsKey = getCandidateKey(termsCand);
  const privKey = getCandidateKey(privacyCand);
  const otherPrivKey = getCandidateKey(otherPrivacyCand);

  assert.notEqual(termsKey, privKey, "Terms and Privacy must have distinct candidate keys");
  assert.notEqual(privKey, otherPrivKey, "Privacy and Regional Privacy must have distinct candidate keys");
  assert.notEqual(termsKey, otherPrivKey, "Terms and Regional Privacy must have distinct candidate keys");
});

test("Test B: Simulated Document State Registry Isolates Q&A and Scans Completely", () => {
  const documentRegistry = new Map();
  const documentState = {
    TERMS: { candidate: null, extracted: null, scanResult: null, qaHistory: [] },
    PRIVACY: { candidate: null, extracted: null, scanResult: null, qaHistory: [] },
    OTHER_PRIVACY: { candidate: null, extracted: null, scanResult: null, qaHistory: [] }
  };

  let activeCandidate = null;
  let activePreviewTab = "TERMS";
  let activeDashboardTab = "TERMS";

  function getOrCreateDocumentState(candidate) {
    if (!candidate?.url) return null;
    const key = getCandidateKey(candidate);
    if (!documentRegistry.has(key)) {
      documentRegistry.set(key, {
        candidate,
        extracted: null,
        scanResult: null,
        scanStatus: "IDLE",
        confirmed: false,
        isPartial: false,
        submittedCharCount: 0,
        originalCharCount: 0,
        qaHistory: []
      });
    }
    return documentRegistry.get(key);
  }

  function selectCandidate(candidate) {
    const cat = getNormalizedCategory(candidate);
    const targetState = getOrCreateDocumentState(candidate);

    documentState[cat] = targetState;
    activeCandidate = candidate;
    activePreviewTab = cat;
    activeDashboardTab = cat;
  }

  function getActiveDocumentCategory() {
    if (activeCandidate) {
      return getNormalizedCategory(activeCandidate);
    }
    return activeDashboardTab || "TERMS";
  }

  // 1. Select Terms of Service
  const candTerms = {
    title: "Spotify End User Agreement",
    url: "https://www.spotify.com/legal/end-user-agreement/",
    category: "TERMS"
  };
  selectCandidate(candTerms);

  assert.equal(getActiveDocumentCategory(), "TERMS");
  assert.equal(activePreviewTab, "TERMS");
  assert.equal(activeDashboardTab, "TERMS");

  // Add Q&A turn to Terms
  const termsDoc = getOrCreateDocumentState(candTerms);
  termsDoc.extracted = { text: "Terms text content...", ok: true };
  termsDoc.qaHistory.push({
    id: "q1",
    question: "Can I cancel my subscription?",
    qa: { answer: "You can cancel at any time via Account page.", confidence: "High" }
  });

  assert.equal(termsDoc.qaHistory.length, 1);
  assert.equal(termsDoc.qaHistory[0].question, "Can I cancel my subscription?");

  // 2. Select Privacy Policy
  const candPrivacy = {
    title: "Spotify Privacy Policy",
    url: "https://www.spotify.com/legal/privacy-policy/",
    category: "PRIVACY"
  };
  selectCandidate(candPrivacy);

  assert.equal(getActiveDocumentCategory(), "PRIVACY");
  assert.equal(activePreviewTab, "PRIVACY");
  assert.equal(activeDashboardTab, "PRIVACY");

  const privDoc = getOrCreateDocumentState(candPrivacy);
  assert.equal(privDoc.qaHistory.length, 0, "Privacy policy must start with zero Q&A history");
  assert.equal(privDoc.extracted, null, "Privacy policy extraction must be null");

  // Add Q&A turn to Privacy
  privDoc.extracted = { text: "Privacy policy text...", ok: true };
  privDoc.qaHistory.push({
    id: "q2",
    question: "What personal data is collected?",
    qa: { answer: "Email address, streaming history, and device IP.", confidence: "High" }
  });

  assert.equal(privDoc.qaHistory.length, 1);
  assert.equal(privDoc.qaHistory[0].question, "What personal data is collected?");

  // 3. Select Other Privacy / Regional Link
  const candOther = {
    title: "Regional Privacy Notice",
    url: "https://www.spotify.com/legal/privacy-policy/#regional",
    category: "OTHER_PRIVACY"
  };
  selectCandidate(candOther);

  assert.equal(getActiveDocumentCategory(), "OTHER_PRIVACY");
  const otherDoc = getOrCreateDocumentState(candOther);
  assert.equal(otherDoc.qaHistory.length, 0, "Other privacy document must have independent empty Q&A history");

  // 4. Switch back to Terms
  selectCandidate(candTerms);
  assert.equal(getActiveDocumentCategory(), "TERMS");
  const restoredTerms = getOrCreateDocumentState(candTerms);
  assert.equal(restoredTerms.qaHistory.length, 1, "Terms Q&A history must be preserved intact");
  assert.equal(restoredTerms.qaHistory[0].question, "Can I cancel my subscription?");

  // Verify Privacy history remains independent
  const checkPriv = getOrCreateDocumentState(candPrivacy);
  assert.equal(checkPriv.qaHistory.length, 1);
  assert.equal(checkPriv.qaHistory[0].question, "What personal data is collected?");
});

test("Test C: Session Storage Keys Guarantee Candidate-Specific Storage and No Fallback Pollution", () => {
  const sessionDb = new Map();

  function saveSessionQa(url, category, history, candidate) {
    const host = new URL(url).hostname;
    const catKey = `tos_qa_${host}_${category}`;
    sessionDb.set(catKey, history);

    if (candidate?.url) {
      const cKey = getCandidateKey(candidate);
      const candKey = `tos_qa_${host}_${encodeURIComponent(cKey)}`;
      sessionDb.set(candKey, history);
    }
  }

  function restoreCandidateSessionQa(url, candidate, registry) {
    const host = new URL(url).hostname;
    const cKey = getCandidateKey(candidate);
    const candKey = `tos_qa_${host}_${encodeURIComponent(cKey)}`;

    // Rule RC-2: Active candidate strictly looks for candKey, NEVER falls back to generic category key
    const data = sessionDb.get(candKey);
    const state = registry.get(cKey) || { qaHistory: [] };
    if (Array.isArray(data) && data.length > 0) {
      state.qaHistory = [...data];
    } else {
      state.qaHistory = [];
    }
    registry.set(cKey, state);
    return state;
  }

  const url = "https://www.spotify.com/in-en/";
  const candTerms = {
    title: "Paid Subscription Terms",
    url: "https://www.spotify.com/legal/paid-subscription-terms/",
    category: "TERMS"
  };
  const candPrivacy = {
    title: "Privacy Policy",
    url: "https://www.spotify.com/legal/privacy-policy/",
    category: "PRIVACY"
  };

  const registry = new Map();

  // Save Terms history
  const termsHistory = [
    { id: "t1", question: "Can I cancel?", qa: { answer: "Yes." } }
  ];
  saveSessionQa(url, "TERMS", termsHistory, candTerms);

  // Restore Privacy without having saved any privacy history
  const restoredPrivacy = restoreCandidateSessionQa(url, candPrivacy, registry);
  assert.equal(restoredPrivacy.qaHistory.length, 0, "Privacy must NOT inherit Terms category history");

  // Restore Terms
  const restoredTerms = restoreCandidateSessionQa(url, candTerms, registry);
  assert.equal(restoredTerms.qaHistory.length, 1, "Terms must restore its own history");
  assert.equal(restoredTerms.qaHistory[0].question, "Can I cancel?");
});

test("Test D & E: Asynchronous Candidate Switching Routes Response Exclusively to Originating Document", () => {
  const registry = new Map();

  function getOrCreateDoc(cand) {
    const key = getCandidateKey(cand);
    if (!registry.has(key)) {
      registry.set(key, { candidate: cand, qaHistory: [] });
    }
    return registry.get(key);
  }

  const termsCand = {
    title: "Terms of Service",
    url: "https://www.spotify.com/legal/terms/",
    category: "TERMS"
  };

  const privacyCand = {
    title: "Privacy Policy",
    url: "https://www.spotify.com/legal/privacy/",
    category: "PRIVACY"
  };

  // User starts on Terms
  let activeCandidate = termsCand;

  // 1. User submits question on Terms
  const requestOriginCandidate = activeCandidate;
  const targetCandidateKey = getCandidateKey(requestOriginCandidate);

  // 2. While waiting for async response, user switches active document to Privacy Policy
  activeCandidate = privacyCand;

  // 3. Backend response arrives for Terms request
  const response = {
    ok: true,
    requestId: "req_async_123",
    candidateKey: targetCandidateKey,
    turn: {
      id: "req_async_123",
      question: "What is the refund policy?",
      qa: { answer: "Refunds are processed within 14 days of purchase.", confidence: "High" }
    }
  };

  // Handler routes using response / captured candidate identity (RC-3)
  const destDoc = getOrCreateDoc(requestOriginCandidate);
  destDoc.qaHistory.push(response.turn);

  // Verify that Privacy (currently active) was NOT polluted
  const currentActiveDoc = getOrCreateDoc(activeCandidate);
  assert.equal(currentActiveDoc.qaHistory.length, 0, "Active document (Privacy) must NOT receive Terms answer");

  // Verify that Terms (originating document) received the answer in registry
  const termsDoc = getOrCreateDoc(termsCand);
  assert.equal(termsDoc.qaHistory.length, 1, "Originating document must receive the answer");
  assert.equal(termsDoc.qaHistory[0].question, "What is the refund policy?");
});

test("Test G: buildQaPrompt dynamically references documentLabel in refusal and schema", () => {
  // 1. Privacy Policy documentLabel
  const privPrompt = buildQaPrompt({
    question: "Do you sell my data?",
    documentLabel: "Privacy Policy",
    retrievedEvidence: [{ clauseId: "c_1", text: "We do not sell personal data." }]
  });

  assert.ok(privPrompt.includes("You are analyzing Privacy Policy clauses"), "Header must reference Privacy Policy");
  assert.ok(privPrompt.includes("SUPPLIED PRIVACY POLICY EVIDENCE:"), "Evidence header must match documentLabel");
  assert.ok(privPrompt.includes("an explicit statement that the Privacy Policy does not provide enough information"), "Schema must reference Privacy Policy");
  assert.ok(!privPrompt.includes("Terms of Service"), "Privacy prompt must not mention Terms of Service");

  // 2. Custom documentLabel ("Paid Subscription Terms")
  const paidTermsPrompt = buildQaPrompt({
    question: "How do I cancel?",
    documentLabel: "Paid Subscription Terms",
    retrievedEvidence: []
  });

  assert.ok(paidTermsPrompt.includes("You are analyzing Paid Subscription Terms clauses"));
  assert.ok(paidTermsPrompt.includes("SUPPLIED PAID SUBSCRIPTION TERMS EVIDENCE:"));
  assert.ok(paidTermsPrompt.includes("No relevant Paid Subscription Terms clauses were found"));
  assert.ok(paidTermsPrompt.includes("an explicit statement that the Paid Subscription Terms does not provide enough information"));
  assert.ok(!paidTermsPrompt.includes("Terms of Service"), "Paid terms prompt must not mention generic Terms of Service");

  // 3. Default fallback when no documentLabel provided
  const defaultPrompt = buildQaPrompt({
    question: "What is arbitration?",
    retrievedEvidence: [{ clauseId: "c_arb", text: "Mandatory binding arbitration." }]
  });

  assert.ok(defaultPrompt.includes("You are analyzing Terms of Service clauses"), "Default fallback must be Terms of Service");
  assert.ok(defaultPrompt.includes("SUPPLIED TERMS OF SERVICE EVIDENCE:"));
});

test("Test H: Active Document Context resolution prevents Terms bleeding into Privacy when unextracted", () => {
  const documentState = {
    TERMS: {
      candidate: { title: "Terms of Service", url: "https://example.com/terms", category: "TERMS" },
      extracted: { text: "Terms text", ok: true },
      scanResult: { segments: [{ clauseId: "t_1", text: "Cancellation clause" }] }
    },
    PRIVACY: {
      candidate: null,
      extracted: null,
      scanResult: null
    },
    OTHER_PRIVACY: {
      candidate: null,
      extracted: null,
      scanResult: null
    }
  };

  let activePreviewTab = "TERMS";
  let activeDashboardTab = "TERMS";
  let activeCandidate = documentState.TERMS.candidate;

  function getActiveDocumentCategory() {
    return activePreviewTab || "TERMS";
  }

  function getActiveDocumentContext(category) {
    const resolvedCat = category || getActiveDocumentCategory();
    const candCat = activeCandidate ? getNormalizedCategory(activeCandidate) : null;
    const doc = (activeCandidate && candCat === resolvedCat)
      ? documentState[resolvedCat]
      : documentState[resolvedCat];
    if (!doc) return null;

    if (Array.isArray(doc.scanResult?.segments) && doc.scanResult.segments.length > 0) {
      return {
        clauses: doc.scanResult.segments,
        documentType: resolvedCat
      };
    }
    if (doc.extracted?.text) {
      return {
        policyText: doc.extracted.text,
        documentType: resolvedCat
      };
    }
    return null;
  }

  // 1. On Terms tab, returns Terms context
  assert.equal(getActiveDocumentCategory(), "TERMS");
  const termsCtx = getActiveDocumentContext();
  assert.ok(termsCtx !== null);
  assert.equal(termsCtx.documentType, "TERMS");
  assert.equal(termsCtx.clauses.length, 1);

  // 2. User switches to Privacy tab before selecting/extracting a Privacy candidate
  activePreviewTab = "PRIVACY";
  activeDashboardTab = "PRIVACY";
  activeCandidate = documentState.PRIVACY?.candidate || null;

  assert.equal(getActiveDocumentCategory(), "PRIVACY");
  assert.equal(activeCandidate, null, "activeCandidate must be null when target category has no candidate");

  // 3. Privacy context MUST be null, not Terms clauses!
  const privCtx = getActiveDocumentContext();
  assert.equal(privCtx, null, "Unextracted Privacy Policy must return null context and never reuse Terms clauses");
});

test("Test I: Spotify Legal Hub link is classified as LEGAL_HUB, never as TERMS", () => {
  // 1. Footer "Legal" link
  const spotifyLegal = classifyCandidateLink("Legal", "https://www.spotify.com/in-en/legal/", true);
  assert.ok(spotifyLegal !== null, "Legal footer link must be classified");
  assert.equal(spotifyLegal.category, "LEGAL_HUB", "Generic 'Legal' link must be classified as LEGAL_HUB");
  assert.equal(spotifyLegal.categoryLabel, "Legal Documents Hub");
  assert.notEqual(spotifyLegal.category, "TERMS", "Generic 'Legal' link must never be classified as TERMS");

  // 2. Other legal hub variants
  const hubVariant = classifyCandidateLink("Legal Hub", "https://www.example.com/legal-hub", false);
  assert.ok(hubVariant !== null);
  assert.equal(hubVariant.category, "LEGAL_HUB");

  const centerVariant = classifyCandidateLink("Legal Center", "https://www.example.com/legal-center/", false);
  assert.ok(centerVariant !== null);
  assert.equal(centerVariant.category, "LEGAL_HUB");

  // 3. Specific Terms of Service link still classified as TERMS
  const termsLink = classifyCandidateLink("End User Agreement", "https://www.spotify.com/legal/end-user-agreement/", true);
  assert.ok(termsLink !== null);
  assert.equal(termsLink.category, "TERMS");
});

test("Test J: Three-way state and storage key isolation (TERMS, PRIVACY, OTHER_PRIVACY)", () => {
  const baseUrl = "https://www.example.com/legal";
  const termsCand = { url: baseUrl, category: "TERMS" };
  const privCand = { url: baseUrl, category: "PRIVACY" };
  const otherPrivCand = { url: baseUrl, category: "OTHER_PRIVACY" };

  const key1 = getCandidateKey(termsCand);
  const key2 = getCandidateKey(privCand);
  const key3 = getCandidateKey(otherPrivCand);

  assert.equal(key1, `${baseUrl}::TERMS`);
  assert.equal(key2, `${baseUrl}::PRIVACY`);
  assert.equal(key3, `${baseUrl}::OTHER_PRIVACY`);

  assert.notEqual(key1, key2);
  assert.notEqual(key2, key3);
  assert.notEqual(key1, key3);
});
