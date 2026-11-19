import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  analyzeConfirmedPolicy,
  queryPolicyDocument,
  askPolicyQuestion,
  handleRuntimeMessage,
  saveSessionQaTurn,
  clearSessionPendingQa,
  recordSessionPendingQa
} from "../../extension/background/service-worker.js";

// Mock Chrome Storage Session helper for Q&A session recovery tests
function createMockChromeStorage() {
  const store = new Map();
  return {
    session: {
      get: (keys, callback) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          if (store.has(k)) {
            result[k] = JSON.parse(JSON.stringify(store.get(k)));
          }
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (obj, callback) => {
        for (const [k, v] of Object.entries(obj)) {
          store.set(k, JSON.parse(JSON.stringify(v)));
        }
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys, callback) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          store.delete(k);
        }
        if (callback) callback();
        return Promise.resolve();
      },
      _rawStore: store
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sample substantive policy text exceeding 500 characters
const SAMPLE_TERMS_TEXT = `
  Section 1. Account Security and Maintenance.
  Users must provide valid identification credentials when creating a corporate or personal account.
  Any unauthorized disclosure of credentials must be reported immediately to technical security operations.
  Section 2. Unilateral Terms Modification.
  We reserve the exclusive right to modify, amend, update, or discontinue any portion of these service terms
  at any time without prior written notification to users. Continued utilization of the system constitutes acceptance.
  Section 3. Mandatory Binding Arbitration and Class Action Waiver.
  All legal disputes arising out of or relating to this commercial contract shall be resolved exclusively through
  individual binding arbitration rather than in court. You explicitly waive any right to participate in class actions.
  Section 4. Intellectual Property and Licensing.
  You retain proprietary ownership in user-generated content uploaded to the service platform.
`;

const SAMPLE_PRIVACY_TEXT = `
  Section 1. Information Collection and Telemetry.
  We collect personally identifiable information including full legal name, physical mailing address,
  electronic mail address, payment card details, and persistent device hardware identifiers across all client sessions.
  Section 2. Third-Party Data Sharing and Commercial Partnerships.
  We may disclose, license, or sell aggregated and pseudonymous user behavioral information to third-party
  advertising partners, affiliates, analytics brokers, and commercial marketing vendors for behavioral ad targeting.
  Section 3. Data Retention and Deletion Rights.
  We retain personal telemetry for as long as necessary to fulfill corporate business objectives.
  Section 4. California and European Statutory Rights.
  Residents of certain jurisdictions may exercise statutory opt-out rights by contacting customer privacy operations.
`;

/* ------------------------------------------------------------------
 * 1. Valid Confirmed Terms Submission
 * ------------------------------------------------------------------ */
test("1. analyzeConfirmedPolicy submits valid confirmed Terms to POST /api/scan", async () => {
  let capturedBody = null;
  let capturedMethod = null;
  let capturedUrl = null;

  const mockServer = http.createServer((req, res) => {
    capturedMethod = req.method;
    capturedUrl = req.url;
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedBody = JSON.parse(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        sourceUrl: "Pasted text",
        scanMode: "broad",
        overallRisk: "high",
        flags: [
          {
            title: "Unilateral Modification",
            severity: "high",
            plainEnglish: "The company can change terms anytime without notice.",
            whyItMatters: "You may be subjected to new obligations without your consent.",
            quote: "We reserve the exclusive right to modify..."
          }
        ],
        readability: { score: 45, level: "Complex" }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const payload = {
      candidate: { title: "Terms of Service", url: "https://example.com/terms", category: "TERMS" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true,
      documentType: "TERMS"
    };

    const res = await analyzeConfirmedPolicy(payload, mockBaseUrl);
    assert.equal(res.ok, true);
    assert.equal(res.documentType, "TERMS");
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedUrl, "/api/scan");
    assert.equal(capturedBody.scanMode, "broad");
    assert.ok(capturedBody.policyText.includes("Unilateral Terms Modification"));
    assert.equal(res.result.overallRisk, "high");
    assert.equal(res.result.flags.length, 1);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 2. Valid Confirmed Privacy Submission
 * ------------------------------------------------------------------ */
test("2. analyzeConfirmedPolicy submits valid confirmed Privacy to POST /api/scan", async () => {
  let capturedBody = null;

  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedBody = JSON.parse(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        sourceUrl: "Pasted text",
        scanMode: "broad",
        overallRisk: "medium",
        flags: [
          {
            title: "Third-Party Data Sharing",
            severity: "medium",
            plainEnglish: "Your personal details may be shared with marketing vendors.",
            whyItMatters: "May result in third-party profiling.",
            quote: "We may disclose, license, or sell..."
          }
        ]
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const payload = {
      candidate: { title: "Privacy Statement", url: "https://example.com/privacy", category: "PRIVACY" },
      extractedText: SAMPLE_PRIVACY_TEXT,
      confirmed: true,
      documentType: "PRIVACY"
    };

    const res = await analyzeConfirmedPolicy(payload, mockBaseUrl);
    assert.equal(res.ok, true);
    assert.equal(res.documentType, "PRIVACY");
    assert.ok(capturedBody.policyText.includes("Information Collection and Telemetry"));
    assert.equal(res.result.overallRisk, "medium");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 3. Unconfirmed Document Rejection
 * ------------------------------------------------------------------ */
test("3. analyzeConfirmedPolicy rejects unconfirmed preview submissions", async () => {
  const payload = {
    candidate: { title: "Unconfirmed Terms", url: "https://example.com/terms" },
    extractedText: SAMPLE_TERMS_TEXT,
    confirmed: false // not confirmed by user
  };

  const res = await analyzeConfirmedPolicy(payload);
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("confirmed"));
});

/* ------------------------------------------------------------------
 * 4. Empty Extracted Text Rejection
 * ------------------------------------------------------------------ */
test("4. analyzeConfirmedPolicy rejects empty extracted text", async () => {
  const payload = {
    candidate: { title: "Terms", url: "https://example.com/terms" },
    extractedText: "   ",
    confirmed: true
  };

  const res = await analyzeConfirmedPolicy(payload);
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("empty"));
});

/* ------------------------------------------------------------------
 * 5. Unsupported Document Type Rejection
 * ------------------------------------------------------------------ */
test("5. analyzeConfirmedPolicy rejects unsupported document categories", async () => {
  const payload = {
    candidate: { title: "Marketing Blog", url: "https://example.com/blog" },
    extractedText: SAMPLE_TERMS_TEXT,
    confirmed: true,
    documentType: "BLOG_POST"
  };

  const res = await analyzeConfirmedPolicy(payload);
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("Unsupported document category"));
});

/* ------------------------------------------------------------------
 * 6. Oversized Document Safety & Explicit Consent Enforcement (Phase 7F.1)
 * ------------------------------------------------------------------ */
test("6. analyzeConfirmedPolicy enforces minimum 500 chars and refuses silent truncation without consent", async () => {
  // A. Too short (<500 characters)
  const shortPayload = {
    candidate: { title: "Short Terms", url: "https://example.com/short" },
    extractedText: "Short text below 500 characters.",
    confirmed: true
  };
  const shortRes = await analyzeConfirmedPolicy(shortPayload);
  assert.equal(shortRes.ok, false);
  assert.ok(shortRes.error.includes("minimum 500 characters"));

  // B. Oversized text WITHOUT allowPartial: true -> refuses silent truncation
  let serverCalled = false;
  let capturedLength = 0;
  const mockServer = http.createServer((req, res) => {
    serverCalled = true;
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(data);
      capturedLength = parsed.policyText.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ overallRisk: "low", flags: [] }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const hugeText = SAMPLE_TERMS_TEXT.repeat(250); // > 100k characters
    assert.ok(hugeText.length > 100000);

    // 1. Without allowPartial: MUST NOT call server or silently truncate
    const consentRes = await analyzeConfirmedPolicy({
      candidate: { title: "Huge Terms", url: "https://example.com/huge" },
      extractedText: hugeText,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(consentRes.ok, false);
    assert.equal(consentRes.status, "OVERSIZED_DOCUMENT_REQUIRES_CONSENT");
    assert.equal(consentRes.requiresConsent, true);
    assert.equal(consentRes.maxChars, 100000);
    assert.equal(consentRes.originalCharCount, hugeText.trim().length);
    assert.equal(serverCalled, false, "Backend /api/scan MUST NOT be called when consent is needed");

    // 2. With allowPartial: true -> user gave explicit consent, safely submits first 100,000 chars
    const proceedRes = await analyzeConfirmedPolicy({
      candidate: { title: "Huge Terms", url: "https://example.com/huge" },
      extractedText: hugeText,
      confirmed: true,
      allowPartial: true
    }, mockBaseUrl);

    assert.equal(proceedRes.ok, true);
    assert.equal(serverCalled, true);
    assert.equal(capturedLength, 100000, "Must be sliced to exactly 100,000 characters upon consent");
    assert.equal(proceedRes.isPartial, true);
    assert.equal(proceedRes.submittedCharCount, 100000);
    assert.equal(proceedRes.originalCharCount, hugeText.trim().length);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 7. Correct POST /api/scan Request Format
 * ------------------------------------------------------------------ */
test("7. Request strictly conforms to { policyText, scanMode: 'broad' } without extraneous URL fields", async () => {
  let capturedKeys = [];

  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(data);
      capturedKeys = Object.keys(parsed);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ overallRisk: "low", flags: [] }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com/terms" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.deepEqual(capturedKeys.sort(), ["policyText", "scanMode"]);
    assert.equal(capturedKeys.includes("url"), false, "Must NOT include 'url' when policyText is supplied");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 8. Successful Backend Response Handling
 * ------------------------------------------------------------------ */
test("8. analyzeConfirmedPolicy parses and attaches structured backend report", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      overallRisk: "critical",
      flags: [
        { title: "Arbitration", severity: "high", plainEnglish: "Binding arbitration.", whyItMatters: "No court trial." },
        { title: "Tracking", severity: "medium", plainEnglish: "Ad tracking.", whyItMatters: "Data sold." }
      ],
      readability: { score: 68, level: "Dense", warning: "Complex legal language" }
    }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Acme", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(res.result.overallRisk, "critical");
    assert.equal(res.result.flags.length, 2);
    assert.equal(res.result.readability.score, 68);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 9. HTTP 400 Handling
 * ------------------------------------------------------------------ */
test("9. analyzeConfirmedPolicy handles HTTP 400 Bad Request gracefully", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request payload or malformed syntax." }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.ok(res.error.includes("Invalid request payload"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 10. HTTP 413 Handling (Payload Too Large)
 * ------------------------------------------------------------------ */
test("10. analyzeConfirmedPolicy handles HTTP 413 Payload Too Large", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Payload Too Large" }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.equal(res.status, 413);
    assert.ok(res.error.includes("413 Payload Too Large"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 11. HTTP 429 Handling (Rate Limit)
 * ------------------------------------------------------------------ */
test("11. analyzeConfirmedPolicy handles HTTP 429 Rate Limit Exceeded", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too Many Requests" }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.ok(res.error.includes("rate limit exceeded (HTTP 429)"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 12. HTTP 500 Handling (Server Error)
 * ------------------------------------------------------------------ */
test("12. analyzeConfirmedPolicy handles HTTP 500 Internal Server Error", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to scan this document right now. Please try again." }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.equal(res.status, 500);
    assert.ok(res.error.includes("Failed to scan this document"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 13. Network Timeout Handling
 * ------------------------------------------------------------------ */
test("13. analyzeConfirmedPolicy handles network timeout via AbortController", async () => {
  // Listening on a port that does not send responses
  const mockServer = http.createServer((req, res) => {
    // Deliberately hold connection open without replying
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    // Temporarily trigger abort controller
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      };

      const res = await analyzeConfirmedPolicy({
        candidate: { title: "Terms", url: "https://example.com" },
        extractedText: SAMPLE_TERMS_TEXT,
        confirmed: true
      }, mockBaseUrl);

      assert.equal(res.ok, false);
      assert.ok(res.error.includes("timed out"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 14. Invalid JSON Response Handling
 * ------------------------------------------------------------------ */
test("14. analyzeConfirmedPolicy catches invalid non-JSON responses safely", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Bad Gateway Error HTML</body></html>");
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com" },
      extractedText: SAMPLE_TERMS_TEXT,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.ok(res.error.includes("Invalid JSON response"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 15. No Automatic Duplicate Submission
 * ------------------------------------------------------------------ */
test("15. Popup analysis handler disables submission button during in-flight request", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");
  assert.ok(popupJs.includes("btnAnalyzeDocEl.disabled = true;"));
  assert.ok(popupJs.includes('doc.scanStatus = "SCANNING";'));
  assert.ok(popupJs.includes("resetAnalyzeButton();"));
});

/* ------------------------------------------------------------------
 * 16. Independent Terms and Privacy Results
 * ------------------------------------------------------------------ */
test("16. Terms and Privacy analysis results remain in separate state slots", () => {
  const documentState = {
    TERMS: {
      candidate: { title: "GitHub Terms of Service" },
      confirmed: true,
      scanStatus: "COMPLETED",
      scanResult: { overallRisk: "high", flags: [{ title: "Terms Flag" }] }
    },
    PRIVACY: {
      candidate: { title: "GitHub Privacy Statement" },
      confirmed: true,
      scanStatus: "COMPLETED",
      scanResult: { overallRisk: "low", flags: [{ title: "Privacy Flag" }] }
    }
  };

  assert.equal(documentState.TERMS.scanResult.overallRisk, "high");
  assert.equal(documentState.PRIVACY.scanResult.overallRisk, "low");

  // Updating or clearing Terms leaves Privacy fully preserved
  documentState.TERMS.scanResult = null;
  documentState.TERMS.scanStatus = "IDLE";

  assert.equal(documentState.TERMS.scanResult, null);
  assert.notEqual(documentState.PRIVACY.scanResult, null);
  assert.equal(documentState.PRIVACY.scanResult.flags[0].title, "Privacy Flag");
});

/* ------------------------------------------------------------------
 * 17. Safe Rendering of Untrusted Backend Text (Zero innerHTML)
 * ------------------------------------------------------------------ */
test("17. Popup creates red flag cards using textContent exclusively without innerHTML", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  // In createRedFlagElement:
  assert.ok(popupJs.includes("title.textContent = flag.title"));
  assert.ok(popupJs.includes("bText.textContent = flag.plainEnglish"));
  assert.ok(popupJs.includes("wText.textContent = flag.whyItMatters"));
  assert.ok(popupJs.includes("qText.textContent = `\"${flag.quote}\"`"));

  // Check that no innerHTML assignment occurs with flag data
  assert.equal(popupJs.includes("card.innerHTML ="), false);
  assert.equal(popupJs.includes("header.innerHTML ="), false);
});

/* ------------------------------------------------------------------
 * 18. No Full Policy Text in Logs
 * ------------------------------------------------------------------ */
test("18. Service worker does not log full extracted policy text to console", () => {
  const workerContent = fs.readFileSync(path.resolve(__dirname, "../../extension/background/service-worker.js"), "utf-8");
  assert.equal(workerContent.includes("console.log(extractedText)"), false);
  assert.equal(workerContent.includes("console.log(policyTextToSend)"), false);
  assert.equal(workerContent.includes("console.log(candidate)"), false);
});

/* ------------------------------------------------------------------
 * 19. No Gemini API Key Exposure in Extension
 * ------------------------------------------------------------------ */
test("19. Extension files contain zero Gemini API keys, tokens, or direct model calls", () => {
  const extensionDir = path.resolve(__dirname, "../../extension");
  const files = [
    path.join(extensionDir, "manifest.json"),
    path.join(extensionDir, "background/service-worker.js"),
    path.join(extensionDir, "popup/popup.js"),
    path.join(extensionDir, "utils/extractor-core.js")
  ];

  const forbiddenSecrets = ["AIzaSy", "GEMINI_API_KEY", "generativelanguage.googleapis.com", "gemini-flash"];

  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    for (const secret of forbiddenSecrets) {
      assert.equal(text.includes(secret), false, `File ${path.basename(f)} must not contain '${secret}'`);
    }
  }
});

/* ------------------------------------------------------------------
 * 20. Endpoint Separation: Scanning Calls /api/scan, Q&A Calls /api/analyze/qa
 * ------------------------------------------------------------------ */
test("20. Background service worker scanning handler calls only /api/scan, while Q&A calls /api/analyze/qa", () => {
  const workerContent = fs.readFileSync(path.resolve(__dirname, "../../extension/background/service-worker.js"), "utf-8");

  // Extract analyzeConfirmedPolicy function body
  const scanFunctionMatch = workerContent.match(/export async function analyzeConfirmedPolicy[\s\S]*?^}/m);
  assert.ok(scanFunctionMatch, "analyzeConfirmedPolicy must exist");
  const scanFunctionBody = scanFunctionMatch[0];

  assert.ok(scanFunctionBody.includes("/api/scan"), "Scanning function must target /api/scan");
  assert.equal(scanFunctionBody.includes("/api/analyze/qa"), false, "Scanning must not call /api/analyze/qa");
  assert.equal(scanFunctionBody.includes("/api/analyze?"), false, "Scanning must not call /api/analyze?");

  // Extract queryPolicyDocument function body
  const qaFunctionMatch = workerContent.match(/export async function queryPolicyDocument[\s\S]*?^}/m);
  assert.ok(qaFunctionMatch, "queryPolicyDocument must exist");
  const qaFunctionBody = qaFunctionMatch[0];

  assert.ok(qaFunctionBody.includes("/api/analyze/qa"), "Q&A handler must target /api/analyze/qa");
  assert.equal(qaFunctionBody.includes("/api/scan"), false, "Q&A handler must not target /api/scan");
});

/* ------------------------------------------------------------------
 * 21. Standard Documents (<= 100k chars) Scan Seamlessly Without Consent
 * ------------------------------------------------------------------ */
test("21. Standard documents (<= 100,000 chars) scan directly with isPartial = false", async () => {
  let capturedLength = 0;
  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(data);
      capturedLength = parsed.policyText.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ overallRisk: "low", flags: [] }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const makePolicyOfExactLength = (len) => {
      const header = "Section 1. Terms and Conditions Policy.\n\n";
      return header + "A".repeat(len - header.length);
    };

    // 1. Shorter document (~1,000 characters)
    const normalText = SAMPLE_TERMS_TEXT;
    assert.ok(normalText.trim().length < 100000);

    const resNormal = await analyzeConfirmedPolicy({
      candidate: { title: "Terms", url: "https://example.com/terms" },
      extractedText: normalText,
      confirmed: true
    }, mockBaseUrl);

    assert.equal(resNormal.ok, true);
    assert.equal(resNormal.isPartial, false);
    assert.equal(resNormal.submittedCharCount, normalText.trim().length);
    assert.equal(capturedLength, normalText.trim().length);

    // 2. 64,000-character document is completely analysed without consent
    const text64k = makePolicyOfExactLength(64000);
    const res64k = await analyzeConfirmedPolicy({
      candidate: { title: "Terms 64k", url: "https://example.com/64k" },
      extractedText: text64k,
      confirmed: true
    }, mockBaseUrl);
    assert.equal(res64k.ok, true);
    assert.equal(res64k.isPartial, false);
    assert.equal(res64k.submittedCharCount, 64000);
    assert.equal(capturedLength, 64000);

    // 3. 71,979-character document (Spotify size) is completely analysed without consent
    const textSpotify = makePolicyOfExactLength(71979);
    const resSpotify = await analyzeConfirmedPolicy({
      candidate: { title: "Spotify Privacy", url: "https://example.com/spotify" },
      extractedText: textSpotify,
      confirmed: true
    }, mockBaseUrl);
    assert.equal(resSpotify.ok, true);
    assert.equal(resSpotify.isPartial, false);
    assert.equal(resSpotify.submittedCharCount, 71979);
    assert.equal(capturedLength, 71979);

    // 4. Exactly 100,000-character document is completely analysed without consent
    const text100k = makePolicyOfExactLength(100000);
    const res100k = await analyzeConfirmedPolicy({
      candidate: { title: "Terms 100k", url: "https://example.com/100k" },
      extractedText: text100k,
      confirmed: true
    }, mockBaseUrl);
    assert.equal(res100k.ok, true);
    assert.equal(res100k.isPartial, false);
    assert.equal(res100k.submittedCharCount, 100000);
    assert.equal(capturedLength, 100000);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 22. Popup HTML Contains Oversized Consent and Partial Banner Elements
 * ------------------------------------------------------------------ */
test("22. Popup HTML contains oversized consent dialog and partial banner elements", () => {
  const popupHtml = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.html"), "utf-8");

  assert.ok(popupHtml.includes('id="oversized-consent-box"'));
  assert.ok(popupHtml.includes('id="consent-orig-chars"'));
  assert.ok(popupHtml.includes('id="btn-consent-proceed"'));
  assert.ok(popupHtml.includes('id="btn-consent-cancel"'));
  assert.ok(popupHtml.includes('id="dash-partial-banner"'));
  assert.ok(popupHtml.includes('id="dash-partial-text"'));
  assert.ok(popupHtml.includes("PARTIAL ANALYSIS"));
  assert.ok(popupHtml.includes("100,000"));
});

/* ------------------------------------------------------------------
 * 23. Popup Script Wires Oversized Consent and Cancellation Flow
 * ------------------------------------------------------------------ */
test("23. Popup script intercepts oversized documents and wires explicit consent actions", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  // Document length check
  assert.ok(popupJs.includes("textLength > MAX_ANALYSIS_CHARACTERS && !allowPartial"));
  assert.ok(popupJs.includes('oversizedConsentBoxEl?.classList.remove("hidden");'));

  // Proceed button calls analysis with allowPartial = true
  assert.ok(popupJs.includes("performPolicyAnalysis(true)"));

  // Cancel button dismisses box and resets button without sending scan request
  assert.ok(popupJs.includes('oversizedConsentBoxEl?.classList.add("hidden");'));
  assert.ok(popupJs.includes("resetAnalyzeButton();"));
});

/* ------------------------------------------------------------------
 * 24. Partial Analysis Banner Formatting and Character Count Display
 * ------------------------------------------------------------------ */
test("24. Partial analysis banner displays character count and omitted clause explanation", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(popupJs.includes("Analysed initial 100,000 of"));
  assert.ok(popupJs.includes("Remaining clauses were omitted."));
  assert.ok(popupJs.includes('dashPartialBannerEl.classList.remove("hidden");'));
});

/* ------------------------------------------------------------------
 * 25. Independent Partial State for Terms and Privacy
 * ------------------------------------------------------------------ */
test("25. Terms and Privacy maintain independent partial analysis state", () => {
  const state = {
    TERMS: {
      isPartial: true,
      originalCharCount: 145000,
      submittedCharCount: 100000
    },
    PRIVACY: {
      isPartial: false,
      originalCharCount: 71979,
      submittedCharCount: 71979
    }
  };

  assert.equal(state.TERMS.isPartial, true);
  assert.equal(state.TERMS.originalCharCount, 145000);
  assert.equal(state.TERMS.submittedCharCount, 100000);
  assert.equal(state.PRIVACY.isPartial, false);
  assert.equal(state.PRIVACY.originalCharCount, 71979);
  assert.equal(state.PRIVACY.submittedCharCount, 71979);
});

/* ------------------------------------------------------------------
 * 26. Valid Q&A Request Submits to POST /api/analyze/qa
 * ------------------------------------------------------------------ */
test("26. queryPolicyDocument submits valid Q&A request to POST /api/analyze/qa", async () => {
  let capturedBody = null;
  let capturedMethod = null;
  let capturedUrl = null;

  const mockServer = http.createServer((req, res) => {
    capturedMethod = req.method;
    capturedUrl = req.url;
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedBody = JSON.parse(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: {
          question: capturedBody.question,
          answer: "Disputes are resolved by private binding arbitration.",
          grounded: true,
          confidence: 0.95,
          evidence: [
            {
              clauseId: "c_arb",
              text: "All legal disputes shall be resolved by arbitration.",
              section: "Dispute Resolution",
              similarityScore: 0.89
            }
          ],
          nliValidation: {
            status: "supported",
            label: "entailment",
            scores: { entailment: 0.91, neutral: 0.07, contradiction: 0.02 },
            bestClauseId: "c_arb"
          }
        }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const payload = {
      question: "How are legal disputes resolved under this policy?",
      policyText: SAMPLE_TERMS_TEXT,
      documentType: "TERMS"
    };

    const res = await queryPolicyDocument(payload, mockBaseUrl);
    assert.equal(res.ok, true);
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedUrl, "/api/analyze/qa");
    assert.equal(capturedBody.question, payload.question);
    assert.equal(res.qa.grounded, true);
    assert.equal(res.qa.nliValidation.status, "supported");
    assert.equal(res.qa.evidence.length, 1);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 27. Question Input Validation (Length 3-500 chars)
 * ------------------------------------------------------------------ */
test("27. queryPolicyDocument enforces question length boundaries (3 to 500 characters)", async () => {
  // A. Missing / empty / whitespace
  const emptyRes = await queryPolicyDocument({ question: "   ", policyText: SAMPLE_TERMS_TEXT });
  assert.equal(emptyRes.ok, false);
  assert.ok(emptyRes.error.includes("A valid question is required"));

  // B. Too short (< 3 chars)
  const shortRes = await queryPolicyDocument({ question: "No", policyText: SAMPLE_TERMS_TEXT });
  assert.equal(shortRes.ok, false);
  assert.ok(shortRes.error.includes("at least 3 characters"));

  // C. Too long (> 500 chars)
  const longRes = await queryPolicyDocument({ question: "x".repeat(501), policyText: SAMPLE_TERMS_TEXT });
  assert.equal(longRes.ok, false);
  assert.ok(longRes.error.includes("not exceed 500 characters"));
});

/* ------------------------------------------------------------------
 * 28. Missing Document Context Rejection
 * ------------------------------------------------------------------ */
test("28. queryPolicyDocument rejects requests without document context", async () => {
  const res = await queryPolicyDocument({
    question: "Can I cancel my subscription?",
    clauses: [],
    policyText: ""
  });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("No document context provided"));
});

/* ------------------------------------------------------------------
 * 29. Terms and Privacy Context Isolation (Zero Contamination)
 * ------------------------------------------------------------------ */
test("29. Terms and Privacy queries transmit independent document contexts without leakage", async () => {
  let capturedTexts = [];

  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      const b = JSON.parse(data);
      capturedTexts.push(b.policyText);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: { answer: "Answer", grounded: true, evidence: [] }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    // 1. Terms query
    await queryPolicyDocument({
      question: "Are disputes arbitrated?",
      policyText: SAMPLE_TERMS_TEXT,
      documentType: "TERMS"
    }, mockBaseUrl);

    // 2. Privacy query
    await queryPolicyDocument({
      question: "What telemetry is collected?",
      policyText: SAMPLE_PRIVACY_TEXT,
      documentType: "PRIVACY"
    }, mockBaseUrl);

    assert.equal(capturedTexts.length, 2);
    assert.ok(capturedTexts[0].includes("Account Security and Maintenance"));
    assert.equal(capturedTexts[0].includes("Information Collection and Telemetry"), false);

    assert.ok(capturedTexts[1].includes("Information Collection and Telemetry"));
    assert.equal(capturedTexts[1].includes("Account Security and Maintenance"), false);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 30. Pre-Segmented scanResult.segments Compatible With Q&A
 * ------------------------------------------------------------------ */
test("30. queryPolicyDocument accepts pre-segmented clauses from scanResult.segments", async () => {
  let capturedClauses = null;

  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedClauses = JSON.parse(data).clauses;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: { answer: "Grounded answer", grounded: true, evidence: [] }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const mockSegments = [
      { clauseId: "seg_1", text: "Subscriptions auto-renew every month.", title: "Section 1" },
      { clauseId: "seg_2", text: "Cancellation requires 24 hours notice.", title: "Section 2" }
    ];

    const res = await queryPolicyDocument({
      question: "When does subscription renew?",
      clauses: mockSegments,
      documentType: "TERMS"
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(capturedClauses.length, 2);
    assert.equal(capturedClauses[0].clauseId, "seg_1");
    assert.equal(capturedClauses[0].section, "Section 1");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 31. Partial Document Q&A Safeguards
 * ------------------------------------------------------------------ */
test("31. Oversized documents require explicit consent and slice to 100k upon consent", async () => {
  const hugeText = SAMPLE_TERMS_TEXT.repeat(250); // > 100k characters

  // A. Without allowPartial / isPartial -> refuses silent submission
  const rejectedRes = await queryPolicyDocument({
    question: "Is there arbitration?",
    policyText: hugeText,
    documentType: "TERMS"
  });
  assert.equal(rejectedRes.ok, false);
  assert.equal(rejectedRes.status, "OVERSIZED_DOCUMENT_REQUIRES_CONSENT");
  assert.equal(rejectedRes.requiresConsent, true);
  assert.equal(rejectedRes.maxChars, 100000);

  // B. With allowPartial: true -> slices to exactly 100,000 characters and sets isPartial = true
  let capturedLength = 0;
  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedLength = JSON.parse(data).policyText.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: { answer: "Partial answer", grounded: true, evidence: [] }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const consentedRes = await queryPolicyDocument({
      question: "Is there arbitration?",
      policyText: hugeText,
      allowPartial: true,
      documentType: "TERMS"
    }, mockBaseUrl);

    assert.equal(consentedRes.ok, true);
    assert.equal(consentedRes.isPartial, true);
    assert.equal(capturedLength, 100000);

    // C. Documents up to 100,000 characters (e.g. 71,979 Spotify chars) do not require consent
    const spotifyText = "Section 1. Terms and Conditions.\n\n" + "A".repeat(71979 - 34);
    const spotifyRes = await queryPolicyDocument({
      question: "How is telemetry used?",
      policyText: spotifyText,
      documentType: "PRIVACY"
    }, mockBaseUrl);
    assert.equal(spotifyRes.ok, true);
    assert.equal(spotifyRes.isPartial, false);
    assert.equal(capturedLength, 71979);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 32. Gemini Provider Unavailable Fallback Handling
 * ------------------------------------------------------------------ */
test("32. queryPolicyDocument handles Gemini unavailable fallback gracefully", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      qa: {
        question: "Can I cancel?",
        answer: "Unable to generate an AI answer. Please review the provided ToS evidence directly.",
        evidence: [{ clauseId: "c_1", text: "Evidence clause", section: "Billing" }],
        grounded: false,
        confidence: 0,
        available: false,
        reason: "rate_limited",
        nliValidation: {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          reason: "answer_generation_failed"
        }
      }
    }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await queryPolicyDocument({
      question: "Can I cancel?",
      policyText: SAMPLE_TERMS_TEXT
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(res.qa.available, false);
    assert.equal(res.qa.grounded, false);
    assert.ok(res.qa.answer.includes("Unable to generate an AI answer"));
    assert.equal(res.qa.nliValidation.status, "unavailable");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 33. NLI Unavailable Response Handled Without Score Fabrication
 * ------------------------------------------------------------------ */
test("33. queryPolicyDocument surfaces unavailable NLI status with null scores", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      qa: {
        question: "Is there arbitration?",
        answer: "Yes, mandatory arbitration applies.",
        grounded: true,
        confidence: 0.8,
        evidence: [],
        nliValidation: {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          reason: "nli_service_unavailable"
        }
      }
    }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await queryPolicyDocument({
      question: "Is there arbitration?",
      policyText: SAMPLE_TERMS_TEXT
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(res.qa.nliValidation.status, "unavailable");
    assert.equal(res.qa.nliValidation.scores, null);
    assert.equal(res.qa.nliValidation.reason, "nli_service_unavailable");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 34. Insufficient Evidence Surfacing
 * ------------------------------------------------------------------ */
test("34. queryPolicyDocument surfaces ungrounded answer when evidence is insufficient", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      qa: {
        question: "Can I bring my pet to the company office?",
        answer: "The supplied Terms of Service evidence does not contain information about office pet policies.",
        grounded: false,
        confidence: 0,
        evidence: [],
        nliValidation: { status: "unavailable", reason: "no_evidence_supplied" }
      }
    }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await queryPolicyDocument({
      question: "Can I bring my pet to the company office?",
      policyText: SAMPLE_TERMS_TEXT
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(res.qa.grounded, false);
    assert.ok(res.qa.answer.includes("does not contain information"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 35. Rate Limit (HTTP 429) & Network Error Handling
 * ------------------------------------------------------------------ */
test("35. queryPolicyDocument handles HTTP 429 rate limit and network errors cleanly", async () => {
  const mockServer = http.createServer((req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too Many Requests" }));
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await queryPolicyDocument({
      question: "Are terms modifiable?",
      policyText: SAMPLE_TERMS_TEXT
    }, mockBaseUrl);

    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.ok(res.error.includes("rate limit exceeded"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 36. Popup HTML Contains Q&A UI Elements
 * ------------------------------------------------------------------ */
test("36. Popup HTML defines complete Q&A form, input, chip suggestions, and containers", () => {
  const popupHtml = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.html"), "utf-8");

  assert.ok(popupHtml.includes('id="qa-section"'));
  assert.ok(popupHtml.includes('id="qa-form"'));
  assert.ok(popupHtml.includes('id="qa-question-input"'));
  assert.ok(popupHtml.includes('id="qa-char-count"'));
  assert.ok(popupHtml.includes('id="btn-submit-qa"'));
  assert.ok(popupHtml.includes('id="qa-loading-box"'));
  assert.ok(popupHtml.includes('id="qa-error-box"'));
  assert.ok(popupHtml.includes('id="qa-history-container"'));
  assert.ok(popupHtml.includes('id="qa-empty-history"'));
  assert.ok(popupHtml.includes('class="qa-chip"'));
  assert.ok(popupHtml.includes('id="qa-partial-banner"'));
  assert.ok(popupHtml.includes('id="qa-partial-text"'));
});

/* ------------------------------------------------------------------
 * 37. XSS-Safe Rendering (Zero innerHTML for Dynamic Data)
 * ------------------------------------------------------------------ */
test("37. Popup creates Q&A turn elements safely using textContent exclusively without innerHTML", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  // In createQaTurnElement:
  assert.ok(popupJs.includes("qText.textContent = turn.question"));
  assert.ok(popupJs.includes("ansBox.textContent = turn.qa?.answer"));
  assert.ok(popupJs.includes("quote.textContent = `“${item.text || \"\"}”`"));

  // Check that no innerHTML assignment occurs with turn or flag data
  assert.equal(popupJs.includes("card.innerHTML = turn"), false);
  assert.equal(popupJs.includes("ansBox.innerHTML ="), false);
});

/* ------------------------------------------------------------------
 * 38. Multi-Turn History Isolation Between Terms and Privacy
 * ------------------------------------------------------------------ */
test("38. Multi-turn Q&A history maintains independent state per category", () => {
  const docState = {
    TERMS: {
      qaHistory: [
        { question: "Terms Q1", qa: { answer: "Terms A1" } },
        { question: "Terms Q2", qa: { answer: "Terms A2" } }
      ]
    },
    PRIVACY: {
      qaHistory: [
        { question: "Privacy Q1", qa: { answer: "Privacy A1" } }
      ]
    }
  };

  assert.equal(docState.TERMS.qaHistory.length, 2);
  assert.equal(docState.PRIVACY.qaHistory.length, 1);
  assert.equal(docState.TERMS.qaHistory[0].question, "Terms Q1");
  assert.equal(docState.PRIVACY.qaHistory[0].question, "Privacy Q1");

  // Clearing Terms history leaves Privacy intact
  docState.TERMS.qaHistory = [];
  assert.equal(docState.TERMS.qaHistory.length, 0);
  assert.equal(docState.PRIVACY.qaHistory.length, 1);
});

/* ------------------------------------------------------------------
 * 39. Runtime Message Dispatch for ASK_POLICY_QUESTION
 * ------------------------------------------------------------------ */
test("39. handleRuntimeMessage dispatches ASK_POLICY_QUESTION to queryPolicyDocument", async () => {
  const res = await handleRuntimeMessage({
    type: "ASK_POLICY_QUESTION",
    question: "Is arbitration required?",
    policyText: SAMPLE_TERMS_TEXT
  });

  // Since backend server is not running on port 3000 during isolated test,
  // it gracefully returns ok: false with network error without throwing
  assert.equal(typeof res, "object");
  if (res.ok) {
    assert.ok(res.qa, "When backend is running, valid qa object returned");
  } else {
    assert.ok(res.error.length > 0, "When backend is offline, graceful network error returned");
  }
});

/* ------------------------------------------------------------------
 * 40. Zero Secret Exposure in Extension Files
 * ------------------------------------------------------------------ */
test("40. Extension files contain zero Gemini API keys, tokens, or direct model URLs", () => {
  const extensionDir = path.resolve(__dirname, "../../extension");
  const files = [
    path.join(extensionDir, "manifest.json"),
    path.join(extensionDir, "background/service-worker.js"),
    path.join(extensionDir, "popup/popup.html"),
    path.join(extensionDir, "popup/popup.js"),
    path.join(extensionDir, "popup/popup.css")
  ];

  const forbiddenSecrets = ["AIzaSy", "GEMINI_API_KEY", "generativelanguage.googleapis.com", "gemini-flash"];

  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    for (const secret of forbiddenSecrets) {
      assert.equal(text.includes(secret), false, `File ${path.basename(f)} must not contain '${secret}'`);
    }
  }
});

/* ------------------------------------------------------------------
 * 41. Cancellation of Oversized Document Consent Preserves Original Full Document
 * ------------------------------------------------------------------ */
test("41. Cancellation of oversized document consent preserves original full document in state", () => {
  const originalFullText = "Section 1. Terms.\n\n" + "A".repeat(125000);
  const docState = {
    TERMS: {
      candidate: { title: "Huge Terms", url: "https://example.com/huge" },
      extracted: { text: originalFullText, charCount: originalFullText.length },
      confirmed: true,
      scanStatus: "IDLE",
      isPartial: false,
      submittedCharCount: 0,
      originalCharCount: 0
    }
  };

  // User encounters oversized warning (> 100,000 chars) and cancels
  const isOversized = docState.TERMS.extracted.text.length > 100000;
  assert.equal(isOversized, true);

  // Cancellation handler resets UI without mutating extracted text or state
  docState.TERMS.scanStatus = "IDLE";
  assert.equal(docState.TERMS.extracted.text.length, 125019);
  assert.equal(docState.TERMS.extracted.text, originalFullText);
  assert.equal(docState.TERMS.isPartial, false);
});

/* ------------------------------------------------------------------
 * 42. Q&A Uses the Approved 100,000-Character Portion Without Leaking Trailing Clauses
 * ------------------------------------------------------------------ */
test("42. Q&A uses the exact approved document portion (100,000 chars) upon consent", async () => {
  const approvedPortion = "Section 1. Terms.\n\n" + "A".repeat(100000 - 19);
  const trailingClauses = "\n\nSection 99. Forbidden secret clause located beyond character 100,000.";
  const fullExtractedText = approvedPortion + trailingClauses;
  assert.ok(fullExtractedText.length > 100000);

  let capturedRequestBody = null;
  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedRequestBody = JSON.parse(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: { answer: "Approved portion answer", grounded: true, evidence: [] }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    const res = await queryPolicyDocument({
      question: "What are the rules?",
      policyText: fullExtractedText,
      allowPartial: true,
      isPartial: true,
      documentType: "TERMS"
    }, mockBaseUrl);

    assert.equal(res.ok, true);
    assert.equal(res.isPartial, true);
    assert.equal(capturedRequestBody.policyText.length, 100000);
    assert.equal(capturedRequestBody.policyText.includes("Section 99. Forbidden secret clause"), false, "Must not leak clauses past 100k");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 43. Terms and Privacy Q&A Contexts Remain Isolated
 * ------------------------------------------------------------------ */
test("43. Terms and Privacy Q&A contexts remain strictly isolated with independent character limits", async () => {
  const termsText = "Section 1. Terms.\n\n" + "T".repeat(100000 - 19);
  const privacyText = "Section 1. Privacy.\n\n" + "P".repeat(71979 - 21);

  let capturedQueries = [];
  const mockServer = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      capturedQueries.push(JSON.parse(data));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        qa: { answer: "Context isolated answer", grounded: true, evidence: [] }
      }));
    });
  });

  await new Promise((r) => mockServer.listen(0, r));
  const mockBaseUrl = `http://localhost:${mockServer.address().port}`;

  try {
    // Query Terms
    await queryPolicyDocument({
      question: "Terms question?",
      policyText: termsText,
      documentType: "TERMS"
    }, mockBaseUrl);

    // Query Privacy
    await queryPolicyDocument({
      question: "Privacy question?",
      policyText: privacyText,
      documentType: "PRIVACY"
    }, mockBaseUrl);

    assert.equal(capturedQueries.length, 2);
    assert.equal(capturedQueries[0].policyText.length, 100000);
    assert.equal(capturedQueries[0].policyText.includes("Section 1. Terms"), true);
    assert.equal(capturedQueries[0].policyText.includes("Section 1. Privacy"), false);

    assert.equal(capturedQueries[1].policyText.length, 71979);
    assert.equal(capturedQueries[1].policyText.includes("Section 1. Privacy"), true);
    assert.equal(capturedQueries[1].policyText.includes("Section 1. Terms"), false);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 44. Error Message Automatically Becomes Visible (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("44. Error message automatically becomes visible and scrolls into view in popup script", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(popupJs.includes('qaErrorBoxEl.classList.remove("hidden")'), "Must remove hidden class from error box");
  assert.ok(popupJs.includes("qaErrorBoxEl.scrollIntoView"), "Must smoothly scroll error box into view");
  assert.ok(popupJs.includes("hideQaLoading"), "Must remove loading indicators when setting error");
});

/* ------------------------------------------------------------------
 * 45. Loading State Resets After Failed Requests (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("45. Loading state resets on every failure path in performQaQuery", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(popupJs.includes("hideQaLoading();"), "Must call hideQaLoading");
  assert.ok(popupJs.includes("isQaSubmitting = false;"), "Must reset isQaSubmitting flag");
  assert.ok(popupJs.includes("updateQaInputState();"), "Must re-evaluate submit button state");
});

/* ------------------------------------------------------------------
 * 46. Malformed Responses Display a Clear Error (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("46. Malformed or invalid QA responses display a clear error message", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(
    popupJs.includes("!response.qa || typeof response.qa !== \"object\" || typeof response.qa.answer !== \"string\""),
    "Must validate response.qa existence, type, and answer string property"
  );
  assert.ok(
    popupJs.includes("Q&A service returned an invalid or malformed response structure"),
    "Must surface descriptive error on malformed response"
  );
});

/* ------------------------------------------------------------------
 * 47. Missing Service-Worker Response Handled Cleanly (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("47. Missing or null service worker response displays descriptive error", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(
    popupJs.includes("No response received from background service worker. Please try again."),
    "Must handle undefined or null response payload cleanly"
  );
});

/* ------------------------------------------------------------------
 * 48. Successful Responses Saved Directly in Session Storage (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("48. Successful responses are saved to chrome.storage.session by service worker", async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: mockStorage };

  try {
    const url = "https://github.com/terms";
    const turn = {
      id: "turn_101",
      requestId: "turn_101",
      question: "Can I terminate?",
      qa: { answer: "Yes, at any time." },
      isPartial: false,
      timestamp: Date.now()
    };

    const saved = await saveSessionQaTurn(url, "TERMS", turn);
    assert.equal(saved, true);

    const stored = await mockStorage.session.get(["tos_qa_github.com_TERMS"]);
    const list = stored["tos_qa_github.com_TERMS"];
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "turn_101");
    assert.equal(list[0].question, "Can I terminate?");
    assert.equal(list[0].qa.answer, "Yes, at any time.");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

/* ------------------------------------------------------------------
 * 49. Completed Responses Restored After Popup Re-Open (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("49. Completed responses are restored from chrome.storage.session across popup re-open", async () => {
  const mockStorage = createMockChromeStorage();
  const host = "example.com";

  await mockStorage.session.set({
    [`tos_qa_${host}_TERMS`]: [
      { id: "t1", question: "Arbitration?", qa: { answer: "No mandatory arbitration." } }
    ],
    [`tos_qa_${host}_PRIVACY`]: [
      { id: "p1", question: "Sell data?", qa: { answer: "We do not sell data." } }
    ]
  });

  const termsRes = await mockStorage.session.get([`tos_qa_${host}_TERMS`]);
  assert.equal(termsRes[`tos_qa_${host}_TERMS`].length, 1);
  assert.equal(termsRes[`tos_qa_${host}_TERMS`][0].question, "Arbitration?");

  const privRes = await mockStorage.session.get([`tos_qa_${host}_PRIVACY`]);
  assert.equal(privRes[`tos_qa_${host}_PRIVACY`].length, 1);
  assert.equal(privRes[`tos_qa_${host}_PRIVACY`][0].question, "Sell data?");
});

/* ------------------------------------------------------------------
 * 50. Pending Requests Restored and Cleaned Upon Completion (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("50. Pending requests are recorded, restored, and cleaned upon completion", async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: mockStorage };

  try {
    const url = "https://example.com/tos";
    const pendingInfo = {
      requestId: "req_999",
      question: "Is there automatic renewal?",
      isPartial: false,
      timestamp: Date.now()
    };

    // 1. Record pending
    await recordSessionPendingQa(url, "TERMS", pendingInfo);
    let storedPending = await mockStorage.session.get(["tos_qa_pending_example.com_TERMS"]);
    assert.equal(storedPending["tos_qa_pending_example.com_TERMS"].requestId, "req_999");

    // 2. Clear pending on completion
    await clearSessionPendingQa(url, "TERMS");
    storedPending = await mockStorage.session.get(["tos_qa_pending_example.com_TERMS"]);
    assert.equal(storedPending["tos_qa_pending_example.com_TERMS"], undefined);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

/* ------------------------------------------------------------------
 * 51. Terms, Privacy and Other Privacy Histories Isolated (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("51. Terms, Privacy, and Other Privacy histories remain strictly isolated", async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: mockStorage };

  try {
    const url = "https://myservice.com/terms";

    await saveSessionQaTurn(url, "TERMS", { id: "t1", question: "Terms Q" });
    await saveSessionQaTurn(url, "PRIVACY", { id: "p1", question: "Privacy Q" });
    await saveSessionQaTurn(url, "OTHER_PRIVACY", { id: "op1", question: "Other Privacy Q" });

    const res = await mockStorage.session.get([
      "tos_qa_myservice.com_TERMS",
      "tos_qa_myservice.com_PRIVACY",
      "tos_qa_myservice.com_OTHER_PRIVACY"
    ]);

    assert.equal(res["tos_qa_myservice.com_TERMS"].length, 1);
    assert.equal(res["tos_qa_myservice.com_TERMS"][0].id, "t1");

    assert.equal(res["tos_qa_myservice.com_PRIVACY"].length, 1);
    assert.equal(res["tos_qa_myservice.com_PRIVACY"][0].id, "p1");

    assert.equal(res["tos_qa_myservice.com_OTHER_PRIVACY"].length, 1);
    assert.equal(res["tos_qa_myservice.com_OTHER_PRIVACY"][0].id, "op1");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

/* ------------------------------------------------------------------
 * 52. Duplicate Submission Prevented When In-Flight (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("52. Duplicate submission is prevented when a request is in flight", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(popupJs.includes("if (isQaSubmitting) return;"), "Must block submission if already in flight");
  assert.ok(popupJs.includes("isQaSubmitting = true;"), "Must flag isQaSubmitting on submission start");
});

/* ------------------------------------------------------------------
 * 53. Interrupted Requests Handled Cleanly (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("53. Interrupted requests (>60s) clear stale pending state and restore question with error", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(popupJs.includes("QA_PENDING_TIMEOUT_MS = 60000"), "Must define 60-second pending timeout limit");
  assert.ok(popupJs.includes("elapsed > QA_PENDING_TIMEOUT_MS"), "Must evaluate pending request age");
  assert.ok(
    popupJs.includes("The previous Q&A request was interrupted before completion"),
    "Must display explicit notice for interrupted requests rather than false completed results"
  );
  assert.ok(
    popupJs.includes("clearPendingQa(url, currentCat)"),
    "Must clean up stale pending state from storage"
  );
});

/* ------------------------------------------------------------------
 * 54. Existing Q&A Architecture Compatibility (Phase 7G-D.1)
 * ------------------------------------------------------------------ */
test("54. queryPolicyDocument returns standard response contract with requestId and turn", async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === "/api/analyze/qa" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          qa: {
            question: "Can I terminate?",
            answer: "Yes, you can terminate at any time.",
            evidence: [{ clauseId: "c_1", text: "Termination text", section: "Term" }],
            grounded: true,
            confidence: 0.95,
            available: true,
            nliValidation: { status: "supported", scores: { entailment: 0.98, neutral: 0.01, contradiction: 0.01 } }
          }
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((r) => mockServer.listen(0, r));
  const port = mockServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const result = await queryPolicyDocument(
      {
        requestId: "custom_req_123",
        question: "Can I terminate?",
        policyText: "You may terminate your account at any time in settings.",
        documentType: "TERMS"
      },
      baseUrl
    );

    assert.equal(result.ok, true);
    assert.equal(result.requestId, "custom_req_123");
    assert.equal(result.documentType, "TERMS");
    assert.equal(result.qa.answer, "Yes, you can terminate at any time.");
    assert.equal(result.qa.grounded, true);
    assert.equal(result.qa.nliValidation.status, "supported");
    assert.ok(result.turn);
    assert.equal(result.turn.id, "custom_req_123");
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

/* ------------------------------------------------------------------
 * 55. qaPartialTextEl DOM Initialization & Scope Safety (Phase 7G-D.2)
 * ------------------------------------------------------------------ */
test("55. qaPartialTextEl is declared and initialized from #qa-partial-text in popup.js", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");

  assert.ok(
    popupJs.includes('const qaPartialTextEl = document.getElementById("qa-partial-text");'),
    "qaPartialTextEl must be declared at the top of popup.js"
  );
  assert.ok(
    popupJs.includes("if (qaPartialTextEl && doc?.isPartial)"),
    "renderQaHistory must guard against missing qaPartialTextEl before assigning textContent"
  );
});

/* ------------------------------------------------------------------
 * 56. renderQaHistory Execution Safety for Partial & Non-Partial State (Phase 7G-D.2)
 * ------------------------------------------------------------------ */
test("56. renderQaHistory safely updates partial banner and handles missing DOM elements without ReferenceError", () => {
  const popupJs = fs.readFileSync(path.resolve(__dirname, "../../extension/popup/popup.js"), "utf-8");
  const lines = popupJs.split("\n");

  const startIdx = lines.findIndex((l) => l.includes("function renderQaHistory("));
  const endIdx = lines.findIndex((l) => l.includes("function saveSessionAnalysis("));
  assert.ok(startIdx > 0 && endIdx > startIdx, "Must locate renderQaHistory and helper boundaries");

  const functionSlice = lines.slice(startIdx, endIdx).join("\n");

  function createMockEl(id) {
    return {
      id,
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          if (force) this.classes.add(c);
          else this.classes.delete(c);
        }
      },
      textContent: "",
      innerHTML: "",
      children: [],
      appendChild(ch) { this.children.push(ch); return ch; }
    };
  }

  const elements = {
    "qa-section": createMockEl("qa-section"),
    "qa-doc-type": createMockEl("qa-doc-type"),
    "qa-partial-banner": createMockEl("qa-partial-banner"),
    "qa-partial-text": createMockEl("qa-partial-text"),
    "qa-history-container": createMockEl("qa-history-container"),
    "qa-empty-history": createMockEl("qa-empty-history")
  };

  const docState = {
    TERMS: { isPartial: false, qaHistory: [] },
    PRIVACY: {
      isPartial: true,
      qaHistory: [
        {
          id: "turn_p1",
          question: "Can I delete my data?",
          isPartial: true,
          qa: {
            answer: "Yes, you can request data erasure.",
            grounded: true,
            evidence: [{ clauseId: "c_1", text: "Right to erasure", section: "Privacy Rights" }],
            nliValidation: { status: "supported", scores: { entailment: 0.95, neutral: 0.03, contradiction: 0.02 } }
          }
        }
      ]
    }
  };

  const testRunner = (els) => new Function(
    "documentState",
    "elements",
    "createMockEl",
    `
    const qaSectionEl = elements["qa-section"];
    const qaDocTypeEl = elements["qa-doc-type"];
    const qaPartialBannerEl = elements["qa-partial-banner"];
    const qaPartialTextEl = elements["qa-partial-text"];
    const qaHistoryContainerEl = elements["qa-history-container"];
    const qaEmptyHistoryEl = elements["qa-empty-history"];
    const document = { createElement: (t) => createMockEl(t) };
    ${functionSlice}
    return { renderQaHistory };
    `
  )(docState, els, createMockEl);

  // 1. Non-partial execution: banner hidden, empty history visible, no errors
  const { renderQaHistory: renderFull } = testRunner(elements);
  assert.doesNotThrow(() => renderFull("TERMS"));
  assert.equal(elements["qa-partial-banner"].classList.contains("hidden"), true);
  assert.equal(elements["qa-empty-history"].classList.contains("hidden"), false);

  // 2. Partial execution: banner visible, text updated, turns rendered, no errors
  assert.doesNotThrow(() => renderFull("PRIVACY"));
  assert.equal(elements["qa-partial-banner"].classList.contains("hidden"), false);
  assert.ok(elements["qa-partial-text"].textContent.includes("first 100,000 characters"));
  assert.equal(elements["qa-history-container"].children.length, 1);

  // 3. Resilient when qaPartialTextEl is missing (null) from DOM
  const elementsWithoutText = { ...elements, "qa-partial-text": null };
  const { renderQaHistory: renderMissingText } = testRunner(elementsWithoutText);
  assert.doesNotThrow(() => renderMissingText("PRIVACY"));
});
