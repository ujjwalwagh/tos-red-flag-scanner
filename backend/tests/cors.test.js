import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  isValidChromeExtensionOrigin,
  parseAllowedExtensionOrigins,
  createCorsMiddleware
} from "../src/security/cors.js";
import { app } from "../server.js";

// Valid 32-character Chrome extension ID using alphabet [a-p]
const VALID_EXTENSION_ID_1 = "abcdefghijklmnopabcdefghijklmnop";
const VALID_EXTENSION_ID_2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UNCONFIGURED_EXTENSION_ID = "cccccccccccccccccccccccccccccccc";

const ALLOWED_EXTENSION_ORIGIN = `chrome-extension://${VALID_EXTENSION_ID_1}`;
const UNCONFIGURED_EXTENSION_ORIGIN = `chrome-extension://${UNCONFIGURED_EXTENSION_ID}`;
const MALICIOUS_WEB_ORIGIN = "https://malicious-website.example.com";

/* ------------------------------------------------------------------
 * Unit Tests: Chrome Extension Origin Format Validation
 * ------------------------------------------------------------------ */

test("isValidChromeExtensionOrigin accepts valid 32-char lowercase [a-p] origins", () => {
  assert.equal(isValidChromeExtensionOrigin(`chrome-extension://${VALID_EXTENSION_ID_1}`), true);
  assert.equal(isValidChromeExtensionOrigin(`chrome-extension://${VALID_EXTENSION_ID_2}`), true);
});

test("isValidChromeExtensionOrigin accepts case-insensitive valid origins", () => {
  assert.equal(isValidChromeExtensionOrigin(`chrome-extension://${VALID_EXTENSION_ID_1.toUpperCase()}`), true);
});

test("isValidChromeExtensionOrigin rejects wildcards and malformed schemes", () => {
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://*"), false);
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://"), false);
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://*/*"), false);
  assert.equal(isValidChromeExtensionOrigin("http://localhost:3000"), false);
  assert.equal(isValidChromeExtensionOrigin("https://example.com"), false);
});

test("isValidChromeExtensionOrigin rejects non-alpha characters or letters outside a-p", () => {
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://12345678901234567890123456789012"), false);
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://qrstuvwxyzabcdefghijklmnopqrstuv"), false);
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://abcdefghijklmnop-bcdefghijklmno"), false);
});

test("isValidChromeExtensionOrigin rejects invalid lengths", () => {
  assert.equal(isValidChromeExtensionOrigin("chrome-extension://abc"), false);
  assert.equal(isValidChromeExtensionOrigin(`chrome-extension://${VALID_EXTENSION_ID_1}a`), false);
});

test("isValidChromeExtensionOrigin rejects null, undefined, or empty values", () => {
  assert.equal(isValidChromeExtensionOrigin(null), false);
  assert.equal(isValidChromeExtensionOrigin(undefined), false);
  assert.equal(isValidChromeExtensionOrigin(""), false);
  assert.equal(isValidChromeExtensionOrigin("   "), false);
});

/* ------------------------------------------------------------------
 * Unit Tests: parseAllowedExtensionOrigins
 * ------------------------------------------------------------------ */

test("parseAllowedExtensionOrigins correctly filters valid and rejects invalid entries", () => {
  const raw = `chrome-extension://${VALID_EXTENSION_ID_1}, chrome-extension://*, https://evil.com, chrome-extension://${VALID_EXTENSION_ID_2}`;
  const set = parseAllowedExtensionOrigins(raw);

  assert.equal(set.size, 2);
  assert.equal(set.has(`chrome-extension://${VALID_EXTENSION_ID_1}`), true);
  assert.equal(set.has(`chrome-extension://${VALID_EXTENSION_ID_2}`), true);
  assert.equal(set.has("chrome-extension://*"), false);
  assert.equal(set.has("https://evil.com"), false);
});

test("parseAllowedExtensionOrigins handles empty or missing input safely", () => {
  assert.equal(parseAllowedExtensionOrigins("").size, 0);
  assert.equal(parseAllowedExtensionOrigins(null).size, 0);
  assert.equal(parseAllowedExtensionOrigins(undefined).size, 0);
});

/* ------------------------------------------------------------------
 * Integration Tests: CORS & Middleware Behavior on Express Pipeline
 * ------------------------------------------------------------------ */

test("CORS middleware integration with configured extension origin", async () => {
  const customApp = express();
  customApp.use(createCorsMiddleware({ allowedOrigins: ALLOWED_EXTENSION_ORIGIN }));
  customApp.get("/test", (_req, res) => res.json({ ok: true }));
  customApp.post("/test", (_req, res) => res.json({ received: true }));

  const server = http.createServer(customApp);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Preflight OPTIONS from configured extension origin -> 204 + CORS headers
    const preflightRes = await fetch(`${baseUrl}/test`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_EXTENSION_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type"
      }
    });

    assert.equal(preflightRes.status, 204);
    assert.equal(preflightRes.headers.get("access-control-allow-origin"), ALLOWED_EXTENSION_ORIGIN);
    assert.equal(preflightRes.headers.get("access-control-allow-origin"), ALLOWED_EXTENSION_ORIGIN);
    assert.notEqual(preflightRes.headers.get("access-control-allow-origin"), "*");
    assert.ok(preflightRes.headers.get("access-control-allow-methods").includes("POST"));

    // 2. POST from configured extension origin -> 200 + CORS headers
    const postRes = await fetch(`${baseUrl}/test`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_EXTENSION_ORIGIN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ping: true })
    });

    assert.equal(postRes.status, 200);
    assert.equal(postRes.headers.get("access-control-allow-origin"), ALLOWED_EXTENSION_ORIGIN);
    assert.notEqual(postRes.headers.get("access-control-allow-origin"), "*");
    const postData = await postRes.json();
    assert.equal(postData.received, true);

    // 3. Preflight OPTIONS from unconfigured extension origin -> 403 Forbidden
    const unconfPreflight = await fetch(`${baseUrl}/test`, {
      method: "OPTIONS",
      headers: {
        Origin: UNCONFIGURED_EXTENSION_ORIGIN,
        "Access-Control-Request-Method": "POST"
      }
    });
    assert.equal(unconfPreflight.status, 403);
    assert.equal(unconfPreflight.headers.get("access-control-allow-origin"), null);

    // 4. POST from unconfigured extension origin -> 403 Forbidden
    const unconfPost = await fetch(`${baseUrl}/test`, {
      method: "POST",
      headers: {
        Origin: UNCONFIGURED_EXTENSION_ORIGIN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ping: true })
    });
    assert.equal(unconfPost.status, 403);
    assert.equal(unconfPost.headers.get("access-control-allow-origin"), null);

    // 5. Arbitrary website origin -> 403 Forbidden
    const evilRes = await fetch(`${baseUrl}/test`, {
      method: "POST",
      headers: {
        Origin: MALICIOUS_WEB_ORIGIN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ping: true })
    });
    assert.equal(evilRes.status, 403);
    assert.equal(evilRes.headers.get("access-control-allow-origin"), null);

    // 6. Same-origin request without Origin header -> 200 OK
    const noOriginRes = await fetch(`${baseUrl}/test`, {
      method: "GET"
    });
    assert.equal(noOriginRes.status, 200);

    // 7. Same-origin request with host Origin header -> 200 OK
    const sameOriginRes = await fetch(`${baseUrl}/test`, {
      method: "GET",
      headers: {
        Origin: baseUrl
      }
    });
    assert.equal(sameOriginRes.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/* ------------------------------------------------------------------
 * Integration Tests: Full Production App Server Verification
 * ------------------------------------------------------------------ */

test("Production app pipeline handles CORS, same-origin, and 1MB JSON limits", async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Existing same-origin request works seamlessly
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, "ok");

    // 2. Arbitrary website origin is rejected by server with 403
    const blockedRes = await fetch(`${baseUrl}/api/analyze/categories`, {
      headers: { Origin: "https://arbitrary-attacker.com" }
    });
    assert.equal(blockedRes.status, 403);
    assert.equal(blockedRes.headers.get("access-control-allow-origin"), null);

    // 3. Unconfigured extension origin is rejected by server with 403
    const unconfExtRes = await fetch(`${baseUrl}/api/analyze/categories`, {
      headers: { Origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    });
    assert.equal(unconfExtRes.status, 403);
    assert.equal(unconfExtRes.headers.get("access-control-allow-origin"), null);

    // 4. Wildcard origin attempt is rejected
    const wildcardRes = await fetch(`${baseUrl}/api/analyze/categories`, {
      headers: { Origin: "*" }
    });
    assert.equal(wildcardRes.status, 403);
    assert.equal(wildcardRes.headers.get("access-control-allow-origin"), null);

    // 5. JSON payload between 250KB and 1MB is accepted by body parser
    // Construct ~400KB repeated policy text
    const paragraph = "All subscriptions automatically renew each month unless cancelled at least 24 hours in advance. ";
    const largePolicyText = paragraph.repeat(4200); // ~400KB
    assert.ok(largePolicyText.length > 300_000 && largePolicyText.length < 800_000);

    const acceptedRes = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ policyText: largePolicyText, scanMode: "broad" })
    });

    // 400KB payload passes body parser (not 413) and returns scan results
    assert.equal(acceptedRes.status, 200);
    const scanData = await acceptedRes.json();
    assert.ok(Array.isArray(scanData.flags));
    assert.ok(scanData.overallRisk);

    // 6. JSON payload exceeding 1MB (e.g. ~1.2MB) is rejected with 413 Payload Too Large
    const oversizedText = "A".repeat(1_200_000); // 1.2MB text
    const oversizedRes = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ policyText: oversizedText })
    });

    assert.equal(oversizedRes.status, 413);
    const errData = await oversizedRes.json();
    assert.ok(errData.error.includes("1MB") || errData.error.includes("too large"));

    // 7. Verify server remains healthy and operational after 413 rejection
    const followUpRes = await fetch(`${baseUrl}/health`);
    assert.equal(followUpRes.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

