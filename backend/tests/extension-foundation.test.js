import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  checkBackendHealth,
  handleRuntimeMessage,
  detectPoliciesOnTab,
  validateMessageSender,
  PRIVILEGED_MESSAGE_ACTIONS
} from "../../extension/background/service-worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");

/* ------------------------------------------------------------------
 * 1. Manifest V3 Integrity & Least-Privilege Verification
 * ------------------------------------------------------------------ */

test("manifest.json exists and adheres strictly to Manifest V3 requirements", () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist in extension directory");

  const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.manifest_version, 3, "Must use Manifest Version 3");
  assert.equal(manifest.name, "TOS Red Flag Scanner");
  assert.equal(manifest.version, "1.0.0");
  assert.ok(manifest.description && manifest.description.length > 10);

  // Background service worker
  assert.ok(manifest.background, "Background worker must be defined");
  assert.equal(manifest.background.service_worker, "background/service-worker.js");
  assert.equal(manifest.background.type, "module");

  // Popup action
  assert.ok(manifest.action, "Action popup must be defined");
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.equal(manifest.action.default_title, "TOS Red Flag Scanner");

  // Permissions: strictly minimal
  assert.ok(Array.isArray(manifest.permissions), "Permissions must be an array");
  assert.ok(manifest.permissions.includes("activeTab"), "Should have activeTab");
  assert.ok(manifest.permissions.includes("storage"), "Should have storage");

  // Verify dangerous / overly broad permissions are NOT requested
  const disallowedPermissions = ["<all_urls>", "cookies", "history", "webNavigation", "webRequest", "management", "debugger"];
  for (const perm of disallowedPermissions) {
    assert.equal(manifest.permissions.includes(perm), false, `Must NOT request ${perm}`);
  }

  // Host permissions: strictly limited to local backend
  assert.ok(Array.isArray(manifest.host_permissions), "host_permissions must be an array");
  assert.equal(manifest.host_permissions.length, 1);
  assert.equal(manifest.host_permissions[0], "http://localhost:3000/*");
  assert.equal(manifest.host_permissions.includes("*://*/*"), false, "Must not allow all host URLs");
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false, "Must not allow <all_urls>");
});

test("extension icon files exist and have valid PNG signatures", () => {
  const sizes = [16, 32, 48, 128];
  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  for (const size of sizes) {
    const iconPath = path.join(EXTENSION_DIR, "assets", "icons", `icon-${size}.png`);
    assert.ok(fs.existsSync(iconPath), `Icon ${iconPath} must exist`);

    const bytes = fs.readFileSync(iconPath);
    assert.ok(bytes.length > 50, `Icon file size too small: ${bytes.length} bytes`);
    assert.deepEqual(bytes.subarray(0, 8), pngMagic, `Icon ${size} must have valid PNG signature`);
  }
});

/* ------------------------------------------------------------------
 * 2. Popup UI & Script Integrity
 * ------------------------------------------------------------------ */

test("popup files exist and contain required UI elements", () => {
  const popupHtmlPath = path.join(EXTENSION_DIR, "popup", "popup.html");
  const popupCssPath = path.join(EXTENSION_DIR, "popup", "popup.css");
  const popupJsPath = path.join(EXTENSION_DIR, "popup", "popup.js");

  assert.ok(fs.existsSync(popupHtmlPath), "popup.html must exist");
  assert.ok(fs.existsSync(popupCssPath), "popup.css must exist");
  assert.ok(fs.existsSync(popupJsPath), "popup.js must exist");

  const html = fs.readFileSync(popupHtmlPath, "utf-8");
  assert.ok(html.includes("TOS Red Flag Scanner"), "Header title must match branding");
  assert.ok(html.includes('id="site-hostname"'), "Target site hostname element must exist");
  assert.ok(html.includes('id="status-dot"'), "Status indicator dot must exist");
  assert.ok(html.includes('id="status-text"'), "Status text element must exist");
  assert.ok(html.includes('id="btn-check-connection"'), "Check Connection button must exist");
  assert.ok(html.includes("popup.css"), "Must link stylesheet");
  assert.ok(html.includes("popup.js"), "Must load popup script");

  const css = fs.readFileSync(popupCssPath, "utf-8");
  assert.ok(css.includes("--bg-canvas: #101315"), "Must share dark design system palette");
  assert.ok(css.includes("--status-connected"), "Must define connected state styling");
  assert.ok(css.includes("--status-offline"), "Must define offline state styling");
});

/* ------------------------------------------------------------------
 * 3. Background Service Worker Health & Message Handling
 * ------------------------------------------------------------------ */

test("checkBackendHealth returns connected when backend is online and healthy", async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: "2026-11-13T12:00:00.000Z" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((r) => mockServer.listen(0, r));
  const port = mockServer.address().port;
  const mockBaseUrl = `http://localhost:${port}`;

  try {
    const result = await checkBackendHealth(mockBaseUrl);
    assert.equal(result.ok, true);
    assert.equal(result.status, "connected");
    assert.equal(result.message, "Backend Connected");
    assert.ok(result.timestamp);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

test("checkBackendHealth handles 403 CORS unconfigured gracefully", async () => {
  const mockServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CORS origin not allowed." }));
    }
  });

  await new Promise((r) => mockServer.listen(0, r));
  const port = mockServer.address().port;
  const mockBaseUrl = `http://localhost:${port}`;

  try {
    const result = await checkBackendHealth(mockBaseUrl);
    assert.equal(result.ok, false);
    assert.equal(result.status, "cors_unconfigured");
    assert.ok(result.message.includes("CORS Unconfigured"));
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

test("checkBackendHealth returns disconnected when backend is offline or port is closed", async () => {
  // Port 59998 is unlikely to be listening
  const deadBaseUrl = "http://localhost:59998";
  const result = await checkBackendHealth(deadBaseUrl);

  assert.equal(result.ok, false);
  assert.equal(result.status, "disconnected");
  assert.equal(result.message, "Backend Offline — Start the TOS Red Flag Scanner backend.");
  assert.ok(result.error);
});

test("handleRuntimeMessage dispatches messages correctly and supports action aliases", async () => {
  // 1. GET_INFO (type and action)
  const infoRes1 = await handleRuntimeMessage({ type: "GET_INFO" });
  assert.equal(infoRes1.ok, true);
  assert.equal(infoRes1.version, "1.0.0");
  assert.equal(infoRes1.backendUrl, "http://localhost:3000");

  const infoRes2 = await handleRuntimeMessage({ action: "info" });
  assert.equal(infoRes2.ok, true);

  // 2. DETECT_POLICIES recognized via type or action, case-insensitively
  // When chrome.scripting is not available in node, it returns the expected environment error
  // instead of "Unknown message type"
  const detectByType = await handleRuntimeMessage({
    type: "DETECT_POLICIES",
    tabId: 101,
    tabUrl: "https://example.com"
  });
  assert.notEqual(detectByType.error, "Unknown message type: DETECT_POLICIES");

  const detectByAction = await handleRuntimeMessage({
    action: "detect_policies",
    tabId: 101,
    tabUrl: "https://example.com"
  });
  assert.notEqual(detectByAction.error, "Unknown message type: detect_policies");

  const detectByAlias = await handleRuntimeMessage({
    type: "RUN_DETECTION",
    tabId: 101,
    tabUrl: "https://example.com"
  });
  assert.notEqual(detectByAlias.error, "Unknown message type: RUN_DETECTION");

  // 3. Unknown message type
  const unknownRes = await handleRuntimeMessage({ type: "NON_EXISTENT" });
  assert.equal(unknownRes.ok, false);
  assert.ok(unknownRes.error.includes("Unknown message type: NON_EXISTENT"));

  // 4. Invalid payload
  const invalidRes = await handleRuntimeMessage(null);
  assert.equal(invalidRes.ok, false);
});

test("detectPoliciesOnTab handles tab validation, activeTab fallback, and execution", async () => {
  // 1. Rejects invalid tab ID when chrome.tabs.query is unavailable
  const resNoTab = await detectPoliciesOnTab(null, "https://example.com");
  assert.equal(resNoTab.ok, false);
  assert.ok(resNoTab.error.includes("Valid tab ID is required"));

  // 2. Rejects restricted browser schemes
  const resRestricted = await detectPoliciesOnTab(101, "chrome://settings");
  assert.equal(resRestricted.ok, false);
  assert.ok(resRestricted.error.includes("Cannot scan internal or restricted"));

  // 3. Direct capture from chrome.scripting.executeScript
  const originalChrome = globalThis.chrome;
  try {
    let scriptExecuted = false;
    globalThis.chrome = {
      scripting: {
        executeScript: async ({ target, files }) => {
          assert.equal(target.tabId, 202);
          assert.equal(files[0], "content/content-script.js");
          scriptExecuted = true;
          return [
            {
              result: {
                ok: true,
                terms: [{ title: "Terms of Service", url: "https://example.com/terms" }],
                privacy: [{ title: "Privacy Policy", url: "https://example.com/privacy" }],
                totalDetected: 2
              }
            }
          ];
        }
      }
    };

    const resSuccess = await detectPoliciesOnTab(202, "https://example.com/login");
    assert.equal(scriptExecuted, true);
    assert.equal(resSuccess.ok, true);
    assert.equal(resSuccess.totalDetected, 2);
    assert.equal(resSuccess.terms.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }

  // 4. Fallback to activeTab query when tabId is omitted
  try {
    globalThis.chrome = {
      tabs: {
        query: (queryInfo, callback) => {
          callback([{ id: 505, url: "https://github.com/login" }]);
        }
      },
      scripting: {
        executeScript: async ({ target }) => {
          assert.equal(target.tabId, 505);
          return [{ result: { ok: true, terms: [], privacy: [], totalDetected: 0 } }];
        }
      }
    };

    const resAutoTab = await detectPoliciesOnTab(undefined, undefined);
    assert.equal(resAutoTab.ok, true);
    assert.equal(resAutoTab.totalDetected, 0);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

/* ------------------------------------------------------------------
 * 4. Secrets & Hardcoded Credentials Audit
 * ------------------------------------------------------------------ */

test("extension directory contains zero API keys, secrets, or credential tokens", () => {
  const filesToCheck = [
    MANIFEST_PATH,
    path.join(EXTENSION_DIR, "background", "service-worker.js"),
    path.join(EXTENSION_DIR, "popup", "popup.html"),
    path.join(EXTENSION_DIR, "popup", "popup.js")
  ];

  const secretKeywords = ["AIzaSy", "nvapi-", "sk-", "password", "secret_key"];

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const secret of secretKeywords) {
      assert.equal(
        content.includes(secret),
        false,
        `File ${path.basename(filePath)} must not contain secret token '${secret}'`
      );
    }
  }
});

/* ------------------------------------------------------------------
 * 5. Message Sender Validation & Extension Security Boundary (SEC-EXT-1)
 * ------------------------------------------------------------------ */

test("SEC-EXT-1: PRIVILEGED_MESSAGE_ACTIONS contains all sensitive operations", () => {
  assert.ok(PRIVILEGED_MESSAGE_ACTIONS instanceof Set);
  const requiredPrivileged = [
    "ANALYZE_CONFIRMED_POLICY",
    "ASK_POLICY_QUESTION",
    "EXTRACT_POLICY",
    "DETECT_POLICIES",
    "CHECK_HEALTH"
  ];
  for (const action of requiredPrivileged) {
    assert.equal(PRIVILEGED_MESSAGE_ACTIONS.has(action), true, `Must protect ${action}`);
  }
});

test("SEC-EXT-1: validateMessageSender rejects missing, null, or non-object sender", () => {
  const resNull = validateMessageSender(null);
  assert.equal(resNull.valid, false);
  assert.equal(resNull.status, "forbidden");
  assert.ok(resNull.error.includes("missing or invalid"));

  const resString = validateMessageSender("invalid_sender");
  assert.equal(resString.valid, false);
  assert.equal(resString.status, "forbidden");

  const resUndefined = validateMessageSender(undefined);
  assert.equal(resUndefined.valid, false);
  assert.equal(resUndefined.status, "forbidden");
});

test("SEC-EXT-1: validateMessageSender rejects sender with mismatched extension ID", () => {
  const untrustedSender = {
    id: "malicious_extension_id_abcdefghij",
    url: "chrome-extension://malicious_extension_id_abcdefghij/popup.html",
    origin: "chrome-extension://malicious_extension_id_abcdefghij"
  };

  const res = validateMessageSender(untrustedSender, { type: "GET_INFO" }, "authorized_extension_id_12345678");
  assert.equal(res.valid, false);
  assert.equal(res.status, "forbidden");
  assert.ok(res.error.includes("does not match expected"));
});

test("SEC-EXT-1: validateMessageSender rejects untrusted external web origins", () => {
  const webSender = {
    id: "tos_scanner_extension_id",
    origin: "https://malicious.example.com",
    url: "https://malicious.example.com/phishing.html",
    tab: { id: 42 }
  };

  const res = validateMessageSender(webSender, { type: "CHECK_HEALTH" }, "tos_scanner_extension_id");
  assert.equal(res.valid, false);
  assert.equal(res.status, "forbidden");
  assert.ok(res.error.includes("restricted to internal extension popup") || res.error.includes("untrusted origin"));
});

test("SEC-EXT-1: validateMessageSender rejects privileged operations when invoked from a tab or content script", () => {
  const contentScriptSender = {
    id: "tos_scanner_extension_id",
    origin: "https://spotify.com",
    url: "https://spotify.com/legal/privacy-policy/",
    tab: { id: 101, url: "https://spotify.com/legal/privacy-policy/" }
  };

  const privilegedActions = [
    "ANALYZE_CONFIRMED_POLICY",
    "ASK_POLICY_QUESTION",
    "EXTRACT_POLICY",
    "DETECT_POLICIES",
    "CHECK_HEALTH"
  ];

  for (const action of privilegedActions) {
    const res = validateMessageSender(contentScriptSender, { type: action }, "tos_scanner_extension_id");
    assert.equal(res.valid, false, `Must reject ${action} from tab context`);
    assert.equal(res.status, "forbidden");
    assert.ok(res.error.includes("restricted to internal extension popup"));
  }
});

test("SEC-EXT-1: validateMessageSender accepts authorized internal extension popup sender", () => {
  const validPopupSender = {
    id: "tos_scanner_extension_id",
    origin: "chrome-extension://tos_scanner_extension_id",
    url: "chrome-extension://tos_scanner_extension_id/popup/popup.html"
    // sender.tab is undefined for popup
  };

  const resPrivileged = validateMessageSender(validPopupSender, { type: "ASK_POLICY_QUESTION" }, "tos_scanner_extension_id");
  assert.equal(resPrivileged.valid, true);

  const resScan = validateMessageSender(validPopupSender, { type: "ANALYZE_CONFIRMED_POLICY" }, "tos_scanner_extension_id");
  assert.equal(resScan.valid, true);

  const resInfo = validateMessageSender(validPopupSender, { type: "GET_INFO" }, "tos_scanner_extension_id");
  assert.equal(resInfo.valid, true);
});

test("SEC-EXT-1: handleRuntimeMessage rejects unauthorized sender with forbidden status", async () => {
  const untrustedSender = {
    id: "attacker_extension_id",
    url: "https://attacker.example.com",
    origin: "https://attacker.example.com",
    tab: { id: 99 }
  };

  const res = await handleRuntimeMessage(
    { type: "ASK_POLICY_QUESTION", question: "Arbitrary question?" },
    untrustedSender
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, "forbidden");
  assert.ok(res.error.includes("Unauthorized message") || res.error.includes("restricted"));
});

test("SEC-EXT-1: handleRuntimeMessage accepts authorized popup sender and processes message", async () => {
  const trustedSender = {
    id: "trusted_test_ext_id",
    url: "chrome-extension://trusted_test_ext_id/popup/popup.html",
    origin: "chrome-extension://trusted_test_ext_id"
  };

  const res = await handleRuntimeMessage({ type: "GET_INFO" }, trustedSender);
  assert.equal(res.ok, true);
  assert.equal(res.version, "1.0.0");
  assert.equal(res.backendUrl, "http://localhost:3000");
});

