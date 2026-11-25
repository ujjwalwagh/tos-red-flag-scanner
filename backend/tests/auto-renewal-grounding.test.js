import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSegment } from "../src/analysis/rule-engine/clause-analyzer.js";
import { RuleAnalyzer, deduplicateFindings } from "../src/architecture/pipeline/analysis-pipeline.js";
import { auditStatutoryCompliance, inferDocumentJurisdiction } from "../src/compliance/statutory-auditor.js";
import { JURISDICTIONS } from "../src/compliance/statutory-rules.js";
import { calculateImpactMagnitude, IMPACT_LEVELS } from "../src/analysis/impact-evaluator.js";
import { generateOptOutNotice, NOTICE_TYPES } from "../src/remediation/optout-generator.js";
import { generateAmendmentProposal } from "../src/negotiation/amendment-generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =========================================================================
// 1. Optional Autopay availability alone (Category A)
// =========================================================================

test("auto-renewal grounding: optional Autopay availability produces evidence-grounded LOW-severity finding", () => {
  const segment = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Autopay on Bill Payments. You may choose to set up recurring payments of Your bill payment account or recharge of prepaid service using Autopay."
  };

  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);

  const f = findings[0];
  assert.equal(f.title, "Optional Recurring Payment Feature");
  assert.equal(f.severity, "LOW");
  assert.equal(f.categoryId, "AUTO_RENEWAL");
  assert.match(f.evidence, /You may choose to set up recurring payments/i);

  // Must not claim automatic subscription renewal or a cancellation deadline
  assert.doesNotMatch(f.explanation, /cancel before the specified deadline/i);
  assert.doesNotMatch(f.explanation, /subscription will renew automatically/i);
  assert.match(f.explanation, /optional recurring payment feature/i);
});

test("auto-renewal grounding: optional Autopay does not trigger negative-option statutory alerts", () => {
  const findings = [
    {
      categoryId: "AUTO_RENEWAL",
      title: "Optional Recurring Payment Feature",
      severity: "LOW",
      evidence: "You may choose to set up recurring payments using Autopay."
    }
  ];

  // Under US Federal (FTC/ROSCA), optional user-initiated utility payments do not trigger negative-option violations
  const audit = auditStatutoryCompliance({
    findings,
    jurisdiction: "US_FEDERAL",
    sourceUrl: "https://pay.google.com/intl/en_in/about/terms/"
  });

  assert.equal(audit.totalStatutoryAlerts, 0);
  assert.equal(audit.criticalViolationsCount, 0);
  assert.equal(audit.complianceStanding, "COMPLIANT_STANDARD");
});

// =========================================================================
// 2. Standard automatic-renewal clause (Category B)
// =========================================================================

test("auto-renewal grounding: standard automatic renewal clause states recurring renewal without inventing deadlines", () => {
  const segment = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Your subscription will automatically renew at the end of each billing cycle unless you cancel."
  };

  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);

  const f = findings[0];
  assert.equal(f.title, "Automatic Subscription Renewal");
  assert.equal(f.severity, "MEDIUM");
  assert.equal(f.categoryId, "AUTO_RENEWAL");

  // Explains automatic renewal truthfully without asserting an unmentioned specific cancellation deadline
  assert.match(f.explanation, /renews automatically on a recurring billing cycle/i);
  assert.doesNotMatch(f.explanation, /cancel before the specified deadline/i);
});

// =========================================================================
// 3. Restrictive renewal with cancellation deadline (Category C)
// =========================================================================

test("auto-renewal grounding: renewal clause with explicit cancellation window generates HIGH-severity finding", () => {
  const segment = {
    segmentIndex: 2,
    pageNumber: 1,
    text: "Your subscription will automatically renew at the end of each annual term and you will be billed unless you cancel at least 30 days prior to the renewal date."
  };

  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);

  const f = findings[0];
  assert.equal(f.title, "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(f.severity, "HIGH");
  assert.equal(f.categoryId, "AUTO_RENEWAL");

  // Grounded explanation referencing cancellation deadline/advance notice
  assert.match(f.explanation, /cancel before a specified deadline or advance notice window/i);
  assert.match(f.evidence, /at least 30 days prior to the renewal date/i);
});

// =========================================================================
// 4. Duplicate matching of the same clause (Definition vs Substantive clause)
// =========================================================================

test("auto-renewal grounding: deduplicates glossary definition in favor of substantive clause", () => {
  const defSegment = {
    segmentIndex: 0,
    pageNumber: 1,
    text: '"Autopay" means a feature supported by NPCI within the UPI system that allows Users to set up recurring payments for certain bill payment categories as specified from time to time.'
  };

  const substantiveSegment = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Autopay on Bill Payments. You may choose to set up recurring payments of Your bill payment account or recharge of prepaid service using Autopay."
  };

  const analyzer = new RuleAnalyzer();
  const findings = analyzer.analyzeSegments([defSegment, substantiveSegment]);

  // Should result in exactly 1 deduplicated finding preserving the substantive excerpt
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Optional Recurring Payment Feature");
  assert.match(findings[0].evidence, /You may choose to set up recurring payments/i);
});

// =========================================================================
// 5. Preservation of distinct findings representing materially different provisions
// =========================================================================

test("auto-renewal grounding: preserves distinct findings for materially different provisions", () => {
  const seg1 = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Enterprise Platform Subscription will renew automatically on an annual basis unless cancelled 60 days prior to renewal."
  };

  const seg2 = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Support Tier Add-On will continue to bill your payment method on a recurring basis monthly until cancelled."
  };

  const analyzer = new RuleAnalyzer();
  const findings = analyzer.analyzeSegments([seg1, seg2]);

  // Both distinct provisions must be preserved
  assert.equal(findings.length, 2);
  assert.equal(findings[0].title, "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(findings[1].title, "Automatic Subscription Renewal");
  assert.notEqual(findings[0].evidence, findings[1].evidence);
});

// =========================================================================
// 6. Evidence and explanation consistency
// =========================================================================

test("auto-renewal grounding: guarantees strict consistency between evidence content and explanation", () => {
  const testCases = [
    {
      text: "You can optionally set up recurring payments using our autopay tool.",
      expectedTitle: "Optional Recurring Payment Feature",
      expectedSeverity: "LOW",
      forbiddenExplanationPhrases: ["unless you cancel", "deadline", "penalty"]
    },
    {
      text: "Your membership will renew automatically every month until cancelled.",
      expectedTitle: "Automatic Subscription Renewal",
      expectedSeverity: "MEDIUM",
      forbiddenExplanationPhrases: ["specified deadline", "advance notice window"]
    },
    {
      text: "The plan will automatically renew unless advance notice of cancellation is given 48 hours before cutoff.",
      expectedTitle: "Automatic Subscription Renewal with Cancellation Restrictions",
      expectedSeverity: "HIGH",
      requiredExplanationPhrases: ["deadline", "advance notice"]
    }
  ];

  for (const tc of testCases) {
    const findings = analyzeSegment({ segmentIndex: 0, pageNumber: 1, text: tc.text });
    assert.equal(findings.length, 1, `Failed to analyze: ${tc.text}`);
    const f = findings[0];

    assert.equal(f.title, tc.expectedTitle);
    assert.equal(f.severity, tc.expectedSeverity);

    if (tc.forbiddenExplanationPhrases) {
      for (const phrase of tc.forbiddenExplanationPhrases) {
        assert.doesNotMatch(f.explanation.toLowerCase(), new RegExp(phrase, "i"));
      }
    }

    if (tc.requiredExplanationPhrases) {
      for (const phrase of tc.requiredExplanationPhrases) {
        assert.match(f.explanation.toLowerCase(), new RegExp(phrase, "i"));
      }
    }
  }
});

// =========================================================================
// 7. Jurisdiction-sensitive compliance messaging
// =========================================================================

test("auto-renewal grounding: accurately infers India jurisdiction and generates applicability notice when audited under US Federal", () => {
  const googlePayUrl = "https://pay.google.com/intl/en_in/about/terms/";
  const samplePolicyText = `
    GOOGLE PAY TERMS OF SERVICE FOR INDIA RESIDENTS
    These terms are governed by the laws of India and subject to the exclusive jurisdiction of courts in New Delhi.
    Autopay is an NPCI supported UPI feature under Reserve Bank of India guidelines.
  `;

  // 1. Inferred jurisdiction must be IN_CONSUMER
  const inferred = inferDocumentJurisdiction(googlePayUrl, samplePolicyText);
  assert.ok(inferred);
  assert.equal(inferred.id, "IN_CONSUMER");
  assert.equal(inferred.region, "IN");

  // 2. When audited against US_FEDERAL, an applicability notice is produced
  const audit = auditStatutoryCompliance({
    findings: [],
    jurisdiction: "US_FEDERAL",
    sourceUrl: googlePayUrl,
    policyText: samplePolicyText
  });

  assert.equal(audit.jurisdiction, "US_FEDERAL");
  assert.equal(audit.inferredJurisdiction, "IN_CONSUMER");
  assert.ok(audit.applicabilityNotice);
  assert.match(audit.applicabilityNotice, /governed by India/i);
  assert.match(audit.applicabilityNotice, /Evaluated against United States/i);

  // 3. Confirms statutory alerts are labeled as regulatory standards, not verified legal violations
  assert.ok(audit.regulatoryNotice);
  assert.match(audit.regulatoryNotice, /do not constitute verified legal violations/i);
});

test("auto-renewal grounding: IN_CONSUMER jurisdiction profile is registered in JURISDICTIONS", () => {
  assert.ok(JURISDICTIONS.IN_CONSUMER);
  assert.equal(JURISDICTIONS.IN_CONSUMER.id, "IN_CONSUMER");
  assert.equal(JURISDICTIONS.IN_CONSUMER.region, "IN");
});

// =========================================================================
// 8. Regression Suite: Automatic Subscription Renewal Classification Audit
// =========================================================================

// Test 1: Optional Autopay remains LOW
test("regression 1: optional Autopay remains LOW severity", () => {
  const segment = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using Autopay."
  };
  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Optional Recurring Payment Feature");
  assert.equal(findings[0].severity, "LOW");
  assert.equal(findings[0].categoryId, "AUTO_RENEWAL");
  assert.match(findings[0].explanation, /optional recurring payment feature/i);
});

// Test 2: Mandatory automatic renewal is detected
test("regression 2: mandatory automatic renewal is detected as MEDIUM severity", () => {
  const segment = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Your subscription will automatically renew at the end of each billing cycle unless you cancel."
  };
  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Automatic Subscription Renewal");
  assert.equal(findings[0].severity, "MEDIUM");
  assert.equal(findings[0].categoryId, "AUTO_RENEWAL");
  assert.match(findings[0].explanation, /renews automatically on a recurring billing cycle/i);
});

// Test 3: A specified cancellation deadline triggers the correct existing severity classification (HIGH)
test("regression 3: specified cancellation deadline triggers HIGH severity classification", () => {
  const segment = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Your subscription automatically renews unless you cancel before the specified deadline."
  };
  const findings = analyzeSegment(segment);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(findings[0].severity, "HIGH");
  assert.equal(findings[0].categoryId, "AUTO_RENEWAL");
  assert.match(findings[0].explanation, /specified deadline or advance notice window/i);
});

// Test 4: Standalone cancellation deadlines are detected
test("regression 4: standalone cancellation deadlines are detected as cancellation restrictions", () => {
  const exampleA = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "You must cancel at least 30 days before renewal."
  };
  const findingsA = analyzeSegment(exampleA);
  assert.equal(findingsA.length, 1);
  assert.equal(findingsA[0].title, "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(findingsA[0].severity, "HIGH");
  assert.equal(findingsA[0].categoryId, "AUTO_RENEWAL");
  assert.match(findingsA[0].explanation, /mandatory cancellation deadline or advance notice requirement/i);

  const exampleB = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Notice of cancellation must be received 14 days prior to the expiration of the term."
  };
  const findingsB = analyzeSegment(exampleB);
  assert.equal(findingsB.length, 1);
  assert.equal(findingsB[0].title, "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(findingsB[0].severity, "HIGH");
  assert.equal(findingsB[0].categoryId, "AUTO_RENEWAL");
  assert.match(findingsB[0].explanation, /mandatory cancellation deadline or advance notice requirement/i);
});

// Test 5: Duplicate optional Autopay findings are collapsed
test("regression 5: duplicate substantive optional Autopay findings are collapsed into one representative finding", () => {
  const seg1 = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Autopay on Bill Payments. You may choose to set up recurring payments of Your bill payment account or recharge of prepaid service using Autopay."
  };
  const seg2 = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Autopay is an optional recurring payments feature that allows users to configure automated bill payments."
  };
  const analyzer = new RuleAnalyzer();
  const findings = analyzer.analyzeSegments([seg1, seg2]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Optional Recurring Payment Feature");
  assert.equal(findings[0].severity, "LOW");
  assert.match(findings[0].evidence, /You may choose to set up recurring payments/i);
});

// Test 6: Distinct mandatory renewal or cancellation restrictions are not incorrectly removed
test("regression 6: distinct mandatory renewal or cancellation restrictions are not incorrectly removed", () => {
  const seg1 = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Enterprise Platform Subscription will renew automatically on an annual basis unless cancelled 60 days prior to renewal."
  };
  const seg2 = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "Support Tier Add-On will continue to bill your payment method on a recurring basis monthly until cancelled."
  };
  const seg3 = {
    segmentIndex: 2,
    pageNumber: 1,
    text: "Autopay on Bill Payments. You may choose to set up recurring payments of Your bill payment account using Autopay."
  };
  const seg4 = {
    segmentIndex: 3,
    pageNumber: 1,
    text: "Notice of cancellation must be received 14 days prior to the expiration of the term."
  };

  const analyzer = new RuleAnalyzer();
  const findings = analyzer.analyzeSegments([seg1, seg2, seg3, seg4]);

  // All 4 distinct provisions must be preserved
  assert.equal(findings.length, 4);

  const titles = findings.map(f => f.title);
  assert.ok(titles.includes("Optional Recurring Payment Feature"));
  assert.ok(titles.includes("Automatic Subscription Renewal"));
  const restrictiveFindings = findings.filter(f => f.title === "Automatic Subscription Renewal with Cancellation Restrictions");
  assert.equal(restrictiveFindings.length, 2);
});

// Test 7: Existing unrelated clause classifications remain unchanged
test("regression 7: existing unrelated clause classifications remain unchanged and unrelated deadlines are not matched", () => {
  const arbSeg = {
    segmentIndex: 0,
    pageNumber: 1,
    text: "Any dispute, claim or controversy arising out of this agreement shall be settled through binding arbitration."
  };
  const arbFindings = analyzeSegment(arbSeg);
  assert.equal(arbFindings.length, 1);
  assert.equal(arbFindings[0].title, "Mandatory Arbitration Clause");
  assert.equal(arbFindings[0].severity, "HIGH");

  const govSeg = {
    segmentIndex: 1,
    pageNumber: 1,
    text: "California law will govern these terms and all disputes arising out of or relating to these terms."
  };
  const govFindings = analyzeSegment(govSeg);
  assert.equal(govFindings.length, 1);
  assert.equal(govFindings[0].title, "Governing Law Specification");

  // Benign unrelated use of "deadline" or "cancellation" must not be matched as AUTO_RENEWAL
  const benignDeadlineSeg = {
    segmentIndex: 2,
    pageNumber: 1,
    text: "The deadline for submitting bug bounty reports for this cycle is October 31st."
  };
  const benignDeadlineFindings = analyzeSegment(benignDeadlineSeg);
  assert.equal(benignDeadlineFindings.filter(f => f.categoryId === "AUTO_RENEWAL").length, 0);

  const benignCancelSeg = {
    segmentIndex: 3,
    pageNumber: 1,
    text: "You may request cancellation of pending orders before fulfillment by contacting customer support."
  };
  const benignCancelFindings = analyzeSegment(benignCancelSeg);
  assert.equal(benignCancelFindings.filter(f => f.categoryId === "AUTO_RENEWAL").length, 0);
});

// Test 8: Text mentioning recurring payments without establishing renewal produces 0 renewal findings
test("regression 8: text mentioning recurring payments without establishing renewal produces 0 renewal findings", () => {
  const benignCases = [
    "We accept recurring payments and one-time payments via credit card or UPI.",
    "The payment gateway processes recurring payments on behalf of merchants.",
    "Billing methods include credit card, debit card, and recurring payments.",
    "Users may view transaction history for one-time or recurring payments in their dashboard."
  ];

  for (const text of benignCases) {
    const findings = analyzeSegment({ segmentIndex: 0, pageNumber: 1, text });
    const renewalFindings = findings.filter(f => f.categoryId === "AUTO_RENEWAL");
    assert.equal(renewalFindings.length, 0, `Expected 0 renewal findings for: "${text}"`);
  }
});

// Test 9: Various optional recurring-payment phrasing remains LOW severity
test("regression 9: various optional recurring-payment phrasing remains LOW severity", () => {
  const optionalCases = [
    "Users can choose to set up recurring payments for monthly donations.",
    "Customers may choose to set up recurring payments using Autopay.",
    "You have the option to configure recurring payments for utility bills.",
    "You may choose to set up recurring payments of your bill payment account using Autopay."
  ];

  for (const text of optionalCases) {
    const findings = analyzeSegment({ segmentIndex: 0, pageNumber: 1, text });
    assert.equal(findings.length, 1, `Expected 1 finding for: "${text}"`);
    assert.equal(findings[0].title, "Optional Recurring Payment Feature");
    assert.equal(findings[0].severity, "LOW");
    assert.equal(findings[0].categoryId, "AUTO_RENEWAL");
    assert.doesNotMatch(findings[0].explanation, /subscription will renew automatically/i);
    assert.doesNotMatch(findings[0].explanation, /cancel before/i);
    assert.match(findings[0].explanation, /optional recurring payment feature/i);
  }
});

// Test 10: Optional Autopay receives Low impact under default preferences
test("regression 10: Optional Autopay receives Low impact under default preferences and Medium under max preference", () => {
  const optionalAutopay = {
    title: "Optional Recurring Payment Feature",
    categoryId: "AUTO_RENEWAL",
    severity: "LOW",
    confidence: 0.93,
    evidence: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using Autopay."
  };

  // 1. Under default AUTO_RENEWAL preference weight (4), impact is Low
  assert.equal(calculateImpactMagnitude(optionalAutopay, 4), IMPACT_LEVELS.LOW);

  // 2. Under standard default weight (3), impact is Low
  assert.equal(calculateImpactMagnitude(optionalAutopay, 3), IMPACT_LEVELS.LOW);

  // 3. Under reduced weight (1 or 2), impact is Low
  assert.equal(calculateImpactMagnitude(optionalAutopay, 1), IMPACT_LEVELS.LOW);
  assert.equal(calculateImpactMagnitude(optionalAutopay, 2), IMPACT_LEVELS.LOW);

  // 4. Under explicitly configured max preference (5), impact is elevated to Medium, but NEVER High or Critical
  const maxImpact = calculateImpactMagnitude(optionalAutopay, 5);
  assert.equal(maxImpact, IMPACT_LEVELS.MEDIUM);
  assert.notEqual(maxImpact, IMPACT_LEVELS.HIGH);
  assert.notEqual(maxImpact, IMPACT_LEVELS.CRITICAL);

  // 5. Genuine automatic renewals retain appropriate high impact levels
  const genuineRenewal = {
    title: "Automatic Subscription Renewal",
    categoryId: "AUTO_RENEWAL",
    severity: "HIGH",
    confidence: 0.95
  };
  assert.equal(calculateImpactMagnitude(genuineRenewal, 4), IMPACT_LEVELS.HIGH);
  assert.equal(calculateImpactMagnitude(genuineRenewal, 5), IMPACT_LEVELS.CRITICAL);

  // 6. Existing unrelated LOW findings are not globally forced to Low
  const standardLowFinding = {
    title: "Governing Law Specification",
    categoryId: "GOVERNING_LAW",
    severity: "LOW",
    confidence: 0.95
  };
  // Composite score: 2 * 4 * 0.99 = 7.92 >= 6 (Medium)
  assert.equal(calculateImpactMagnitude(standardLowFinding, 4), IMPACT_LEVELS.MEDIUM);
});

// Test 11: Optional Autopay cannot generate a subscription-cancellation notice
test("regression 11: Optional Autopay cannot generate a subscription-cancellation notice", () => {
  // Direct call with findingTitle
  assert.throws(
    () => {
      generateOptOutNotice({
        noticeType: "AUTO_RENEWAL",
        findingTitle: "Optional Recurring Payment Feature",
        clauseEvidence: "You may choose to set up recurring payments of your bill payment account using Autopay."
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Subscription cancellation notices cannot be generated for optional recurring payment features/i);
      return true;
    }
  );

  // Direct call with voluntary Autopay evidence
  assert.throws(
    () => {
      generateOptOutNotice({
        noticeType: "SUBSCRIPTION_CANCELLATION",
        clauseEvidence: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using Autopay."
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Enrollment is voluntary and does not constitute a mandatory automatic subscription renewal/i);
      return true;
    }
  );

  // Genuine automatic renewal succeeds
  const genuineNotice = generateOptOutNotice({
    noticeType: "AUTO_RENEWAL",
    companyName: "CloudService Corp",
    clauseEvidence: "Your subscription automatically renews at the end of each billing period unless you cancel."
  });
  assert.equal(genuineNotice.noticeType, NOTICE_TYPES.SUBSCRIPTION_CANCELLATION);
  assert.ok(genuineNotice.body.includes("CloudService Corp"));
  assert.ok(genuineNotice.body.includes("revoke any and all ongoing authorizations"));
});

// Test 12: UI card actions (Propose Amendment and Draft Opt-Out) are completely removed from app.js
test("regression 12: UI card actions (Propose Amendment and Draft Opt-Out) are removed from app.js", () => {
  const appJsPath = path.resolve(__dirname, "../../frontend/public/app.js");
  const appJsCode = fs.readFileSync(appJsPath, "utf8");

  assert.ok(
    !appJsCode.includes("btn-action-amendment"),
    "app.js must not contain btn-action-amendment"
  );
  assert.ok(
    !appJsCode.includes("btn-action-optout"),
    "app.js must not contain btn-action-optout"
  );
});

// Test 13: Appropriate restrictive clauses still support proposed amendments
test("regression 13: Appropriate restrictive clauses still support proposed amendments", () => {
  // 1. Genuine renewal amendment
  const renewalProposal = generateAmendmentProposal({
    categoryId: "AUTO_RENEWAL",
    clauseText: "Subscriptions renew automatically unless cancelled 30 days prior.",
    companyName: "TestCorp",
    userName: "Alice"
  });
  assert.ok(renewalProposal.title.includes("Fair Billing"));
  assert.ok(renewalProposal.proposedAmendment.includes("electronic renewal reminder"));
  assert.ok(renewalProposal.redline);

  // 2. Arbitration amendment
  const arbProposal = generateAmendmentProposal({
    categoryId: "ARBITRATION",
    clauseText: "All claims shall be settled by binding individual arbitration.",
    companyName: "Acme",
    userName: "Bob"
  });
  assert.ok(arbProposal.title.includes("Dispute Resolution"));
  assert.ok(arbProposal.proposedAmendment.includes("court of competent jurisdiction"));

  // 3. Content licensing amendment
  const contentProposal = generateAmendmentProposal({
    categoryId: "USER_CONTENT_RIGHTS",
    clauseText: "You grant us a perpetual, irrevocable, worldwide license to user content.",
    companyName: "MediaHub",
    userName: "Charlie"
  });
  assert.ok(contentProposal.title.includes("Content Licensing") || contentProposal.title.includes("License"));
  assert.ok(contentProposal.proposedAmendment.includes("retains all copyright"));
});

// Test 14: Existing unrelated findings and user-preference behavior remain unchanged
test("regression 14: Existing unrelated findings and user-preference behavior remain unchanged", () => {
  // Arbitration finding with weight 5 evaluates to Critical
  const arbFinding = {
    title: "Mandatory Arbitration",
    categoryId: "ARBITRATION",
    severity: "HIGH",
    confidence: 0.95
  };
  assert.equal(calculateImpactMagnitude(arbFinding, 5), IMPACT_LEVELS.CRITICAL);
  assert.equal(calculateImpactMagnitude(arbFinding, 4), IMPACT_LEVELS.HIGH);
  assert.equal(calculateImpactMagnitude(arbFinding, 1), IMPACT_LEVELS.LOW);

  // Data sharing finding with weight 3 evaluates to High/Medium
  const dataFinding = {
    title: "Third-Party Data Sharing",
    categoryId: "PRIVACY_DATA_SHARING",
    severity: "HIGH",
    confidence: 0.85
  };
  assert.equal(calculateImpactMagnitude(dataFinding, 3), IMPACT_LEVELS.HIGH);
});

