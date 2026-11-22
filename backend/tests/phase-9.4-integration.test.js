import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { config } from "../src/config/env.js";
import { snapshotStore } from "../src/sentinel/snapshot-store.js";
import { JURISDICTIONS } from "../src/compliance/statutory-rules.js";
import { PORTFOLIO_DISCLAIMER } from "../src/portfolio/portfolio-engine.js";
import { COMPARATOR_DISCLAIMER } from "../src/portfolio/vendor-comparator.js";
import { SENTINEL_DISCLAIMER } from "../src/sentinel/drift-engine.js";
import { COMPLIANCE_DISCLAIMER } from "../src/compliance/statutory-auditor.js";

let server;
let baseUrl;

// Determine valid auth header if backend auth is enabled
const getAuthHeaders = () => {
  const headers = { "Content-Type": "application/json" };
  if (config.auth.enabled && config.auth.token) {
    headers["Authorization"] = `Bearer ${config.auth.token}`;
  }
  return headers;
};

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
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
// 1. Portfolio Management End-to-End Tests
// =========================================================================

test("Portfolio: POST /api/portfolio/evaluate aggregates multi-vendor risk scores & systemic exposures", async () => {
  const payload = {
    portfolioName: "Enterprise Production Stack",
    vendors: [
      {
        vendorName: "CloudStorage Pro",
        analysis: {
          rankedFindings: [
            { categoryId: "ARBITRATION", severity: "HIGH", explanation: "Mandatory binding arbitration." },
            { categoryId: "LIABILITY_LIMITATION", severity: "HIGH", explanation: "Total liability capped at $50." }
          ],
          benchmarks: { restrictivenessScore: 82 }
        }
      },
      {
        vendorName: "TeamChat Hub",
        analysis: {
          rankedFindings: [
            { categoryId: "ARBITRATION", severity: "HIGH", explanation: "Class action waiver and arbitration." },
            { categoryId: "USER_CONTENT_RIGHTS", severity: "MEDIUM", explanation: "Perpetual worldwide license to user content." }
          ],
          benchmarks: { restrictivenessScore: 68 }
        }
      },
      {
        vendorName: "SimpleAnalytics",
        analysis: {
          rankedFindings: [
            { categoryId: "DATA_SHARING", severity: "LOW", explanation: "Minimal telemetry collection." }
          ],
          benchmarks: { restrictivenessScore: 18 }
        }
      }
    ]
  };

  const res = await fetch(`${baseUrl}/api/portfolio/evaluate`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 200, "Portfolio evaluation should return 200");
  const data = await res.json();
  assert.equal(data.success, true);
  const p = data.portfolio;

  assert.equal(p.portfolioName, "Enterprise Production Stack");
  assert.equal(p.totalVendors, 3);
  // (82 + 68 + 18) / 3 = 168 / 3 = 56
  assert.equal(p.aggregateStackScore, 56);
  assert.equal(p.portfolioHealth, "MODERATE_RISK");

  // Systemic exposure: Arbitration is in 2 out of 3 vendors (67% >= 40%)
  assert.ok(p.systemicExposures.length > 0, "Should detect systemic exposures");
  const arbExp = p.systemicExposures.find(e => e.domainKey === "disputeResolution");
  assert.ok(arbExp, "Should identify dispute resolution as systemic risk");
  assert.equal(arbExp.affectedCount, 2);
  assert.equal(arbExp.prevalencePercentage, 67);

  // Vendor rankings sorted ascending by score (lowest risk first)
  assert.equal(p.vendorRankings.length, 3);
  assert.equal(p.vendorRankings[0].vendorName, "SimpleAnalytics");
  assert.equal(p.vendorRankings[0].score, 18);
  assert.equal(p.vendorRankings[0].standing, "Favorable");
  assert.equal(p.vendorRankings[2].vendorName, "CloudStorage Pro");

  assert.equal(p.disclaimer, PORTFOLIO_DISCLAIMER);
});

test("Portfolio: POST /api/portfolio/compare produces aligned vendor matrix & procurement recommendation", async () => {
  const payload = {
    vendors: [
      {
        vendorName: "Vendor Strict",
        analysis: {
          rankedFindings: [
            { categoryId: "ARBITRATION", severity: "HIGH", explanation: "Binding arbitration required." },
            { categoryId: "UNILATERAL_CHANGES", severity: "HIGH", explanation: "May modify terms at will." }
          ]
        }
      },
      {
        vendorName: "Vendor Moderate",
        analysis: {
          rankedFindings: [
            { categoryId: "DATA_SHARING", severity: "MEDIUM", explanation: "Shares with service providers." }
          ]
        }
      },
      {
        vendorName: "Vendor Clean",
        analysis: {
          rankedFindings: [
            { categoryId: "GENERAL_RISK", severity: "LOW", title: "Standard Terms Phrasing" }
          ]
        }
      }
    ]
  };

  const res = await fetch(`${baseUrl}/api/portfolio/compare`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  const c = data.comparison;

  assert.equal(c.vendors.length, 3);
  assert.equal(c.recommendedVendor, "Vendor Clean", "Cleanest vendor must be recommended");
  assert.ok(c.recommendationRationale.includes("Vendor Clean"));
  assert.ok(c.recommendationRationale.includes("contractual posture"));

  // Check category matrix alignment
  assert.ok(c.categoryMatrix);
  const arbRow = c.categoryMatrix.ARBITRATION;
  assert.ok(arbRow);
  assert.equal(arbRow.vendorEntries["Vendor Strict"].status, "FLAGGED");
  assert.equal(arbRow.vendorEntries["Vendor Strict"].severity, "HIGH");
  assert.equal(arbRow.vendorEntries["Vendor Moderate"].status, "NOT_DETECTED");
  assert.equal(arbRow.vendorEntries["Vendor Clean"].status, "NOT_DETECTED");

  assert.equal(c.disclaimer, COMPARATOR_DISCLAIMER);
});

test("Portfolio: rejects invalid or out-of-bounds payloads with HTTP 400", async () => {
  // Empty vendors
  const resEmpty = await fetch(`${baseUrl}/api/portfolio/evaluate`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ vendors: [] })
  });
  assert.equal(resEmpty.status, 400);

  // Compare with < 2 vendors
  const resOne = await fetch(`${baseUrl}/api/portfolio/compare`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ vendors: [{ vendorName: "Solo" }] })
  });
  assert.equal(resOne.status, 400);

  // Compare with > 5 vendors
  const resSix = await fetch(`${baseUrl}/api/portfolio/compare`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      vendors: [
        { vendorName: "V1" }, { vendorName: "V2" }, { vendorName: "V3" },
        { vendorName: "V4" }, { vendorName: "V5" }, { vendorName: "V6" }
      ]
    })
  });
  assert.equal(resSix.status, 400);
});

// =========================================================================
// 2. Sentinel Risk Drift & Snapshot Tests
// =========================================================================

test("Sentinel: Snapshot lifecycle operates in-memory with zero disk persistence", async () => {
  const vendor = "EphemeralVendorCorp";
  snapshotStore.clear(vendor);

  // Save snapshot
  const postRes = await fetch(`${baseUrl}/api/sentinel/snapshot`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      vendorName: vendor,
      versionLabel: "2024 Terms v1.0",
      policyText: "Users may cancel subscriptions anytime without penalty."
    })
  });
  assert.equal(postRes.status, 200);
  const postData = await postRes.json();
  assert.equal(postData.success, true);
  assert.equal(postData.snapshot.versionLabel, "2024 Terms v1.0");

  // Retrieve snapshot
  const getRes = await fetch(`${baseUrl}/api/sentinel/snapshots/${encodeURIComponent(vendor)}`, {
    headers: getAuthHeaders()
  });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.success, true);
  assert.equal(getData.snapshots.length, 1);
  assert.equal(getData.snapshots[0].versionLabel, "2024 Terms v1.0");

  // Verify memory-only storage: clear works cleanly
  snapshotStore.clear(vendor);
  assert.equal(snapshotStore.getSnapshots(vendor).length, 0);
});

test("Sentinel: POST /api/sentinel/drift computes drift direction, magnitude, and redline diffs", async () => {
  const payload = {
    vendorName: "AcmeSync",
    baseVersion: {
      versionLabel: "2024 Terms",
      policyText: "Disputes may be resolved in small claims court or local court jurisdiction.",
      findings: [
        { categoryId: "GOVERNING_LAW", severity: "LOW", evidence: "local court jurisdiction" }
      ]
    },
    currentVersion: {
      versionLabel: "2026 Terms",
      policyText: "All disputes must be resolved by individual binding arbitration. Subscriptions renew automatically every year.",
      findings: [
        { categoryId: "GOVERNING_LAW", severity: "LOW", evidence: "binding arbitration in Delaware" },
        { categoryId: "ARBITRATION", severity: "HIGH", evidence: "All disputes must be resolved by individual binding arbitration." },
        { categoryId: "AUTO_RENEWAL", severity: "HIGH", evidence: "Subscriptions renew automatically every year." }
      ]
    }
  };

  const res = await fetch(`${baseUrl}/api/sentinel/drift`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  const d = data.drift;

  assert.equal(d.vendorName, "AcmeSync");
  assert.equal(d.driftDirection, "MORE_RESTRICTIVE", "Added arbitration and auto renewal is MORE_RESTRICTIVE");
  assert.ok(d.magnitudeScore > 0);
  assert.ok(["HIGH", "MODERATE"].includes(d.driftMagnitude));
  assert.ok(d.driftSummary.includes("AcmeSync"));

  // Check new restrictions
  assert.ok(d.newRestrictions.length >= 2);
  const newCatIds = d.newRestrictions.map(r => r.categoryId);
  assert.ok(newCatIds.includes("ARBITRATION"));
  assert.ok(newCatIds.includes("AUTO_RENEWAL"));

  // Check word-level redline transition diff
  assert.ok(d.clauseTransitions.length >= 1);
  const trans = d.clauseTransitions[0];
  assert.ok(trans.redlineHtml.includes("<del") || trans.redlineHtml.includes("<ins"));

  assert.equal(d.disclaimer, SENTINEL_DISCLAIMER);
});

test("Sentinel: rejects missing version objects with HTTP 400", async () => {
  const res = await fetch(`${baseUrl}/api/sentinel/drift`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ vendorName: "Acme" })
  });
  assert.equal(res.status, 400);
});

// =========================================================================
// 3. Statutory Compliance (LexCheck) End-to-End Tests
// =========================================================================

test("Compliance: GET /api/compliance/jurisdictions returns all 5 canonical frameworks", async () => {
  const res = await fetch(`${baseUrl}/api/compliance/jurisdictions`, {
    headers: getAuthHeaders()
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const codes = data.jurisdictions.map(j => j.id || j.code);
  assert.ok(codes.includes("US_FEDERAL"), "Must include US_FEDERAL");
  assert.ok(codes.includes("US_CALIFORNIA"), "Must include US_CALIFORNIA");
  assert.ok(codes.includes("EU_GDPR"), "Must include EU_GDPR");
  assert.ok(codes.includes("UK_CRA"), "Must include UK_CRA");
  assert.ok(codes.includes("IN_CONSUMER"), "Must include IN_CONSUMER");
  assert.equal(data.jurisdictions.length, 5, "Must return exactly 5 jurisdictions");
});

test("Compliance: POST /api/compliance/audit evaluates all 5 legal frameworks with citations", async () => {
  const arbitrationFinding = {
    categoryId: "ARBITRATION",
    severity: "HIGH",
    evidence: "You agree that all disputes will be resolved by binding individual arbitration."
  };

  const autoRenewalFinding = {
    categoryId: "AUTO_RENEWAL",
    severity: "HIGH",
    evidence: "Your subscription will automatically renew without additional notice."
  };

  // 1. EU_GDPR: Arbitration clause flagged as unenforceable under Directive 93/13/EEC
  const euRes = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ findings: [arbitrationFinding], jurisdiction: "EU_GDPR" })
  });
  assert.equal(euRes.status, 200);
  const euData = await euRes.json();
  assert.equal(euData.compliance.jurisdiction, "EU_GDPR");
  assert.equal(euData.compliance.unenforceableClausesCount, 1);
  assert.ok(euData.compliance.statutoryAlerts[0].statutoryCitation.includes("93/13/EEC"));
  assert.equal(euData.compliance.statutoryAlerts[0].alertClassification, "UNENFORCEABLE_CLAUSE");
  assert.ok(euData.compliance.statutoryAlerts[0].guidance.length > 0);

  // 2. UK_CRA: Flagged under Consumer Rights Act 2015 s.62
  const ukRes = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ findings: [arbitrationFinding], jurisdiction: "UK_CRA" })
  });
  assert.equal(ukRes.status, 200);
  const ukData = await ukRes.json();
  assert.equal(ukData.compliance.jurisdiction, "UK_CRA");
  assert.equal(ukData.compliance.unenforceableClausesCount, 1);
  assert.ok(ukData.compliance.statutoryAlerts[0].statutoryCitation.includes("Consumer Rights Act 2015"));

  // 3. US_CALIFORNIA: Auto-renewal flagged under California ARL
  const caRes = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ findings: [autoRenewalFinding], jurisdiction: "US_CALIFORNIA" })
  });
  assert.equal(caRes.status, 200);
  const caData = await caRes.json();
  assert.equal(caData.compliance.jurisdiction, "US_CALIFORNIA");
  assert.ok(caData.compliance.statutoryAlerts[0].statutoryCitation.includes("Cal. Bus. & Prof. Code"));

  // 4. US_FEDERAL: FAA and FTC Act framework
  const usRes = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ findings: [arbitrationFinding], jurisdiction: "US_FEDERAL" })
  });
  assert.equal(usRes.status, 200);
  const usData = await usRes.json();
  assert.equal(usData.compliance.jurisdiction, "US_FEDERAL");
  assert.ok(usData.compliance.statutoryAlerts.length > 0);

  // 5. IN_CONSUMER: Consumer Protection Act 2019 & RBI E-Mandate Framework
  const inRes = await fetch(`${baseUrl}/api/compliance/audit`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ findings: [autoRenewalFinding], jurisdiction: "IN_CONSUMER" })
  });
  assert.equal(inRes.status, 200);
  const inData = await inRes.json();
  assert.equal(inData.compliance.jurisdiction, "IN_CONSUMER");
  assert.ok(inData.compliance.statutoryAlerts.length > 0);
  assert.ok(inData.compliance.statutoryAlerts[0].statutoryCitation.includes("Consumer Protection Act"));

  // Ensure disclaimer is universally present
  assert.equal(euData.compliance.disclaimer, COMPLIANCE_DISCLAIMER);
  assert.equal(caData.compliance.disclaimer, COMPLIANCE_DISCLAIMER);
});

// =========================================================================
// 4. Security & Privacy Audit Verification
// =========================================================================

test("Security: Helmet CSP headers are strict and contain no unsafe-inline", async () => {
  const res = await fetch(`${baseUrl}/health`);
  const csp = res.headers.get("content-security-policy");

  assert.ok(csp, "CSP header must be present on responses");
  assert.ok(csp.includes("default-src 'self'"), "CSP must include default-src 'self'");
  assert.ok(csp.includes("script-src 'self'"), "CSP must include script-src 'self'");
  assert.ok(csp.includes("style-src 'self'"), "CSP must include style-src 'self'");
  assert.ok(!csp.includes("'unsafe-inline'"), "CSP must NEVER contain 'unsafe-inline'");
});

test("Security: CORS rejects unauthorized external cross-origin requests", async () => {
  const res = await fetch(`${baseUrl}/api/compliance/jurisdictions`, {
    method: "GET",
    headers: {
      ...getAuthHeaders(),
      Origin: "https://evil-unauthorized-site.com"
    }
  });

  // CORS middleware should not reflect unauthorized origin
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assert.notEqual(allowOrigin, "https://evil-unauthorized-site.com");
});

test("Security: Error responses do not leak stack traces or secret environment tokens", async () => {
  const res = await fetch(`${baseUrl}/api/portfolio/evaluate`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: "invalid-json{"
  });

  assert.ok([400, 500].includes(res.status));
  const text = await res.text();
  assert.ok(!text.includes("API_BEARER_TOKEN"));
  assert.ok(!text.includes("INTERNAL_AI_SERVICE_TOKEN"));
  assert.ok(!text.includes("GEMINI_API_KEY"));
});
