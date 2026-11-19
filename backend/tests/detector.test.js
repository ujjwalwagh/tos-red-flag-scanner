import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyCandidateLink,
  classifyCurrentPage,
  isSafeHttpUrl,
  normalizeText,
  canonicalizeUrl
} from "../../extension/utils/detector-rules.js";
import { isScanSupportedUrl } from "../../extension/background/service-worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, "../../extension/manifest.json");

/* ------------------------------------------------------------------
 * 1. Safe URL Validation & Normalization
 * ------------------------------------------------------------------ */

test("isSafeHttpUrl accepts only valid HTTP and HTTPS URLs", () => {
  assert.equal(isSafeHttpUrl("https://example.com/terms"), true);
  assert.equal(isSafeHttpUrl("http://localhost:3000/privacy"), true);

  // Unsafe / non-web schemes must be rejected
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("mailto:legal@example.com"), false);
  assert.equal(isSafeHttpUrl("tel:+1234567890"), false);
  assert.equal(isSafeHttpUrl("data:text/html,<html></html>"), false);
  assert.equal(isSafeHttpUrl("chrome://extensions"), false);
  assert.equal(isSafeHttpUrl("blob:https://example.com/uuid"), false);
  assert.equal(isSafeHttpUrl("#anchor"), false);
  assert.equal(isSafeHttpUrl(""), false);
  assert.equal(isSafeHttpUrl(null), false);
});

test("canonicalizeUrl strips trailing slashes and hashes for clean deduplication", () => {
  const url1 = canonicalizeUrl("https://example.com/terms/");
  const url2 = canonicalizeUrl("https://example.com/terms#section2");
  const url3 = canonicalizeUrl("https://EXAMPLE.com/terms");

  assert.equal(url1, "https://example.com/terms");
  assert.equal(url2, "https://example.com/terms");
  assert.equal(url3, "https://example.com/terms");
});

test("normalizeText trims and collapses excessive whitespace", () => {
  assert.equal(normalizeText("  Terms   of \n\t Service  "), "Terms of Service");
  assert.equal(normalizeText(""), "");
});

/* ------------------------------------------------------------------
 * 2. Terms of Service Link Classification
 * ------------------------------------------------------------------ */

test("classifyCandidateLink identifies Terms of Service from anchor text", () => {
  const variations = [
    "Terms of Service",
    "Terms of Use",
    "Terms and Conditions",
    "Terms & Conditions",
    "User Agreement",
    "General Terms",
    "Service Agreement",
    "End User License Agreement",
    "EULA",
    "Conditions of Use"
  ];

  for (const text of variations) {
    const res = classifyCandidateLink(text, "https://example.com/doc", false);
    assert.ok(res, `Failed to classify Terms text: ${text}`);
    assert.equal(res.category, "TERMS");
    assert.ok(typeof res.categoryLabel === "string" && res.categoryLabel.length > 0);
  }
});

test("classifyCandidateLink distinguishes distinct agreement categories (Phase 7G-D.6)", () => {
  const cases = [
    { text: "Paid Subscription Terms", href: "https://www.spotify.com/in-en/legal/paid-subscription-terms/", expectedLabel: "Paid Subscription Terms" },
    { text: "End User Agreement", href: "https://www.spotify.com/in-en/legal/end-user-agreement/", expectedLabel: "End User Agreement" },
    { text: "Subscription Agreement", href: "https://example.com/legal/subscription-agreement", expectedLabel: "Subscription Agreement" },
    { text: "Terms and Conditions", href: "https://example.com/terms-and-conditions", expectedLabel: "Terms and Conditions" },
    { text: "Terms of Service", href: "https://example.com/terms", expectedLabel: "Terms of Service" }
  ];

  for (const c of cases) {
    const res = classifyCandidateLink(c.text, c.href, true);
    assert.ok(res, `Must detect ${c.text}`);
    assert.equal(res.category, "TERMS");
    assert.equal(res.categoryLabel, c.expectedLabel);
    assert.equal(res.title, c.text);
  }
});

test("classifyCandidateLink identifies Spotify End User Agreement and Paid Subscription Terms from URL alone", () => {
  const eua = classifyCandidateLink("Legal", "https://www.spotify.com/in-en/legal/end-user-agreement/", true);
  assert.ok(eua);
  assert.equal(eua.category, "TERMS");
  assert.equal(eua.categoryLabel, "End User Agreement");

  const pst = classifyCandidateLink("Legal", "https://www.spotify.com/in-en/legal/paid-subscription-terms/", true);
  assert.ok(pst);
  assert.equal(pst.category, "TERMS");
  assert.equal(pst.categoryLabel, "Paid Subscription Terms");
});

test("classifyCandidateLink identifies Terms from URL path patterns", () => {
  const urlPaths = [
    "https://example.com/terms",
    "https://example.com/terms-of-service",
    "https://example.com/terms-of-use",
    "https://example.com/legal/terms",
    "https://example.com/user-agreement"
  ];

  for (const href of urlPaths) {
    const res = classifyCandidateLink("Legal Information", href, false);
    assert.ok(res, `Failed to classify Terms URL: ${href}`);
    assert.equal(res.category, "TERMS");
  }
});

test("classifyCandidateLink assigns High confidence when inside footer container", () => {
  const res = classifyCandidateLink("Terms of Service", "https://example.com/terms", true);
  assert.equal(res.confidence, "High");
  assert.ok(res.reason.includes("Footer container"));
});

test("classifyCandidateLink handles weak 'Terms' anchor only when in legal container", () => {
  const outsideFooter = classifyCandidateLink("Terms", "https://example.com/info", false);
  assert.equal(outsideFooter, null, "Standalone 'Terms' outside footer must not be classified as ToS");

  const insideFooter = classifyCandidateLink("Terms", "https://example.com/info", true);
  assert.ok(insideFooter, "Standalone 'Terms' inside footer should be classified");
  assert.equal(insideFooter.category, "TERMS");
});

/* ------------------------------------------------------------------
 * 3. Privacy Policy Link Classification
 * ------------------------------------------------------------------ */

test("classifyCandidateLink identifies Privacy Policy from anchor text", () => {
  const variations = [
    "Privacy Policy",
    "Privacy Notice",
    "Privacy Statement",
    "Data Privacy",
    "Data Protection",
    "Your Privacy Rights"
  ];

  for (const text of variations) {
    const res = classifyCandidateLink(text, "https://example.com/doc", false);
    assert.ok(res, `Failed to classify Privacy text: ${text}`);
    assert.equal(res.category, "PRIVACY");
    assert.equal(res.categoryLabel, "Privacy Policy");
  }
});

test("classifyCandidateLink identifies Privacy from URL path patterns", () => {
  const urlPaths = [
    "https://example.com/privacy",
    "https://example.com/privacy-policy",
    "https://example.com/privacy-notice",
    "https://example.com/legal/privacy",
    "https://example.com/data-protection"
  ];

  for (const href of urlPaths) {
    const res = classifyCandidateLink("Information", href, false);
    assert.ok(res, `Failed to classify Privacy URL: ${href}`);
    assert.equal(res.category, "PRIVACY");
  }
});

/* ------------------------------------------------------------------
 * 4. Other Privacy & Regional Links (Tier 3)
 * ------------------------------------------------------------------ */

test("classifyCandidateLink separates regional choices from main Privacy Policy", () => {
  const regionalCases = [
    { text: "Do Not Sell or Share My Personal Information", url: "https://example.com/do-not-sell" },
    { text: "Your Privacy Choices", url: "https://example.com/privacy-choices" },
    { text: "California Privacy Rights", url: "https://example.com/california-privacy" },
    { text: "Cookie Policy", url: "https://example.com/cookie-policy" },
    { text: "Cookie Preferences", url: "https://example.com/cookies" },
    { text: "GDPR Compliance", url: "https://example.com/gdpr" }
  ];

  for (const item of regionalCases) {
    const res = classifyCandidateLink(item.text, item.url, true);
    assert.ok(res, `Failed to classify regional link: ${item.text}`);
    assert.equal(res.category, "OTHER_PRIVACY", `Expected OTHER_PRIVACY but got ${res.category}`);
    assert.equal(res.categoryLabel, "Other Privacy Link");
    assert.notEqual(res.category, "PRIVACY", "Cookie / Choice links must NOT be classified as full Privacy Policy");
  }
});

/* ------------------------------------------------------------------
 * 5. Current Page Legal Candidate Detection
 * ------------------------------------------------------------------ */

test("classifyCurrentPage detects when current page is a Terms of Service document", () => {
  const res1 = classifyCurrentPage("https://example.com/terms", "Terms of Service - Acme Corp", "Terms of Service");
  assert.ok(res1);
  assert.equal(res1.isCandidate, true);
  assert.equal(res1.category, "TERMS");
  assert.equal(res1.confidence, "High");

  const res2 = classifyCurrentPage("https://example.com/legal/terms", "Legal - Acme", "Customer Agreement");
  assert.ok(res2);
  assert.equal(res2.isCandidate, true);
  assert.equal(res2.category, "TERMS");
});

test("classifyCurrentPage detects when current page is a Privacy Policy document", () => {
  const res = classifyCurrentPage("https://example.com/privacy", "Privacy Statement - Acme", "Privacy Notice");
  assert.ok(res);
  assert.equal(res.isCandidate, true);
  assert.equal(res.category, "PRIVACY");
  assert.equal(res.confidence, "High");
});

test("classifyCurrentPage returns null for ordinary non-legal web pages", () => {
  const normalPage = classifyCurrentPage("https://example.com/dashboard", "User Dashboard", "Welcome back");
  assert.equal(normalPage, null);

  const productPage = classifyCurrentPage("https://example.com/products/headphones", "Wireless Headphones", "Features");
  assert.equal(productPage, null);
});

/* ------------------------------------------------------------------
 * 6. Unsupported / Restricted Pages Check
 * ------------------------------------------------------------------ */

test("isScanSupportedUrl rejects internal browser pages and web stores", () => {
  assert.equal(isScanSupportedUrl("https://github.com"), true);
  assert.equal(isScanSupportedUrl("https://reddit.com/r/technology"), true);
  assert.equal(isScanSupportedUrl("http://localhost:3000/app"), true);

  assert.equal(isScanSupportedUrl("chrome://extensions"), false);
  assert.equal(isScanSupportedUrl("chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html"), false);
  assert.equal(isScanSupportedUrl("edge://settings"), false);
  assert.equal(isScanSupportedUrl("about:blank"), false);
  assert.equal(isScanSupportedUrl("https://chromewebstore.google.com/detail/xyz"), false);
});

/* ------------------------------------------------------------------
 * 7. Manifest V3 Scripting Permission Audit
 * ------------------------------------------------------------------ */

test("manifest.json includes scripting permission without exceeding least privilege", () => {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);

  assert.ok(manifest.permissions.includes("scripting"), "Must include 'scripting' permission for on-demand content script injection");
  assert.ok(manifest.permissions.includes("activeTab"), "Must include 'activeTab'");
  assert.ok(manifest.permissions.includes("storage"), "Must include 'storage'");

  // Verify dangerous permissions are absent
  const forbidden = ["<all_urls>", "cookies", "history", "webNavigation", "webRequest"];
  for (const perm of forbidden) {
    assert.equal(manifest.permissions.includes(perm), false, `Must NOT request '${perm}'`);
  }
});

