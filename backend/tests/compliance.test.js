import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
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
// 1. Statutory Compliance Auditor Unit Tests
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
// 2. Analysis Pipeline Integration
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
// 3. Live HTTP API Integration Tests
// =========================================================================

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
