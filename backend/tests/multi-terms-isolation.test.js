/**
 * Phase 7G-D.6 — Multi-Terms Detection and State Isolation Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCandidateLink,
  canonicalizeUrl,
  deriveTermsMetadata
} from "../../extension/utils/detector-rules.js";

test("deriveTermsMetadata classifies specific legal agreements accurately", () => {
  const pst = deriveTermsMetadata("Paid Subscription Terms", "/legal/paid-subscription-terms/");
  assert.equal(pst.categoryLabel, "Paid Subscription Terms");
  assert.equal(pst.defaultTitle, "Paid Subscription Terms");

  const eua = deriveTermsMetadata("Spotify End User Agreement", "/legal/end-user-agreement/");
  assert.equal(eua.categoryLabel, "End User Agreement");
  assert.equal(eua.defaultTitle, "End User Agreement");

  const sub = deriveTermsMetadata("Subscription Agreement", "/legal/subscription-agreement");
  assert.equal(sub.categoryLabel, "Subscription Agreement");

  const tc = deriveTermsMetadata("Terms & Conditions", "/terms-and-conditions");
  assert.equal(tc.categoryLabel, "Terms and Conditions");

  const tos = deriveTermsMetadata("Terms of Service", "/terms");
  assert.equal(tos.categoryLabel, "Terms of Service");
});

test("classifyCandidateLink identifies Spotify EUA and PST as distinct selectable candidates", () => {
  const eua = classifyCandidateLink("End User Agreement", "https://www.spotify.com/in-en/legal/end-user-agreement/", true);
  const pst = classifyCandidateLink("Paid Subscription Terms", "https://www.spotify.com/in-en/legal/paid-subscription-terms/", true);

  assert.ok(eua, "Must classify End User Agreement");
  assert.ok(pst, "Must classify Paid Subscription Terms");

  assert.equal(eua.category, "TERMS");
  assert.equal(eua.categoryLabel, "End User Agreement");
  assert.equal(eua.title, "End User Agreement");

  assert.equal(pst.category, "TERMS");
  assert.equal(pst.categoryLabel, "Paid Subscription Terms");
  assert.equal(pst.title, "Paid Subscription Terms");

  // Distinct URLs
  assert.notEqual(canonicalizeUrl(eua.url), canonicalizeUrl(pst.url));
});

test("canonicalizeUrl deduplicates identical URLs across query parameters, trailing slashes and casing", () => {
  const u1 = "https://www.spotify.com/in-en/legal/paid-subscription-terms/";
  const u2 = "https://www.SPOTIFY.com/in-en/legal/paid-subscription-terms";
  const u3 = "https://www.spotify.com/in-en/legal/paid-subscription-terms/#section-3";

  assert.equal(canonicalizeUrl(u1), canonicalizeUrl(u2));
  assert.equal(canonicalizeUrl(u1), canonicalizeUrl(u3));
});

test("Simulated documentRegistry preserves independent state across candidate switching", () => {
  const registry = new Map();

  function getOrCreateState(candidate) {
    const key = canonicalizeUrl(candidate.url);
    if (!registry.has(key)) {
      registry.set(key, {
        candidate,
        extracted: null,
        scanResult: null,
        qaHistory: []
      });
    }
    return registry.get(key);
  }

  const candA = {
    title: "End User Agreement",
    category: "TERMS",
    categoryLabel: "End User Agreement",
    url: "https://www.spotify.com/in-en/legal/end-user-agreement/"
  };

  const candB = {
    title: "Paid Subscription Terms",
    category: "TERMS",
    categoryLabel: "Paid Subscription Terms",
    url: "https://www.spotify.com/in-en/legal/paid-subscription-terms/"
  };

  // 1. Select and extract Document A
  let activeDoc = getOrCreateState(candA);
  activeDoc.extracted = { text: "End User Agreement Text with 50 clauses...", ok: true };
  activeDoc.qaHistory.push({ question: "Is service personal?", answer: "Yes." });

  // 2. Switch to Document B
  // Stash A (already in registry), get B
  activeDoc = getOrCreateState(candB);
  assert.equal(activeDoc.extracted, null, "Document B must start unextracted");
  assert.equal(activeDoc.qaHistory.length, 0, "Document B must start with empty Q&A history");

  // 3. Extract and Q&A on Document B
  activeDoc.extracted = { text: "Paid Subscription Terms with cancellation clauses...", ok: true };
  activeDoc.qaHistory.push({ question: "Can I cancel?", answer: "Yes, at any time." });

  // 4. Switch back to Document A
  activeDoc = getOrCreateState(candA);
  assert.ok(activeDoc.extracted.text.includes("End User Agreement"));
  assert.equal(activeDoc.qaHistory.length, 1);
  assert.equal(activeDoc.qaHistory[0].question, "Is service personal?");

  // 5. Verify Document B remains intact in registry
  const docB = getOrCreateState(candB);
  assert.ok(docB.extracted.text.includes("Paid Subscription Terms"));
  assert.equal(docB.qaHistory.length, 1);
  assert.equal(docB.qaHistory[0].question, "Can I cancel?");
});
