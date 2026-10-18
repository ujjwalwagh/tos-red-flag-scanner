import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCategoryId, getAllRiskCategories, getRiskCategory } from "../src/analysis/risk-categories.js";
import { compareVendors } from "../src/portfolio/vendor-comparator.js";
import { scanPolicyForRedFlags } from "../src/analysis/semantic/scan-policy.js";
import { extractReadableText } from "../src/ingestion/url/fetch-policy-text.js";

// Provide minimal DOM mocks so frontend app.js can be imported for unit testing
const noop = () => {};
const dummyEl = {
  value: "",
  addEventListener: noop,
  classList: { add: noop, remove: noop, contains: () => false },
  getContext: () => ({ fillRect: noop, clearRect: noop }),
  style: {},
  append: noop,
  appendChild: noop,
  setAttribute: noop,
  removeAttribute: noop
};
global.document = {
  querySelector: () => dummyEl,
  querySelectorAll: () => [],
  createElement: () => dummyEl,
  addEventListener: noop
};
global.window = {
  addEventListener: noop,
  location: { reload: noop }
};

const { extractCompanyName, extractCompanyNameFromText, addToVendorStack, sessionVendorStack } = await import(
  "../../frontend/public/app.js"
);

// =========================================================================
// FIX 1 Tests: Risk category preservation and normalization
// =========================================================================

test("FIX 1: normalizeCategoryId correctly resolves canonical IDs, display names, and aliases", () => {
  // Canonical IDs
  assert.equal(normalizeCategoryId("ARBITRATION"), "ARBITRATION");
  assert.equal(normalizeCategoryId("PRIVACY_DATA_SHARING"), "PRIVACY_DATA_SHARING");
  assert.equal(normalizeCategoryId("LIABILITY_LIMITATIONS"), "LIABILITY_LIMITATIONS");
  assert.equal(normalizeCategoryId("UNILATERAL_CHANGES"), "UNILATERAL_CHANGES");

  // Display names
  assert.equal(normalizeCategoryId("Arbitration & Class Action Waiver"), "ARBITRATION");
  assert.equal(normalizeCategoryId("Data Sharing & Third-Party Disclosure"), "PRIVACY_DATA_SHARING");
  assert.equal(normalizeCategoryId("Limitation of Liability & Warranty Disclaimers"), "LIABILITY_LIMITATIONS");
  assert.equal(normalizeCategoryId("Indefinite Data Retention & Deletion Limits"), "DATA_RETENTION");
  assert.equal(normalizeCategoryId("Broad User Content Rights & Ownership"), "USER_CONTENT_RIGHTS");
  assert.equal(normalizeCategoryId("Automatic Subscription Renewal & Recurring Billing"), "AUTO_RENEWAL");
  assert.equal(normalizeCategoryId("Unilateral Terms Modification"), "UNILATERAL_CHANGES");
  assert.equal(normalizeCategoryId("Exclusive Foreign Venue & Governing Law"), "GOVERNING_LAW");

  // Aliases
  assert.equal(normalizeCategoryId("privacy"), "PRIVACY_DATA_SHARING");
  assert.equal(normalizeCategoryId("class_action"), "ARBITRATION");
  assert.equal(normalizeCategoryId("auto_renewal"), "AUTO_RENEWAL");
  assert.equal(normalizeCategoryId("LIABILITY_LIMITATION"), "LIABILITY_LIMITATIONS");

  // Unmatched categories normalize to OTHER (not silently dropped or marked safe)
  assert.equal(normalizeCategoryId("random_unmatched_provision"), "OTHER");
  assert.equal(normalizeCategoryId(""), "OTHER");
  assert.equal(normalizeCategoryId(null), "OTHER");
});

test("FIX 1: scanPolicyForRedFlags preserves canonical categoryId on findings", async () => {
  const policySample = `
    1. Arbitration Agreement. You agree to resolve all disputes through individual binding arbitration.
    You waive any right to bring a class action against the company or participate in representative actions.
    All claims must be arbitrated on an individual basis.
    2. Data Sharing. We may sell and transfer your personal data, tracking cookies, and usage history to third-party commercial partners and advertising brokers.
    3. Limitation of Liability. The company shall not be liable for any damages, lost profits, or data loss exceeding fifty dollars ($50.00).
    4. Unilateral Modifications. We reserve the right to amend or alter these terms at any time without prior notice to you.
  `.repeat(2);

  const report = await scanPolicyForRedFlags(policySample, "https://policies.google.com/terms");
  assert.ok(Array.isArray(report.flags));
  assert.ok(report.flags.length > 0);

  // Verify categoryId is preserved on every flag
  for (const flag of report.flags) {
    assert.ok(flag.categoryId, `Flag '${flag.title}' must contain categoryId`);
    assert.ok(typeof flag.categoryId === "string");
    // Verify it is a recognized canonical category ID
    const cat = getRiskCategory(flag.categoryId);
    assert.ok(cat, `Category '${flag.categoryId}' must exist in RISK_CATEGORIES`);
  }

  // Verify specific flags have appropriate categoryIds
  const arbFlag = report.flags.find((f) => f.categoryId === "ARBITRATION");
  assert.ok(arbFlag, "Must detect ARBITRATION finding with canonical categoryId");
});

// =========================================================================
// FIX 2 Tests: Vendor name extraction (URLs, PDFs, pasted text)
// =========================================================================

test("FIX 2: extractCompanyName accurately resolves vendor names for URLs, PDFs, and text", () => {
  // URLs: should produce registered domain name (GOOGLE, UBER, TWITTER) instead of subdomain (POLICIES, TERMS)
  assert.equal(extractCompanyName("https://policies.google.com/terms"), "GOOGLE");
  assert.equal(extractCompanyName("https://terms.uber.com/terms"), "UBER");
  assert.equal(extractCompanyName("https://legal.twitter.com/tos"), "TWITTER");
  assert.equal(extractCompanyName("https://www.netflix.com/terms"), "NETFLIX");
  assert.equal(extractCompanyName("https://policies.google.co.uk/terms"), "GOOGLE");
  assert.equal(extractCompanyName("https://slack.com/terms"), "SLACK");

  // PDF uploads: extracts filename without throwing error
  assert.equal(extractCompanyName("PDF: zoom_enterprise_terms.pdf"), "ZOOM ENTERPRISE TERMS");
  assert.equal(extractCompanyName("PDF: slack-policy.pdf"), "SLACK POLICY");
  assert.equal(extractCompanyName("PDF: terms.pdf"), "TERMS");

  // Pasted text: returns fallback without throwing error
  assert.equal(extractCompanyName("Pasted text"), "the Service Provider");
  assert.equal(extractCompanyName("Pasted text (1500 chars)"), "the Service Provider");

  // Custom fallback
  assert.equal(extractCompanyName("Pasted text", "Custom Vendor"), "Custom Vendor");
  assert.equal(extractCompanyName("", "Fallback Vendor"), "Fallback Vendor");
});

// =========================================================================
// FIX 3 Tests: Stack preservation and duplicate prevention
// =========================================================================

test("FIX 3: addToVendorStack preserves distinct scans and handles unique fallback labels", () => {
  // Clear stack for testing
  sessionVendorStack.length = 0;

  const scan1 = {
    sourceUrl: "Pasted text",
    flags: [{ title: "Arbitration", quote: "Mandatory arbitration clause." }]
  };
  const scan2 = {
    sourceUrl: "Pasted text",
    flags: [{ title: "Liability Cap", quote: "Liability capped at $10." }]
  };

  addToVendorStack(scan1);
  assert.equal(sessionVendorStack.length, 1);
  assert.equal(sessionVendorStack[0].vendorName, "Policy #1");

  // Second distinct pasted text scan must NOT be discarded
  addToVendorStack(scan2);
  assert.equal(sessionVendorStack.length, 2);
  assert.equal(sessionVendorStack[1].vendorName, "Policy #2");

  // Third scan with a URL
  const scan3 = {
    sourceUrl: "https://policies.google.com/terms",
    flags: [{ title: "Data Sharing", quote: "We share data." }]
  };
  addToVendorStack(scan3);
  assert.equal(sessionVendorStack.length, 3);
  assert.equal(sessionVendorStack[2].vendorName, "GOOGLE");

  // Accidental duplicate submission of the exact same scan must be ignored
  addToVendorStack(scan3);
  assert.equal(sessionVendorStack.length, 3, "Duplicate scan should not increase stack size");
});

// =========================================================================
// FIX 4 Tests: Comparison matrix and score differentiation
// =========================================================================

test("FIX 4: compareVendors correctly maps real findings to category rows and does not mark them standard", () => {
  const vendorAlpha = {
    vendorName: "AlphaCloud",
    analysis: {
      flags: [
        {
          categoryId: "ARBITRATION",
          clauseType: "Arbitration & Class Action Waiver",
          severity: "high",
          quote: "All disputes resolved by binding individual arbitration.",
          plainEnglish: "You cannot join a class action."
        },
        {
          categoryId: "PRIVACY_DATA_SHARING",
          clauseType: "Data Sharing & Third-Party Disclosure",
          severity: "high",
          quote: "We share personal data with external advertising networks.",
          plainEnglish: "Your personal data is shared commercially."
        }
      ]
    }
  };

  const vendorBeta = {
    vendorName: "BetaServices",
    analysis: {
      flags: [
        {
          categoryId: "LIABILITY_LIMITATIONS",
          clauseType: "Limitation of Liability & Warranty Disclaimers",
          severity: "low",
          quote: "Liability capped at fees paid over the last 12 months.",
          plainEnglish: "Standard fee-based recovery cap."
        }
      ]
    }
  };

  const comparison = compareVendors([vendorAlpha, vendorBeta]);

  assert.equal(comparison.vendors.length, 2);
  assert.equal(comparison.recommendedVendor, "BetaServices");

  // Verify ARBITRATION row: Alpha is FLAGGED, Beta is NOT_DETECTED
  const arbRow = comparison.categoryMatrix.ARBITRATION;
  assert.ok(arbRow);
  assert.equal(arbRow.vendorEntries["AlphaCloud"].status, "FLAGGED");
  assert.equal(arbRow.vendorEntries["AlphaCloud"].severity, "HIGH");
  assert.ok(arbRow.vendorEntries["AlphaCloud"].evidence.includes("binding individual arbitration"));
  assert.equal(arbRow.vendorEntries["BetaServices"].status, "NOT_DETECTED");

  // Verify PRIVACY row: Alpha is FLAGGED, Beta is NOT_DETECTED
  const privRow = comparison.categoryMatrix.PRIVACY_DATA_SHARING;
  assert.ok(privRow);
  assert.equal(privRow.vendorEntries["AlphaCloud"].status, "FLAGGED");
  assert.equal(privRow.vendorEntries["BetaServices"].status, "NOT_DETECTED");

  // Verify LIABILITY row: Alpha is NOT_DETECTED, Beta is FLAGGED
  const liabRow = comparison.categoryMatrix.LIABILITY_LIMITATIONS;
  assert.ok(liabRow);
  assert.equal(liabRow.vendorEntries["AlphaCloud"].status, "NOT_DETECTED");
  assert.equal(liabRow.vendorEntries["BetaServices"].status, "FLAGGED");
  assert.equal(liabRow.vendorEntries["BetaServices"].severity, "LOW");
});

test("FIX 4: different policy risk profiles produce differentiated scores without premature saturation", () => {
  // 1. High-risk policy: 5 HIGH findings across critical categories
  const aggressiveVendor = {
    vendorName: "AggressiveCorp",
    analysis: {
      flags: [
        { categoryId: "ARBITRATION", severity: "HIGH" },
        { categoryId: "PRIVACY_DATA_SHARING", severity: "HIGH" },
        { categoryId: "USER_CONTENT_RIGHTS", severity: "HIGH" },
        { categoryId: "LIABILITY_LIMITATIONS", severity: "HIGH" },
        { categoryId: "UNILATERAL_CHANGES", severity: "HIGH" }
      ]
    }
  };

  // 2. Moderate-risk policy: 2 HIGH + 2 MEDIUM + 1 LOW findings
  const moderateVendor = {
    vendorName: "ModerateCorp",
    analysis: {
      flags: [
        { categoryId: "AUTO_RENEWAL", severity: "MEDIUM" },
        { categoryId: "REFUND_RESTRICTIONS", severity: "MEDIUM" },
        { categoryId: "GOVERNING_LAW", severity: "LOW" },
        { categoryId: "DISPUTE_RESOLUTION", severity: "HIGH" }
      ]
    }
  };

  // 3. Favorable policy: only 1 LOW finding
  const favorableVendor = {
    vendorName: "FavorableApp",
    analysis: {
      flags: [{ categoryId: "GOVERNING_LAW", severity: "LOW" }]
    }
  };

  // 4. Clean policy: 0 findings
  const cleanVendor = {
    vendorName: "CleanApp",
    analysis: { flags: [] }
  };

  const comparison = compareVendors([
    aggressiveVendor,
    moderateVendor,
    favorableVendor,
    cleanVendor
  ]);

  const scores = comparison.vendorScores;
  assert.ok(scores.AggressiveCorp <= 100 && scores.AggressiveCorp >= 0);
  assert.ok(scores.ModerateCorp <= 100 && scores.ModerateCorp >= 0);
  assert.ok(scores.FavorableApp <= 100 && scores.FavorableApp >= 0);
  assert.equal(scores.CleanApp, 0);

  // Scores must be differentiated and strictly monotonic according to risk
  assert.ok(
    scores.AggressiveCorp > scores.ModerateCorp,
    `Aggressive (${scores.AggressiveCorp}) must score higher than Moderate (${scores.ModerateCorp})`
  );
  assert.ok(
    scores.ModerateCorp > scores.FavorableApp,
    `Moderate (${scores.ModerateCorp}) must score higher than Favorable (${scores.FavorableApp})`
  );
  assert.ok(
    scores.FavorableApp > scores.CleanApp,
    `Favorable (${scores.FavorableApp}) must score higher than Clean (${scores.CleanApp})`
  );

  // Even aggressive with 5 high findings should not cap at 100 unless truly critical
  assert.ok(scores.AggressiveCorp >= 70 && scores.AggressiveCorp <= 85);

  // Recommended vendor must be CleanApp (lowest score)
  assert.equal(comparison.recommendedVendor, "CleanApp");
});

// =========================================================================
// REGRESSION SUITE: Targeted Compare Vendors Fixes (Phases 1-4)
// =========================================================================

test("FIX 1 Regression: report containing only synthetic baseline finding receives zero penalty", () => {
  const syntheticOnlyVendor = {
    vendorName: "BaselineCorp",
    analysis: {
      flags: [
        {
          categoryId: "GENERAL_RISK",
          title: "Standard Terms Phrasing",
          severity: "low",
          quote: "These terms contain standard operational provisions."
        }
      ]
    }
  };

  const cleanVendor = {
    vendorName: "PureVendor",
    analysis: { flags: [] }
  };

  const comparison = compareVendors([syntheticOnlyVendor, cleanVendor]);

  // BaselineCorp must NOT receive an artificial penalty for the synthetic placeholder
  assert.equal(comparison.vendorScores["BaselineCorp"], 0);
  assert.equal(comparison.vendorScores["PureVendor"], 0);

  // All categories in BaselineCorp must be NOT_DETECTED (synthetic flag ignored)
  for (const catId of Object.keys(comparison.categoryMatrix)) {
    const entry = comparison.categoryMatrix[catId].vendorEntries["BaselineCorp"];
    assert.equal(
      entry.status,
      "NOT_DETECTED",
      `Category ${catId} must be NOT_DETECTED for synthetic placeholder finding`
    );
  }
});

test("FIX 2 Regression: unflagged categories return NOT_DETECTED with neutral summary and no false safety claims", () => {
  const vendorX = {
    vendorName: "VendorX",
    analysis: {
      flags: [
        {
          categoryId: "ARBITRATION",
          severity: "HIGH",
          quote: "Binding arbitration.",
          explanation: "Waives class action rights."
        }
      ]
    }
  };
  const vendorY = {
    vendorName: "VendorY",
    analysis: { flags: [] }
  };

  const comparison = compareVendors([vendorX, vendorY]);

  // Detected category
  const arbRow = comparison.categoryMatrix.ARBITRATION;
  assert.equal(arbRow.vendorEntries["VendorX"].status, "FLAGGED");
  assert.equal(arbRow.vendorEntries["VendorX"].severity, "HIGH");
  assert.equal(arbRow.vendorEntries["VendorY"].status, "NOT_DETECTED");
  assert.equal(arbRow.vendorEntries["VendorY"].severity, "NONE");
  assert.equal(arbRow.vendorEntries["VendorY"].evidence, "");
  // Summary should be neutral, indicating absence of detected flags in analyzed text rather than confirmed safety
  assert.match(arbRow.vendorEntries["VendorY"].summary, /No .* red flags detected in analyzed excerpt/i);

  // Undetected category across both vendors
  const govLawRow = comparison.categoryMatrix.GOVERNING_LAW;
  assert.equal(govLawRow.vendorEntries["VendorX"].status, "NOT_DETECTED");
  assert.equal(govLawRow.vendorEntries["VendorY"].status, "NOT_DETECTED");
  assert.match(govLawRow.vendorEntries["VendorX"].summary, /No .* red flags detected in analyzed excerpt/i);
});

test("FIX 3 Regression: extractReadableText preserves paragraph breaks and clause headings", () => {
  const rawHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Test Terms</title><style>.hidden { display: none; }</style></head>
      <body>
        <script>console.log("analytics");</script>
        <header><nav>Navigation Link</nav></header>
        <main>
          <h1>Zoom Terms of Service</h1>
          <p>These terms constitute a binding legal agreement between you and Zoom Video Communications, Inc.</p>
          <h2>1. Dispute Resolution</h2>
          <p>Any dispute will be resolved exclusively through binding arbitration.<br>Arbitration will occur individually.</p>
          <blockquote>Special consumer protections may apply in certain jurisdictions.</blockquote>
          <ul>
            <li>Clause 1: Account responsibility</li>
            <li>Clause 2: Usage restrictions</li>
          </ul>
        </main>
        <footer><nav>Footer Links</nav></footer>
      </body>
    </html>
  `;

  const extracted = extractReadableText(rawHtml);

  // Headings and paragraphs must be separated by paragraph breaks (\n\n)
  assert.ok(extracted.includes("Zoom Terms of Service\n\n"));
  assert.ok(extracted.includes("Zoom Video Communications, Inc.\n\n"));
  assert.ok(extracted.includes("1. Dispute Resolution\n\n"));
  // <br> should create single line break
  assert.ok(extracted.includes("binding arbitration.\nArbitration will occur individually."));
  // Blockquotes and list items separated by double newlines
  assert.ok(extracted.includes("Special consumer protections may apply in certain jurisdictions.\n\n"));
  assert.ok(extracted.includes("Clause 1: Account responsibility\n\n"));
  assert.ok(extracted.includes("Clause 2: Usage restrictions"));

  // Scripts and styles removed
  assert.equal(extracted.includes("analytics"), false);
  assert.equal(extracted.includes(".hidden"), false);
});

test("FIX 4 Regression: extractCompanyNameFromText detects Zoom, OpenAI, Stripe, Dropbox and rejects generic legal phrasing", () => {
  // Common title and introductory patterns
  assert.equal(
    extractCompanyNameFromText("Zoom Terms of Service\nLast updated: January 2026\nThese terms govern..."),
    "ZOOM"
  );
  assert.equal(
    extractCompanyNameFromText("OpenAI Terms of Use\nEffective Date: March 2026\nThank you for using OpenAI!"),
    "OPENAI"
  );
  assert.equal(
    extractCompanyNameFromText("Welcome to Stripe! These terms constitute an agreement between you and Stripe."),
    "STRIPE"
  );
  assert.equal(
    extractCompanyNameFromText("Dropbox User Agreement\nWelcome to Dropbox. By using our services..."),
    "DROPBOX"
  );

  // Generic legal phrases should NOT be confused with company names
  assert.equal(extractCompanyNameFromText("These Terms of Service govern your access to and use of our platform."), null);
  assert.equal(extractCompanyNameFromText("Standard Terms of Service for all enterprise and commercial customers."), null);
  assert.equal(extractCompanyNameFromText("General Terms and Conditions governing all user accounts."), null);
  assert.equal(extractCompanyNameFromText("Privacy Policy for our website and mobile application."), null);

  // Fallback and integration through extractCompanyName
  assert.equal(
    extractCompanyName("Pasted text", "Policy #2", "Welcome to Stripe! We provide payments."),
    "STRIPE"
  );
  assert.equal(
    extractCompanyName("Pasted text", "Policy #2", "These Terms of Service apply to all visitors."),
    "Policy #2"
  );

  // Preserved URL and PDF behavior
  assert.equal(extractCompanyName("https://policies.google.com/terms"), "GOOGLE");
  assert.equal(extractCompanyName("PDF: zoom_enterprise_terms.pdf"), "ZOOM ENTERPRISE TERMS");
});
