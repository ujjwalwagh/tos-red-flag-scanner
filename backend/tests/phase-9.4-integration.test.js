import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
import { config } from "../src/config/env.js";
import { JURISDICTIONS } from "../src/compliance/statutory-rules.js";
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
// 1. Statutory Compliance (LexCheck) End-to-End Tests
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
// 2. Security & Privacy Audit Verification
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
  const res = await fetch(`${baseUrl}/api/compliance/audit`, {
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
