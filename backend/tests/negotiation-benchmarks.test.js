import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { computeWordDiff } from "../src/negotiation/redline-differ.js";
import {
  generateAmendmentProposal,
  buildContractRider,
  NEGOTIATION_DISCLAIMER
} from "../src/negotiation/amendment-generator.js";
import {
  evaluateDocumentBenchmark,
  BENCHMARK_SECTORS,
  BENCHMARK_DISCLAIMER
} from "../src/benchmarks/benchmark-engine.js";
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
// 1. Redline Differ Unit Tests
// =========================================================================

test("computeWordDiff produces clean equal chunks when texts are identical", () => {
  const text = "Company may terminate this agreement at any time.";
  const diff = computeWordDiff(text, text);

  assert.equal(diff.stats.wordsAdded, 0);
  assert.equal(diff.stats.wordsRemoved, 0);
  assert.ok(diff.stats.wordsUnchanged > 0);
  assert.equal(diff.htmlDiff, `<span class="diff-eq">${text}</span>`);
});

test("computeWordDiff correctly marks deletions and insertions", () => {
  const original = "Company may terminate at any time without notice.";
  const proposed = "Either party may terminate for cause upon 30 days written notice.";
  const diff = computeWordDiff(original, proposed);

  assert.ok(diff.stats.wordsRemoved > 0);
  assert.ok(diff.stats.wordsAdded > 0);
  assert.ok(diff.diffChunks.some(c => c.type === "delete"));
  assert.ok(diff.diffChunks.some(c => c.type === "insert"));
  assert.ok(diff.htmlDiff.includes('<del class="diff-del">'));
  assert.ok(diff.htmlDiff.includes('<ins class="diff-ins">'));
});

test("computeWordDiff gracefully handles empty input strings", () => {
  const diff = computeWordDiff("", "New proposed text");
  assert.equal(diff.stats.wordsRemoved, 0);
  assert.ok(diff.stats.wordsAdded > 0);
  assert.ok(diff.htmlDiff.includes('<ins class="diff-ins">'));
});

// =========================================================================
// 2. Amendment Generator Unit Tests
// =========================================================================

test("generateAmendmentProposal generates balanced proposals for ARBITRATION", () => {
  const proposal = generateAmendmentProposal({
    categoryId: "ARBITRATION",
    clauseText: "All disputes must be submitted to individual binding arbitration.",
    posture: "BALANCED",
    companyName: "Acme SaaS"
  });

  assert.equal(proposal.categoryId, "ARBITRATION");
  assert.equal(proposal.posture, "BALANCED");
  assert.ok(proposal.proposedAmendment.length > 0);
  assert.ok(proposal.redline);
  assert.ok(proposal.redline.htmlDiff);
  assert.ok(proposal.fallbackAlternative.length > 0);
  assert.ok(Array.isArray(proposal.talkingPoints) && proposal.talkingPoints.length > 0);
  assert.equal(proposal.disclaimer, NEGOTIATION_DISCLAIMER);
});

test("generateAmendmentProposal supports postures: AGGRESSIVE, BALANCED, CONSERVATIVE", () => {
  const aggressive = generateAmendmentProposal({
    categoryId: "UNILATERAL_CHANGES",
    clauseText: "We may update these terms at our sole discretion.",
    posture: "AGGRESSIVE"
  });
  const conservative = generateAmendmentProposal({
    categoryId: "UNILATERAL_CHANGES",
    clauseText: "We may update these terms at our sole discretion.",
    posture: "CONSERVATIVE"
  });

  assert.equal(aggressive.posture, "AGGRESSIVE");
  assert.equal(conservative.posture, "CONSERVATIVE");
  assert.ok(aggressive.proposedAmendment.includes("affirmative written agreement"));
  assert.ok(conservative.proposedAmendment.includes("continued use"));
});

test("buildContractRider compiles multiple amendments into formal Markdown document", () => {
  const amendments = [
    {
      categoryId: "ARBITRATION",
      originalClause: "Mandatory binding arbitration is required.",
      proposedAmendment: "Disputes will be resolved in a court of competent jurisdiction."
    },
    {
      categoryId: "UNILATERAL_CHANGES",
      originalClause: "We may modify terms at any time without notice.",
      proposedAmendment: "Material changes require 30 days prior written notice."
    }
  ];

  const rider = buildContractRider(amendments, {
    companyName: "Vendor Corp",
    counterpartyName: "Client LLC",
    agreementTitle: "Master Cloud Services Agreement"
  });

  assert.equal(rider.clauseCount, 2);
  assert.equal(rider.companyName, "Vendor Corp");
  assert.ok(rider.markdown.includes("CONTRACT AMENDMENT RIDER"));
  assert.ok(rider.markdown.includes("Master Cloud Services Agreement"));
  assert.ok(rider.markdown.includes("SECTION 1: DISPUTE RESOLUTION"));
  assert.ok(rider.markdown.includes("SECTION 2: MODIFICATION OF TERMS"));
  assert.ok(rider.markdown.includes("SIGNATURES & EXECUTION"));
  assert.ok(rider.markdown.includes("Vendor Corp"));
  assert.ok(rider.markdown.includes("Client LLC"));
  assert.equal(rider.disclaimer, NEGOTIATION_DISCLAIMER);
});

// =========================================================================
// 3. Benchmark Engine Unit Tests
// =========================================================================

test("evaluateDocumentBenchmark computes scores and sector percentile rank", () => {
  const sampleFindings = [
    { categoryId: "ARBITRATION", severity: "HIGH" },
    { categoryId: "CLASS_ACTION_WAIVER", severity: "HIGH" },
    { categoryId: "LIABILITY_LIMITATION", severity: "MEDIUM" }
  ];

  const result = evaluateDocumentBenchmark({
    findings: sampleFindings,
    sector: BENCHMARK_SECTORS.SAAS_CLOUD
  });

  assert.equal(result.sector, BENCHMARK_SECTORS.SAAS_CLOUD);
  assert.ok(result.restrictivenessScore > 0);
  assert.ok(result.percentileRank >= 0 && result.percentileRank <= 100);
  assert.ok(["Favorable", "Standard", "Restrictive", "High_Risk"].includes(result.relativeStanding));
  assert.ok(result.domainBreakdown.disputeResolution);
  assert.ok(result.domainBreakdown.contentRights);
  assert.ok(result.domainBreakdown.dataPrivacy);
  assert.ok(result.domainBreakdown.billingPractices);
  assert.equal(result.disclaimer, BENCHMARK_DISCLAIMER);
});

test("evaluateDocumentBenchmark detects high risk outliers", () => {
  const sampleFindings = [
    { categoryId: "UNILATERAL_CHANGES", severity: "HIGH" },
    { categoryId: "IP_OWNERSHIP_CONTENT", severity: "HIGH" }
  ];

  const result = evaluateDocumentBenchmark({
    findings: sampleFindings,
    sector: BENCHMARK_SECTORS.SAAS_CLOUD
  });

  assert.ok(result.keyRiskOutliers.length > 0);
  const outlierCats = result.keyRiskOutliers.map(o => o.categoryId);
  assert.ok(outlierCats.includes("UNILATERAL_CHANGES") || outlierCats.includes("IP_OWNERSHIP_CONTENT"));
});

// =========================================================================
// 4. Analysis Pipeline Integration
// =========================================================================

test("analyzeDocument pipeline seamlessly includes benchmark evaluation", async () => {
  const sampleDoc = {
    metadata: { filename: "sample-vendor-agreement.pdf", pageCount: 1 },
    pages: [
      {
        pageNumber: 1,
        text: "You agree that all disputes shall be resolved by binding arbitration. You waive any right to bring a class action. We may modify these terms at any time."
      }
    ]
  };

  const analysis = await analyzeDocument(sampleDoc, { sector: "SAAS_CLOUD" });

  assert.ok(Array.isArray(analysis.findings));
  assert.ok(Array.isArray(analysis.rankedFindings));
  assert.ok(analysis.checklist);
  assert.ok(analysis.benchmarks);
  assert.equal(analysis.benchmarks.sector, BENCHMARK_SECTORS.SAAS_CLOUD);
  assert.ok(analysis.benchmarks.percentileRank >= 0);
  assert.ok(analysis.summary);
});

// =========================================================================
// 5. Live HTTP API Integration Tests
// =========================================================================

test("POST /api/negotiation/amendment generates amendment with diff", async () => {
  const res = await fetch(`${baseUrl}/api/negotiation/amendment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      categoryId: "ARBITRATION",
      clauseText: "Any dispute must be submitted to individual binding arbitration.",
      posture: "BALANCED",
      companyName: "TestCo"
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.amendment);
  assert.equal(data.amendment.categoryId, "ARBITRATION");
  assert.ok(data.amendment.proposedAmendment.length > 0);
  assert.ok(data.amendment.redline.htmlDiff.length > 0);
  assert.ok(data.amendment.talkingPoints.length > 0);
  assert.ok(data.amendment.disclaimer.includes("informational drafting aid"));
});

test("POST /api/negotiation/amendment returns 400 when missing inputs", async () => {
  const res = await fetch(`${baseUrl}/api/negotiation/amendment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("POST /api/negotiation/rider compiles amendments into formal rider", async () => {
  const res = await fetch(`${baseUrl}/api/negotiation/rider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amendments: [
        {
          categoryId: "ARBITRATION",
          originalClause: "Mandatory binding arbitration is required.",
          proposedAmendment: "Disputes will be resolved in federal or state court."
        }
      ],
      companyName: "Acme Corp",
      counterpartyName: "User Corp",
      agreementTitle: "Service Agreement"
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.rider);
  assert.equal(data.rider.clauseCount, 1);
  assert.ok(data.rider.markdown.includes("CONTRACT AMENDMENT RIDER"));
  assert.ok(data.rider.markdown.includes("Acme Corp"));
  assert.ok(data.rider.disclaimer);
});

test("POST /api/negotiation/rider returns 400 when amendments is empty or missing", async () => {
  const res = await fetch(`${baseUrl}/api/negotiation/rider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amendments: [] })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("POST /api/benchmarks/evaluate calculates benchmark standing", async () => {
  const res = await fetch(`${baseUrl}/api/benchmarks/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      findings: [
        { categoryId: "ARBITRATION", severity: "HIGH" },
        { categoryId: "UNILATERAL_CHANGES", severity: "HIGH" }
      ],
      sector: "SAAS_CLOUD"
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.benchmarks);
  assert.equal(data.benchmarks.sector, BENCHMARK_SECTORS.SAAS_CLOUD);
  assert.ok(data.benchmarks.restrictivenessScore > 0);
  assert.ok(data.benchmarks.percentileRank >= 0);
  assert.ok(data.benchmarks.relativeStanding);
  assert.ok(data.benchmarks.domainBreakdown);
});
