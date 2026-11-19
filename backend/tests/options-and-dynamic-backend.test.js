import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BACKEND_URL,
  STORAGE_KEY_CONFIG,
  validateBackendUrl,
  getStoredBackendConfig,
  saveStoredBackendConfig,
  resetStoredBackendConfig,
  sanitizeConfigForLogging,
  buildAuthHeaders,
  checkOrRequestBackendHostPermission,
  testBackendConnection
} from "../../extension/utils/backend-config.js";
import {
  checkBackendHealth,
  analyzeConfirmedPolicy,
  queryPolicyDocument,
  handleRuntimeMessage,
  validateMessageSender,
  PRIVILEGED_MESSAGE_ACTIONS
} from "../../extension/background/service-worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");

/* ------------------------------------------------------------------
 * 1. Unit Tests: Backend URL Validation
 * ------------------------------------------------------------------ */

test("validateBackendUrl accepts valid localhost and loopback URLs", () => {
  const v1 = validateBackendUrl("http://localhost:3000");
  assert.equal(v1.valid, true);
  assert.equal(v1.normalizedUrl, "http://localhost:3000");

  const v2 = validateBackendUrl("http://127.0.0.1:8000/");
  assert.equal(v2.valid, true);
  assert.equal(v2.normalizedUrl, "http://127.0.0.1:8000");

  const v3 = validateBackendUrl("http://localhost");
  assert.equal(v3.valid, true);
  assert.equal(v3.normalizedUrl, "http://localhost");

  const v4 = validateBackendUrl("http://[::1]:3000");
  assert.equal(v4.valid, true);
  assert.equal(v4.normalizedUrl, "http://[::1]:3000");
});

test("validateBackendUrl accepts remote HTTPS URLs and normalizes trailing slashes", () => {
  const v1 = validateBackendUrl("https://api.tos-scanner.example.com");
  assert.equal(v1.valid, true);
  assert.equal(v1.normalizedUrl, "https://api.tos-scanner.example.com");

  const v2 = validateBackendUrl("https://api.tos-scanner.example.com/");
  assert.equal(v2.valid, true);
  assert.equal(v2.normalizedUrl, "https://api.tos-scanner.example.com");

  const v3 = validateBackendUrl("https://tos.cloud.example.org:8443/custom-api/");
  assert.equal(v3.valid, true);
  assert.equal(v3.normalizedUrl, "https://tos.cloud.example.org:8443/custom-api");
});

test("validateBackendUrl rejects unencrypted remote HTTP URLs", () => {
  const v1 = validateBackendUrl("http://api.remote-server.com");
  assert.equal(v1.valid, false);
  assert.match(v1.error, /Remote backends must use HTTPS/i);

  const v2 = validateBackendUrl("http://192.168.1.100:3000");
  assert.equal(v2.valid, false);
  assert.match(v2.error, /Remote backends must use HTTPS/i);
});

test("validateBackendUrl rejects URLs with embedded credentials", () => {
  const v1 = validateBackendUrl("http://user:pass@localhost:3000");
  assert.equal(v1.valid, false);
  assert.match(v1.error, /embedded credentials/i);

  const v2 = validateBackendUrl("https://admin:secret123@api.example.com");
  assert.equal(v2.valid, false);
  assert.match(v2.error, /embedded credentials/i);
});

test("validateBackendUrl rejects unsupported protocols", () => {
  const badSchemes = [
    "ftp://example.com",
    "file:///etc/hosts",
    "javascript:alert(1)",
    "ws://localhost:3000",
    "wss://api.example.com"
  ];
  for (const s of badSchemes) {
    const res = validateBackendUrl(s);
    assert.equal(res.valid, false);
    assert.match(res.error, /Unsupported protocol/i);
  }
});

test("validateBackendUrl rejects malformed, empty, or whitespace inputs", () => {
  assert.equal(validateBackendUrl("").valid, false);
  assert.equal(validateBackendUrl("   ").valid, false);
  assert.equal(validateBackendUrl(null).valid, false);
  assert.equal(validateBackendUrl(undefined).valid, false);
  assert.equal(validateBackendUrl("not-a-valid-url").valid, false);
});

/* ------------------------------------------------------------------
 * 2. Storage Helpers & Credential Protection
 * ------------------------------------------------------------------ */

test("getStoredBackendConfig returns default localhost when unconfigured", async () => {
  const originalChrome = globalThis.chrome;
  try {
    globalThis.chrome = {
      storage: {
        local: {
          get: (keys, callback) => callback({})
        }
      }
    };

    const cfg = await getStoredBackendConfig();
    assert.equal(cfg.backendUrl, DEFAULT_BACKEND_URL);
    assert.equal(cfg.token, "");
    assert.equal(cfg.isDefault, true);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("saveStoredBackendConfig writes normalized URL and token to chrome.storage.local only", async () => {
  const originalChrome = globalThis.chrome;
  let storedData = null;
  let syncCalled = false;

  try {
    globalThis.chrome = {
      storage: {
        local: {
          set: (data, callback) => {
            storedData = data;
            callback();
          }
        },
        sync: {
          set: () => {
            syncCalled = true;
          }
        }
      }
    };

    const res = await saveStoredBackendConfig({
      backendUrl: "https://api.example.com/",
      token: "  test_token_secret_12345  "
    });

    assert.equal(res.ok, true);
    assert.equal(res.config.backendUrl, "https://api.example.com");
    assert.equal(res.config.hasToken, true);

    assert.ok(storedData && storedData[STORAGE_KEY_CONFIG]);
    assert.equal(storedData[STORAGE_KEY_CONFIG].backendUrl, "https://api.example.com");
    assert.equal(storedData[STORAGE_KEY_CONFIG].token, "test_token_secret_12345");
    assert.equal(syncCalled, false, "chrome.storage.sync must NEVER be called for tokens");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("resetStoredBackendConfig clears stored token and restores defaults", async () => {
  const originalChrome = globalThis.chrome;
  let removedKey = null;

  try {
    globalThis.chrome = {
      storage: {
        local: {
          remove: (keys, callback) => {
            removedKey = keys[0];
            callback();
          }
        }
      }
    };

    const res = await resetStoredBackendConfig();
    assert.equal(res.ok, true);
    assert.equal(removedKey, STORAGE_KEY_CONFIG);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("sanitizeConfigForLogging redacts actual token strings", () => {
  const cfgWithToken = {
    backendUrl: "https://api.example.com",
    token: "top_secret_bearer_token_abc123"
  };
  const sanitized = sanitizeConfigForLogging(cfgWithToken);
  assert.equal(sanitized.backendUrl, "https://api.example.com");
  assert.equal(sanitized.hasToken, true);
  assert.equal(JSON.stringify(sanitized).includes("top_secret_bearer_token_abc123"), false);

  const cfgNoToken = { backendUrl: "http://localhost:3000", token: "" };
  assert.equal(sanitizeConfigForLogging(cfgNoToken).hasToken, false);
});

test("buildAuthHeaders attaches Bearer Authorization header only when token is present", () => {
  const headersWithToken = buildAuthHeaders("my-secret-token", { Accept: "application/json" });
  assert.equal(headersWithToken["Authorization"], "Bearer my-secret-token");
  assert.equal(headersWithToken["Accept"], "application/json");

  const headersEmpty = buildAuthHeaders("", { Accept: "application/json" });
  assert.equal(headersEmpty["Authorization"], undefined);

  const headersWhitespace = buildAuthHeaders("   ", { Accept: "application/json" });
  assert.equal(headersWhitespace["Authorization"], undefined);

  const headersNull = buildAuthHeaders(null, { Accept: "application/json" });
  assert.equal(headersNull["Authorization"], undefined);
});

/* ------------------------------------------------------------------
 * 3. Host Permission Request Handling
 * ------------------------------------------------------------------ */

test("checkOrRequestBackendHostPermission grants localhost without prompt", async () => {
  const res = await checkOrRequestBackendHostPermission("http://localhost:3000");
  assert.equal(res.granted, true);
  assert.equal(res.isLocalhost, true);
});

test("checkOrRequestBackendHostPermission requests permission for remote HTTPS backend", async () => {
  const originalChrome = globalThis.chrome;
  let requestedOrigin = null;

  try {
    globalThis.chrome = {
      permissions: {
        contains: (query, callback) => callback(false), // not yet granted
        request: (query, callback) => {
          requestedOrigin = query.origins[0];
          callback(true); // user grants
        }
      }
    };

    const res = await checkOrRequestBackendHostPermission("https://api.myremote.org", true);
    assert.equal(res.granted, true);
    assert.equal(res.isLocalhost, false);
    assert.equal(requestedOrigin, "https://api.myremote.org/*");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

/* ------------------------------------------------------------------
 * 4. Multi-Stage Connection Testing
 * ------------------------------------------------------------------ */

test("testBackendConnection: returns REACHABLE when health and API succeed without token", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ categories: ["ARBITRATION", "TRACKING"] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await testBackendConnection({
      backendUrl: testUrl,
      token: "",
      requestPermission: false
    });

    assert.equal(res.ok, true);
    assert.equal(res.code, "REACHABLE");
    assert.equal(res.authVerified, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("testBackendConnection: returns AUTH_SUCCESS when token is validated on API route", async () => {
  let receivedAuth = null;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      receivedAuth = req.headers.authorization;
      if (receivedAuth === "Bearer valid_remote_token_123") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ categories: [] }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
      }
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await testBackendConnection({
      backendUrl: testUrl,
      token: "valid_remote_token_123",
      requestPermission: false
    });

    assert.equal(res.ok, true);
    assert.equal(res.code, "AUTH_SUCCESS");
    assert.equal(res.authVerified, true);
    assert.equal(receivedAuth, "Bearer valid_remote_token_123");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("testBackendConnection: returns AUTH_REQUIRED when backend enforces auth but no token provided", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" })); // /health is public
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing Bearer Token" }));
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await testBackendConnection({
      backendUrl: testUrl,
      token: "",
      requestPermission: false
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, "AUTH_REQUIRED");
    assert.equal(res.healthOk, true);
    assert.equal(res.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("testBackendConnection: returns AUTH_INVALID when invalid token is rejected by backend", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API token" }));
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await testBackendConnection({
      backendUrl: testUrl,
      token: "wrong_token_xyz",
      requestPermission: false
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, "AUTH_INVALID");
    assert.equal(res.healthOk, true);
    assert.equal(res.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("testBackendConnection: returns CORS_BLOCKED when backend returns 403", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CORS not allowed" }));
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await testBackendConnection({
      backendUrl: testUrl,
      token: "",
      requestPermission: false
    });

    assert.equal(res.ok, false);
    assert.equal(res.code, "CORS_BLOCKED");
    assert.equal(res.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/* ------------------------------------------------------------------
 * 5. Service Worker Dynamic Backend & Token Integration
 * ------------------------------------------------------------------ */

test("checkBackendHealth sends Bearer token and uses dynamic backend URL", async () => {
  let receivedAuth = null;
  const server = http.createServer((req, res) => {
    receivedAuth = req.headers.authorization;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: "2026-11-17T12:00:00Z" }));
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const customUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await checkBackendHealth(customUrl, "dyn_token_777");
    assert.equal(res.ok, true);
    assert.equal(res.status, "connected");
    assert.equal(res.backendUrl, customUrl);
    assert.equal(receivedAuth, "Bearer dyn_token_777");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("analyzeConfirmedPolicy sends Authorization header and handles 401 cleanly", async () => {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer correct_token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, clauses: [] }));
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const customUrl = `http://127.0.0.1:${port}`;

  const validPayload = {
    candidate: { url: "https://example.com/terms", category: "TERMS" },
    extractedText: "A".repeat(600),
    confirmed: true,
    documentType: "TERMS"
  };

  try {
    // 1. Rejected without token
    const resUnauth = await analyzeConfirmedPolicy(validPayload, customUrl, "");
    assert.equal(resUnauth.ok, false);
    assert.equal(resUnauth.status, 401);
    assert.match(resUnauth.error, /Extension Options/i);

    // 2. Accepted with correct token
    const resAuth = await analyzeConfirmedPolicy(validPayload, customUrl, "correct_token");
    assert.equal(resAuth.ok, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("queryPolicyDocument sends Authorization header and handles 401 cleanly", async () => {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer correct_token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, qa: { answer: "Test answer", grounded: true } }));
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const customUrl = `http://127.0.0.1:${port}`;

  const validPayload = {
    question: "Can I cancel my subscription?",
    policyText: "A".repeat(600),
    documentType: "TERMS"
  };

  try {
    // 1. Rejected without token
    const resUnauth = await queryPolicyDocument(validPayload, customUrl, "");
    assert.equal(resUnauth.ok, false);
    assert.equal(resUnauth.status, 401);
    assert.match(resUnauth.error, /Extension Options/i);

    // 2. Accepted with correct token
    const resAuth = await queryPolicyDocument(validPayload, customUrl, "correct_token");
    assert.equal(resAuth.ok, true);
    assert.equal(resAuth.qa.answer, "Test answer");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

/* ------------------------------------------------------------------
 * 6. Message Sender Security Boundary (Options Page in Tab vs Content Script)
 * ------------------------------------------------------------------ */

test("SEC-EXT-1: Options page opened in an extension tab is recognized as authorized internal sender", () => {
  const optionsSender = {
    id: "tos_scanner_extension_id",
    origin: "chrome-extension://tos_scanner_extension_id",
    url: "chrome-extension://tos_scanner_extension_id/options/options.html",
    tab: {
      id: 88,
      url: "chrome-extension://tos_scanner_extension_id/options/options.html"
    }
  };

  const resSave = validateMessageSender(optionsSender, { type: "SAVE_BACKEND_CONFIG" }, "tos_scanner_extension_id");
  assert.equal(resSave.valid, true);

  const resTest = validateMessageSender(optionsSender, { type: "TEST_CONNECTION" }, "tos_scanner_extension_id");
  assert.equal(resTest.valid, true);

  const resGet = validateMessageSender(optionsSender, { type: "GET_BACKEND_CONFIG" }, "tos_scanner_extension_id");
  assert.equal(resGet.valid, true);
});

test("SEC-EXT-1: Content scripts and external websites are strictly rejected from config actions", () => {
  const contentScriptSender = {
    id: "tos_scanner_extension_id",
    origin: "https://evil.example.com",
    url: "https://evil.example.com/page.html",
    tab: { id: 99, url: "https://evil.example.com/page.html" }
  };

  for (const action of ["GET_BACKEND_CONFIG", "SAVE_BACKEND_CONFIG", "RESET_BACKEND_CONFIG", "TEST_CONNECTION"]) {
    const res = validateMessageSender(contentScriptSender, { type: action }, "tos_scanner_extension_id");
    assert.equal(res.valid, false);
    assert.equal(res.status, "forbidden");
  }
});

/* ------------------------------------------------------------------
 * 7. Manifest V3 Options UI Declaration Integrity
 * ------------------------------------------------------------------ */

test("manifest.json defines options_ui with open_in_tab: true", () => {
  assert.ok(fs.existsSync(MANIFEST_PATH));
  const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);

  assert.ok(manifest.options_ui, "options_ui must be declared in manifest");
  assert.equal(manifest.options_ui.page, "options/options.html");
  assert.equal(manifest.options_ui.open_in_tab, true);

  // Files must exist
  assert.ok(fs.existsSync(path.join(EXTENSION_DIR, "options", "options.html")));
  assert.ok(fs.existsSync(path.join(EXTENSION_DIR, "options", "options.css")));
  assert.ok(fs.existsSync(path.join(EXTENSION_DIR, "options", "options.js")));
});
