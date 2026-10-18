import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import {
  generateOptOutNotice,
  resolveNoticeType,
  NOTICE_TYPES,
  LEGAL_DISCLAIMER
} from "../src/remediation/optout-generator.js";
import {
  generateActionChecklist,
  CHECKLIST_URGENCY
} from "../src/remediation/checklist-generator.js";
import {
  exportReport,
  exportMarkdownReport,
  exportJsonReport,
  exportHtmlReport,
  EXPORT_FORMATS
} from "../src/reporting/report-exporter.js";

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

// =========================================================================
// 1. Opt-Out Generator Unit Tests
// =========================================================================

test("resolveNoticeType resolves categories and keywords to appropriate NOTICE_TYPES", () => {
  assert.equal(resolveNoticeType("ARBITRATION"), NOTICE_TYPES.ARBITRATION_OPT_OUT);
  assert.equal(resolveNoticeType("CLASS_ACTION_WAIVER"), NOTICE_TYPES.ARBITRATION_OPT_OUT);
  assert.equal(resolveNoticeType("PRIVACY_DATA_SHARING"), NOTICE_TYPES.DATA_SHARING_RESTRICTION);
  assert.equal(resolveNoticeType("AUTO_RENEWAL"), NOTICE_TYPES.SUBSCRIPTION_CANCELLATION);
  assert.equal(resolveNoticeType("UNILATERAL_CHANGES"), NOTICE_TYPES.GENERAL_RIGHTS_RESERVATION);
});

test("generateOptOutNotice creates Arbitration letter with default placeholders", () => {
  const notice = generateOptOutNotice({
    noticeType: "ARBITRATION",
    companyName: "Acme Cloud Services",
    clauseEvidence: "Disputes must be submitted to individual binding arbitration."
  });

  assert.equal(notice.noticeType, NOTICE_TYPES.ARBITRATION_OPT_OUT);
  assert.ok(notice.subject.includes("MANDATORY ARBITRATION"));
  assert.ok(notice.body.includes("Acme Cloud Services"));
  assert.ok(notice.body.includes("[Your Full Legal Name]"));
  assert.ok(notice.body.includes("Disputes must be submitted to individual binding arbitration."));
  assert.ok(notice.deliveryInstructions.some((i) => i.includes("Certified Mail")));
  assert.equal(notice.disclaimer, LEGAL_DISCLAIMER);
});

test("generateOptOutNotice populates custom user metadata", () => {
  const notice = generateOptOutNotice({
    noticeType: "ARBITRATION",
    companyName: "StreamHub Inc",
    effectiveDate: "2026-10-15",
    userMetadata: {
      userName: "Jane Developer",
      userEmail: "jane.dev@example.org",
      accountNumber: "USR-998811",
      mailingAddress: "123 Tech Boulevard, Austin, TX"
    }
  });

  assert.ok(notice.body.includes("Jane Developer"));
  assert.ok(notice.body.includes("jane.dev@example.org"));
  assert.ok(notice.body.includes("USR-998811"));
  assert.ok(notice.body.includes("123 Tech Boulevard, Austin, TX"));
  assert.ok(notice.body.includes("October 15, 2026"));
});

test("generateOptOutNotice creates Data Sharing Restriction request", () => {
  const notice = generateOptOutNotice({
    noticeType: "DATA_SHARING",
    companyName: "AdBroker Network",
    clauseEvidence: "We share identifiers with third-party advertising exchanges.",
    userMetadata: {
      userName: "John Smith",
      userEmail: "john@example.com"
    }
  });

  assert.equal(notice.noticeType, NOTICE_TYPES.DATA_SHARING_RESTRICTION);
  assert.ok(notice.body.includes("CCPA/CPRA, GDPR"));
  assert.ok(notice.body.includes("AdBroker Network"));
  assert.ok(notice.body.includes("john@example.com"));
});

test("generateOptOutNotice creates Subscription Cancellation letter", () => {
  const notice = generateOptOutNotice({
    noticeType: "AUTO_RENEWAL",
    companyName: "SaaS Platform Pro",
    clauseEvidence: "Plans automatically renew on the 1st of each month."
  });

  assert.equal(notice.noticeType, NOTICE_TYPES.SUBSCRIPTION_CANCELLATION);
  assert.ok(notice.subject.includes("SUBSCRIPTION CANCELLATION"));
  assert.ok(notice.body.includes("SaaS Platform Pro"));
  assert.ok(notice.body.includes("revoke any and all ongoing authorizations for recurring charges"));
});

test("generateOptOutNotice: throws 400 when invoked for optional recurring payment feature", () => {
  // Case A: Title is "Optional Recurring Payment Feature"
  assert.throws(
    () => {
      generateOptOutNotice({
        noticeType: "AUTO_RENEWAL",
        findingTitle: "Optional Recurring Payment Feature",
        clauseEvidence: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using Autopay."
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /cannot be generated for optional recurring payment/i);
      return true;
    }
  );

  // Case B: Voluntary Autopay evidence without mandatory renewal keywords
  assert.throws(
    () => {
      generateOptOutNotice({
        noticeType: "SUBSCRIPTION_CANCELLATION",
        clauseEvidence: "You may choose to set up recurring payments using Autopay."
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /voluntary and does not constitute a mandatory automatic subscription renewal/i);
      return true;
    }
  );
});

// =========================================================================
// 2. Actionable Checklist Generator Unit Tests
// =========================================================================

test("generateActionChecklist returns empty structure for empty findings", () => {
  const checklist = generateActionChecklist([]);
  assert.equal(checklist.summary.totalItems, 0);
  assert.equal(checklist.items.length, 0);
});

test("generateActionChecklist creates categorized and prioritized action items", () => {
  const rankedFindings = [
    {
      findingId: "F1",
      rank: 1,
      categoryId: "ARBITRATION",
      title: "Mandatory Arbitration",
      impactMagnitude: "Critical",
      evidence: "Binding arbitration required."
    },
    {
      findingId: "F2",
      rank: 2,
      categoryId: "AUTO_RENEWAL",
      title: "Recurring Billing",
      impactMagnitude: "High",
      evidence: "Automatically renews each month."
    },
    {
      findingId: "F3",
      rank: 3,
      categoryId: "PRIVACY_DATA_SHARING",
      title: "Data Sale",
      impactMagnitude: "High",
      evidence: "We sell user data."
    },
    {
      findingId: "F4",
      rank: 4,
      categoryId: "USER_CONTENT_RIGHTS",
      title: "Broad Content License",
      impactMagnitude: "Medium",
      evidence: "Perpetual license to user uploads."
    }
  ];

  const checklist = generateActionChecklist(rankedFindings, { companyName: "OmniCorp" });

  assert.equal(checklist.summary.totalItems, 4);
  assert.equal(checklist.summary.optOutEligibleCount, 3); // Arbitration, Auto-Renewal, Data Sharing

  // Urgency prioritization: IMMEDIATE items first
  const firstItem = checklist.items[0];
  assert.equal(firstItem.urgency, CHECKLIST_URGENCY.IMMEDIATE);
  assert.ok(firstItem.title.includes("Subscription Renewal"));

  // Check 30-Day item exists
  const arbitrationItem = checklist.items.find((i) => i.categoryId === "ARBITRATION");
  assert.ok(arbitrationItem);
  assert.equal(arbitrationItem.urgency, CHECKLIST_URGENCY.DAY_30);
  assert.equal(arbitrationItem.hasRemediationLetter, true);
  assert.equal(arbitrationItem.noticeType, NOTICE_TYPES.ARBITRATION_OPT_OUT);
});

test("generateActionChecklist deduplicates items within same category", () => {
  const duplicateFindings = [
    { rank: 1, categoryId: "ARBITRATION", impactMagnitude: "Critical" },
    { rank: 2, categoryId: "ARBITRATION", impactMagnitude: "High" }
  ];

  const checklist = generateActionChecklist(duplicateFindings);
  assert.equal(checklist.summary.totalItems, 1);
});

test("generateActionChecklist: optional recurring-payment finding alone produces non-immediate advisory item", () => {
  const optionalFinding = [
    {
      findingId: "OPT_1",
      rank: 1,
      categoryId: "AUTO_RENEWAL",
      title: "Optional Recurring Payment Feature",
      severity: "LOW",
      impactMagnitude: "Low",
      evidence: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using AutoPay."
    }
  ];

  const checklist = generateActionChecklist(optionalFinding);
  assert.equal(checklist.summary.totalItems, 1);
  assert.equal(checklist.summary.immediateCount, 0);
  assert.equal(checklist.summary.ongoingCount, 1);
  assert.equal(checklist.summary.optOutEligibleCount, 0);

  const item = checklist.items[0];
  assert.equal(item.urgency, CHECKLIST_URGENCY.ONGOING);
  assert.equal(item.title, "Review Optional Recurring Payment / Autopay Settings");
  assert.doesNotMatch(item.title, /Subscription Renewal Deadline/i);
  assert.doesNotMatch(item.action, /recurring reminder 3 days before/i);
  assert.equal(item.hasRemediationLetter, false);
  assert.equal(item.noticeType, null);
});

test("generateActionChecklist: genuine automatic-renewal with cancellation deadline generates IMMEDIATE reminder", () => {
  const restrictiveRenewal = [
    {
      findingId: "RESTRICT_1",
      rank: 1,
      categoryId: "AUTO_RENEWAL",
      title: "Automatic Subscription Renewal with Cancellation Restrictions",
      severity: "HIGH",
      impactMagnitude: "High",
      evidence: "Your subscription automatically renews unless you cancel at least 30 days prior to the renewal date."
    }
  ];

  const checklist = generateActionChecklist(restrictiveRenewal);
  assert.equal(checklist.summary.totalItems, 1);
  assert.equal(checklist.summary.immediateCount, 1);
  assert.equal(checklist.summary.optOutEligibleCount, 1);

  const item = checklist.items[0];
  assert.equal(item.urgency, CHECKLIST_URGENCY.IMMEDIATE);
  assert.match(item.title, /Strict Subscription Renewal & Cancellation Deadline/i);
  assert.match(item.action, /calendar reminder well ahead of the contractual cancellation cutoff/i);
  assert.equal(item.hasRemediationLetter, true);
  assert.equal(item.noticeType, NOTICE_TYPES.SUBSCRIPTION_CANCELLATION);
});

test("generateActionChecklist: genuine renewal takes precedence over optional feature in checklist", () => {
  const mixedFindings = [
    {
      findingId: "OPT_1",
      rank: 2,
      categoryId: "AUTO_RENEWAL",
      title: "Optional Recurring Payment Feature",
      severity: "LOW",
      impactMagnitude: "Low",
      evidence: "You may choose to set up recurring payments."
    },
    {
      findingId: "RESTRICT_1",
      rank: 1,
      categoryId: "AUTO_RENEWAL",
      title: "Automatic Subscription Renewal with Cancellation Restrictions",
      severity: "HIGH",
      impactMagnitude: "High",
      evidence: "Renews automatically unless cancelled 30 days prior."
    }
  ];

  const checklist = generateActionChecklist(mixedFindings);
  assert.equal(checklist.summary.totalItems, 1);
  assert.equal(checklist.items[0].urgency, CHECKLIST_URGENCY.IMMEDIATE);
  assert.match(checklist.items[0].title, /Subscription Renewal/i);
});

// =========================================================================
// 3. Report Exporter Unit Tests
// =========================================================================

test("exportMarkdownReport produces structured GitHub Flavored Markdown with exact evidence", () => {
  const analysis = {
    documentMetadata: { filename: "test-terms.pdf", wordCount: 1500 },
    summary: { overallRisk: "high", totalFindings: 1 },
    rankedFindings: [
      {
        rank: 1,
        title: "Mandatory Arbitration",
        categoryId: "ARBITRATION",
        categoryDisplayName: "Arbitration & Class Action Waiver",
        impactMagnitude: "Critical",
        userConcernWeight: 5,
        rankingReason: "Highest user concern setting (5/5).",
        evidence: "Disputes shall be settled solely by binding arbitration in Delaware.",
        plainEnglishExplanation: {
          whatItMeans: "You waive court rights.",
          whyItMatters: "Cannot sue in court.",
          whatToWatchFor: "30-day opt-out window."
        }
      }
    ],
    checklist: {
      items: [
        {
          title: "Opt out of Arbitration",
          urgency: "DAY_30",
          action: "Mail letter.",
          details: "Must be done in 30 days.",
          hasRemediationLetter: true
        }
      ]
    }
  };

  const md = exportMarkdownReport(analysis, { documentTitle: "Test Policy" });

  assert.ok(md.includes("# ClauseGuard AI — Terms of Service Risk Audit"));
  assert.ok(md.includes("Test Policy"));
  assert.ok(md.includes("Actionable Pre-Agreement Checklist"));
  assert.ok(md.includes("#1 — Mandatory Arbitration"));
  assert.ok(md.includes("Disputes shall be settled solely by binding arbitration in Delaware."));
  assert.ok(md.includes(LEGAL_DISCLAIMER));
});

test("exportJsonReport produces valid schema conforming to clauseguard-audit-v1.0", () => {
  const analysis = {
    summary: { overallRisk: "high", totalFindings: 1 },
    rankedFindings: [
      {
        rank: 1,
        categoryId: "ARBITRATION",
        severity: "HIGH",
        impactMagnitude: "Critical",
        evidence: "Arbitration clause."
      }
    ]
  };

  const jsonReport = exportJsonReport(analysis, { documentTitle: "SaaS Agreement" });

  assert.equal(jsonReport.schemaVersion, "clauseguard-audit-v1.0");
  assert.equal(jsonReport.documentTitle, "SaaS Agreement");
  assert.ok(Array.isArray(jsonReport.rankedFindings));
  assert.equal(jsonReport.rankedFindings.length, 1);
  assert.equal(jsonReport.disclaimer, LEGAL_DISCLAIMER);
});

test("exportHtmlReport produces printable HTML card with escaped text", () => {
  const analysis = {
    documentMetadata: { filename: "terms<script>.pdf" },
    summary: { overallRisk: "high" },
    rankedFindings: [
      {
        rank: 1,
        title: "Danger <Tag>",
        impactMagnitude: "Critical",
        evidence: "Some <script>alert(1)</script> clause."
      }
    ]
  };

  const html = exportHtmlReport(analysis);

  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("terms&lt;script&gt;.pdf"));
  assert.ok(html.includes("Danger &lt;Tag&gt;"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

// =========================================================================
// 4. API Endpoints Integration Tests (Live Server)
// =========================================================================

test("POST /api/remediation/opt-out generates structured letter", async () => {
  const res = await fetch(`${baseUrl}/api/remediation/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remediationType: "ARBITRATION",
      companyName: "MegaCloud Ltd",
      clauseEvidence: "All claims must be arbitrated individually.",
      userMetadata: {
        userName: "Alex Johnson",
        userEmail: "alex@example.org"
      }
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.notice);
  assert.equal(data.notice.noticeType, NOTICE_TYPES.ARBITRATION_OPT_OUT);
  assert.ok(data.notice.body.includes("Alex Johnson"));
  assert.ok(data.notice.body.includes("MegaCloud Ltd"));
});

test("POST /api/remediation/opt-out returns 400 for missing notice type", async () => {
  const res = await fetch(`${baseUrl}/api/remediation/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("valid 'noticeType'"));
});

test("POST /api/remediation/opt-out: rejects optional recurring payment features with 400", async () => {
  // Test by findingTitle
  const res1 = await fetch(`${baseUrl}/api/remediation/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remediationType: "AUTO_RENEWAL",
      findingTitle: "Optional Recurring Payment Feature",
      companyName: "Google Pay",
      clauseEvidence: "You may choose to set up recurring payments of your bill payment account or recharge of prepaid service using Autopay."
    })
  });

  assert.equal(res1.status, 400);
  const data1 = await res1.json();
  assert.match(data1.error, /optional recurring payment/i);

  // Test by voluntary evidence
  const res2 = await fetch(`${baseUrl}/api/remediation/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remediationType: "AUTO_RENEWAL",
      companyName: "Google Pay",
      clauseEvidence: "Users may choose to set up recurring payments using Autopay."
    })
  });

  assert.equal(res2.status, 400);
  const data2 = await res2.json();
  assert.match(data2.error, /optional recurring payment/i);
});

test("POST /api/remediation/opt-out: generates cancellation notice for genuine automatic renewal", async () => {
  const res = await fetch(`${baseUrl}/api/remediation/opt-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remediationType: "AUTO_RENEWAL",
      companyName: "CloudStreaming Inc",
      clauseEvidence: "Your subscription renews automatically each billing cycle unless you cancel at least 48 hours in advance.",
      userMetadata: {
        userName: "Jordan Lee",
        userEmail: "jordan@example.com"
      }
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.notice);
  assert.equal(data.notice.noticeType, NOTICE_TYPES.SUBSCRIPTION_CANCELLATION);
  assert.ok(data.notice.body.includes("CloudStreaming Inc"));
  assert.ok(data.notice.body.includes("Jordan Lee"));
  assert.ok(data.notice.body.includes("revoke any and all ongoing authorizations for recurring charges"));
});

test("POST /api/remediation/checklist creates checklist from findings", async () => {
  const res = await fetch(`${baseUrl}/api/remediation/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "MediaCorp",
      rankedFindings: [
        {
          rank: 1,
          categoryId: "ARBITRATION",
          impactMagnitude: "Critical",
          evidence: "Arbitration required."
        }
      ]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.checklist);
  assert.equal(data.checklist.summary.totalItems, 1);
});

test("POST /api/export/report generates markdown and json exports", async () => {
  const sampleAnalysis = {
    documentMetadata: { filename: "sample.pdf" },
    summary: { overallRisk: "medium", totalFindings: 1 },
    rankedFindings: [{ rank: 1, title: "Data Sharing", impactMagnitude: "Medium", evidence: "Data shared." }]
  };

  // 1. JSON Export
  const resJson = await fetch(`${baseUrl}/api/export/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis: sampleAnalysis,
      format: "json",
      documentTitle: "Sample Document"
    })
  });
  assert.equal(resJson.status, 200);
  const dataJson = await resJson.json();
  assert.equal(dataJson.success, true);
  assert.equal(dataJson.format, "json");
  assert.equal(dataJson.content.schemaVersion, "clauseguard-audit-v1.0");

  // 2. Markdown Export
  const resMd = await fetch(`${baseUrl}/api/export/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis: sampleAnalysis,
      format: "markdown",
      documentTitle: "Sample Document"
    })
  });
  assert.equal(resMd.status, 200);
  const dataMd = await resMd.json();
  assert.equal(dataMd.success, true);
  assert.equal(dataMd.format, "markdown");
  assert.ok(typeof dataMd.content === "string");
  assert.ok(dataMd.content.includes("ClauseGuard AI"));
});

test("POST /api/export/report returns 400 for unsupported format", async () => {
  const res = await fetch(`${baseUrl}/api/export/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis: {},
      format: "unsupported_xyz"
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("Unsupported export format"));
});

test("POST /api/analyze includes checklist in output envelope", async () => {
  const policyText = `
    Section 1. Arbitration.
    All disputes shall be resolved by binding arbitration. You waive any class action rights.
  `;

  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policyText })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.analysis);
  assert.ok(data.analysis.checklist, "checklist property must exist in analysis output");
  assert.ok(Array.isArray(data.analysis.checklist.items));
  assert.ok(data.analysis.checklist.summary.totalItems > 0);
});
