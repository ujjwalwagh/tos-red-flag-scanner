import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { evaluatePortfolioRisk, PORTFOLIO_DISCLAIMER } from "../src/portfolio/portfolio-engine.js";
import { compareVendors, COMPARATOR_DISCLAIMER } from "../src/portfolio/vendor-comparator.js";
import { calculatePolicyDrift, SENTINEL_DISCLAIMER } from "../src/sentinel/drift-engine.js";
import { snapshotStore } from "../src/sentinel/snapshot-store.js";
import {
  auditStatutoryCompliance,
  resolveJurisdiction,
  COMPLIANCE_DISCLAIMER
} from "../src/compliance/statutory-auditor.js";
import { JURISDICTIONS } from "../src/compliance/statutory-rules.js";
import { analyzeDocument } from "../src/architecture/pipeline/analysis-pipeline.js";

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
// 1. Portfolio Risk Aggregator Unit Tests
// =========================================================================

test("evaluatePortfolioRisk computes stack risk score and portfolio health", () => {
  const vendors = [
    {
      vendorName: "StrictCloud",
      analysis: {
        rankedFindings: [
          { categoryId: "ARBITRATION", severity: "HIGH" },
          { categoryId: "CLASS_ACTION_WAIVER", severity: "HIGH" }
        ],
        benchmarks: { restrictivenessScore: 80 }
      }
    },
    {
      vendorName: "FairApp",
      analysis: {
        rankedFindings: [
          { categoryId: "LIABILITY_LIMITATION", severity: "LOW" }
        ],
        benchmarks: { restrictivenessScore: 20 }
      }
    }
  ];

  const result = evaluatePortfolioRisk({ portfolioName: "DevStack", vendors });

  assert.equal(result.portfolioName, "DevStack");
  assert.equal(result.totalVendors, 2);
  assert.equal(result.aggregateStackScore, 50);
  assert.ok(result.vendorRankings.length === 2);
  assert.equal(result.vendorRankings[0].vendorName, "FairApp");
  assert.equal(result.vendorRankings[1].vendorName, "StrictCloud");
  assert.equal(result.disclaimer, PORTFOLIO_DISCLAIMER);
});

test("evaluatePortfolioRisk identifies systemic risk concentrations", () => {
  const vendors = [
    { vendorName: "Vendor A", analysis: { rankedFindings: [{ categoryId: "ARBITRATION", severity: "HIGH" }] } },
    { vendorName: "Vendor B", analysis: { rankedFindings: [{ categoryId: "ARBITRATION", severity: "HIGH" }] } },
    { vendorName: "Vendor C", analysis: { rankedFindings: [{ categoryId: "USER_CONTENT_RIGHTS", severity: "LOW" }] } }
  ];

  const result = evaluatePortfolioRisk({ vendors });
  assert.ok(result.systemicExposures.length > 0);
  const arbExposure = result.systemicExposures.find(e => e.domainKey === "disputeResolution");
  assert.ok(arbExposure);
  assert.equal(arbExposure.affectedCount, 2);
  assert.equal(arbExposure.totalVendors, 3);
});

test("evaluatePortfolioRisk throws 400 for empty vendor list", () => {
  assert.throws(() => evaluatePortfolioRisk({ vendors: [] }), {
    statusCode: 400
  });
});

// =========================================================================
// 2. Vendor Comparator Unit Tests
// =========================================================================

test("compareVendors builds aligned category matrix and recommends lowest-risk vendor", () => {
  const vendorAnalyses = [
    {
      vendorName: "Vendor Alpha",
      analysis: {
        rankedFindings: [
          { categoryId: "ARBITRATION", severity: "HIGH", explanation: "Mandatory binding arbitration." },
          { categoryId: "UNILATERAL_CHANGES", severity: "HIGH", explanation: "May modify at any time." }
        ]
      }
    },
    {
      vendorName: "Vendor Beta",
      analysis: {
        rankedFindings: [
          { categoryId: "LIABILITY_LIMITATION", severity: "LOW", explanation: "Standard liability cap." }
        ]
      }
    }
  ];

  const result = compareVendors(vendorAnalyses);

  assert.equal(result.vendors.length, 2);
  assert.equal(result.recommendedVendor, "Vendor Beta");
  assert.ok(result.categoryMatrix.ARBITRATION);
  assert.equal(result.categoryMatrix.ARBITRATION.vendorEntries["Vendor Alpha"].status, "FLAGGED");
  assert.equal(result.categoryMatrix.ARBITRATION.vendorEntries["Vendor Beta"].status, "NOT_DETECTED");
  assert.equal(result.disclaimer, COMPARATOR_DISCLAIMER);
});

test("compareVendors enforces vendor bounds (2 to 5 vendors)", () => {
  assert.throws(() => compareVendors([{ vendorName: "OnlyOne" }]), { statusCode: 400 });
  assert.throws(() => compareVendors([{}, {}, {}, {}, {}, {}]), { statusCode: 400 });
});

// =========================================================================
// 3. Policy Drift ("Sentinel") Unit Tests
// =========================================================================

test("calculatePolicyDrift detects newly introduced restrictions", async () => {
  const result = await calculatePolicyDrift({
    vendorName: "TestCorp",
    baseVersion: {
      versionLabel: "2024 Terms",
      findings: []
    },
    currentVersion: {
      versionLabel: "2026 Terms",
      findings: [
        { categoryId: "ARBITRATION", severity: "HIGH", evidence: "All disputes must be arbitrated." }
      ]
    }
  });

  assert.equal(result.vendorName, "TestCorp");
  assert.equal(result.driftDirection, "MORE_RESTRICTIVE");
  assert.equal(result.newRestrictions.length, 1);
  assert.equal(result.newRestrictions[0].categoryId, "ARBITRATION");
  assert.equal(result.disclaimer, SENTINEL_DISCLAIMER);
});

test("snapshotStore saves, retrieves, and clears version snapshots", () => {
  snapshotStore.clear("TestVendor");
  snapshotStore.saveSnapshot("TestVendor", { versionLabel: "v1.0", policyText: "Version 1 text" });
  snapshotStore.saveSnapshot("TestVendor", { versionLabel: "v2.0", policyText: "Version 2 text" });

  const snapshots = snapshotStore.getSnapshots("TestVendor");
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].versionLabel, "v1.0");
  assert.equal(snapshots[1].versionLabel, "v2.0");

  snapshotStore.clear("TestVendor");
  assert.equal(snapshotStore.getSnapshots("TestVendor").length, 0);
});

// =========================================================================
// 4. Statutory Compliance Auditor Unit Tests
// =========================================================================

test("auditStatutoryCompliance flags arbitration as unenforceable under EU and UK law", () => {
  const findings = [
    { categoryId: "ARBITRATION", severity: "HIGH", evidence: "Mandatory binding arbitration required." }
  ];

  const euAudit = auditStatutoryCompliance({ findings, jurisdiction: "EU_GDPR" });
  assert.equal(euAudit.jurisdiction, "EU_GDPR");
  assert.equal(euAudit.unenforceableClausesCount, 1);
  assert.ok(euAudit.statutoryAlerts[0].statutoryCitation.includes("93/13/EEC"));
  assert.equal(euAudit.disclaimer, COMPLIANCE_DISCLAIMER);

  const ukAudit = auditStatutoryCompliance({ findings, jurisdiction: "UK_CRA" });
  assert.equal(ukAudit.unenforceableClausesCount, 1);
  assert.ok(ukAudit.statutoryAlerts[0].statutoryCitation.includes("Consumer Rights Act 2015"));
});

test("auditStatutoryCompliance flags auto-renewal requirements under California law", () => {
  const findings = [
    { categoryId: "AUTO_RENEWAL", severity: "HIGH", evidence: "Renews automatically without notice." }
  ];

  const caAudit = auditStatutoryCompliance({ findings, jurisdiction: "US_CALIFORNIA" });
  assert.equal(caAudit.jurisdiction, "US_CALIFORNIA");
  assert.ok(caAudit.statutoryAlerts[0].statutoryCitation.includes("Cal. Bus. & Prof. Code"));
});

test("resolveJurisdiction normalizes aliases to canonical jurisdiction profiles", () => {
  assert.equal(resolveJurisdiction("california").id, "US_CALIFORNIA");
  assert.equal(resolveJurisdiction("EU").id, "EU_GDPR");
  assert.equal(resolveJurisdiction("UK").id, "UK_CRA");
  assert.equal(resolveJurisdiction("federal").id, "US_FEDERAL");
});

// =========================================================================
// 5. Analysis Pipeline Integration
// =========================================================================

test("analyzeDocument includes compliance evaluation in output envelope", async () => {
  const sampleDoc = {
    metadata: { filename: "sample.pdf", pageCount: 1 },
    pages: [{ pageNumber: 1, text: "All disputes must be settled by individual binding arbitration." }]
  };

  const analysis = await analyzeDocument(sampleDoc, { jurisdiction: "EU_GDPR" });
  assert.ok(analysis.compliance);
  assert.equal(analysis.compliance.jurisdiction, "EU_GDPR");
  assert.ok(analysis.compliance.statutoryAlerts);
  assert.ok(analysis.benchmarks);
  assert.ok(analysis.checklist);
});

// =========================================================================
// 6. Live HTTP API Integration Tests
// =========================================================================

test("POST /api/portfolio/evaluate aggregates multiple vendor analyses", async () => {
  const res = await fetch(`${baseUrl}/api/portfolio/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portfolioName: "Engineering Stack",
      vendors: [
        { vendorName: "Tool A", analysis: { rankedFindings: [{ categoryId: "ARBITRATION", severity: "HIGH" }] } },
        { vendorName: "Tool B", analysis: { rankedFindings: [] } }
      ]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.portfolio.portfolioName, "Engineering Stack");
  assert.equal(data.portfolio.totalVendors, 2);
  assert.ok(data.portfolio.aggregateStackScore >= 0);
});

test("POST /api/portfolio/compare produces aligned vendor matrix", async () => {
  const res = await fetch(`${baseUrl}/api/portfolio/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendors: [
        { vendorName: "Slack", analysis: { rankedFindings: [] } },
        { vendorName: "Discord", analysis: { rankedFindings: [{ categoryId: "ARBITRATION", severity: "HIGH" }] } }
      ]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.comparison.recommendedVendor, "Slack");
  assert.ok(data.comparison.categoryMatrix);
});

test("POST /api/sentinel/drift evaluates chronological policy changes", async () => {
  const res = await fetch(`${baseUrl}/api/sentinel/drift`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorName: "CloudApp",
      baseVersion: { versionLabel: "v1", policyText: "We respect user privacy." },
      currentVersion: { versionLabel: "v2", policyText: "We may share user data with third party advertising partners." }
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.drift);
  assert.equal(data.drift.vendorName, "CloudApp");
});

test("POST /api/sentinel/snapshot and GET /api/sentinel/snapshots/:vendorName work", async () => {
  const postRes = await fetch(`${baseUrl}/api/sentinel/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorName: "AcmeLive",
      versionLabel: "v1.0",
      policyText: "Sample text"
    })
  });
  assert.equal(postRes.status, 200);

  const getRes = await fetch(`${baseUrl}/api/sentinel/snapshots/AcmeLive`);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.success, true);
  assert.ok(getData.snapshots.length >= 1);
});

test("POST /api/compliance/audit evaluates findings against target jurisdiction", async () => {
  const res = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      findings: [{ categoryId: "ARBITRATION", severity: "HIGH" }],
      jurisdiction: "EU_GDPR"
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.compliance.jurisdiction, "EU_GDPR");
  assert.ok(data.compliance.statutoryAlerts.length > 0);
});

test("GET /api/compliance/jurisdictions returns all supported jurisdictions", async () => {
  const res = await fetch(`${baseUrl}/api/compliance/jurisdictions`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.jurisdictions.length >= 4);
});
