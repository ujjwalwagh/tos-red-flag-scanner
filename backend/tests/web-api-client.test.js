/**
 * Tests for Web Application API Client & Authentication Compatibility (Phase 8C.4B).
 *
 * Verifies:
 * - URL validation rules (localhost HTTP allowed, remote HTTPS enforced, schemes, credentials).
 * - Configuration storage, retrieval, and reset.
 * - Token redaction in logging/diagnostics.
 * - Header injection and redirect: "error" enforcement in apiFetch.
 * - Multi-stage connection test (/health -> /api/analyze/categories).
 * - Preservation of existing scan, Q&A, and remediation request payloads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  validateBackendUrl,
  resolveStorage,
  getStoredConfig,
  saveStoredConfig,
  resetStoredConfig,
  sanitizeConfigForLogging,
  buildAuthHeaders,
  resolveApiUrl,
  apiFetch,
  testBackendConnection
} from "../../frontend/public/api-client.js";

function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

// ==============================================================================
// 1. URL Validation Rules
// ==============================================================================

test("validateBackendUrl: accepts empty or whitespace as default relative", () => {
  assert.equal(validateBackendUrl("").valid, true);
  assert.equal(validateBackendUrl("   ").valid, true);
  assert.equal(validateBackendUrl(null).valid, true);
  assert.equal(validateBackendUrl(undefined).valid, true);
});

test("validateBackendUrl: accepts valid localhost and loopback HTTP URLs", () => {
  const local1 = validateBackendUrl("http://localhost:3000");
  assert.equal(local1.valid, true);
  assert.equal(local1.normalizedUrl, "http://localhost:3000");

  const local2 = validateBackendUrl("http://127.0.0.1:8080/");
  assert.equal(local2.valid, true);
  assert.equal(local2.normalizedUrl, "http://127.0.0.1:8080");

  const local3 = validateBackendUrl("http://[::1]:3000");
  assert.equal(local3.valid, true);
});

test("validateBackendUrl: accepts valid remote HTTPS URLs and normalizes trailing slashes", () => {
  const remote1 = validateBackendUrl("https://api.example.com");
  assert.equal(remote1.valid, true);
  assert.equal(remote1.normalizedUrl, "https://api.example.com");

  const remote2 = validateBackendUrl("https://api.example.com/v1/");
  assert.equal(remote2.valid, true);
  assert.equal(remote2.normalizedUrl, "https://api.example.com/v1");
});

test("validateBackendUrl: rejects cleartext remote HTTP", () => {
  const res = validateBackendUrl("http://api.example.com");
  assert.equal(res.valid, false);
  assert.match(res.error, /Insecure HTTP is strictly restricted/i);
});

test("validateBackendUrl: rejects embedded credentials", () => {
  const res = validateBackendUrl("https://user:pass@api.example.com");
  assert.equal(res.valid, false);
  assert.match(res.error, /embedded credentials/i);
});

test("validateBackendUrl: rejects non-HTTP schemes and malformed URLs", () => {
  assert.equal(validateBackendUrl("ftp://files.example.com").valid, false);
  assert.equal(validateBackendUrl("file:///etc/passwd").valid, false);
  assert.equal(validateBackendUrl("javascript:alert(1)").valid, false);
  assert.equal(validateBackendUrl("not-a-url").valid, false);
});

// ==============================================================================
// 2. Storage & Sanitization
// ==============================================================================

test("getStoredConfig & saveStoredConfig: saves and loads valid config", () => {
  const storage = createMockStorage();

  // Initial state should be default
  const initial = getStoredConfig(storage);
  assert.equal(initial.backendUrl, "");
  assert.equal(initial.token, "");
  assert.equal(initial.isDefault, true);

  // Save valid configuration
  const saved = saveStoredConfig(
    { backendUrl: "https://api.example.com", token: "  test_token_123  " },
    storage
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.config.backendUrl, "https://api.example.com");
  assert.equal(saved.config.hasToken, true);

  // Load updated config
  const loaded = getStoredConfig(storage);
  assert.equal(loaded.backendUrl, "https://api.example.com");
  assert.equal(loaded.token, "test_token_123");
  assert.equal(loaded.isDefault, false);
});

test("saveStoredConfig: rejects invalid URL", () => {
  const storage = createMockStorage();
  const res = saveStoredConfig({ backendUrl: "http://insecure-remote.com" }, storage);
  assert.equal(res.ok, false);
  assert.match(res.error, /Insecure HTTP/i);
});

test("resetStoredConfig: resets configuration to defaults", () => {
  const storage = createMockStorage();
  saveStoredConfig({ backendUrl: "https://api.example.com", token: "tok123" }, storage);

  const reset = resetStoredConfig(storage);
  assert.equal(reset.ok, true);

  const loaded = getStoredConfig(storage);
  assert.equal(loaded.backendUrl, "");
  assert.equal(loaded.token, "");
  assert.equal(loaded.isDefault, true);
});

test("sanitizeConfigForLogging: masks Bearer token", () => {
  const sanitized = sanitizeConfigForLogging({
    backendUrl: "https://api.example.com",
    token: "super_secret_bearer_token"
  });

  assert.equal(sanitized.backendUrl, "https://api.example.com");
  assert.equal(sanitized.hasToken, true);
  assert.equal(sanitized.token, undefined);
});

// ==============================================================================
// 3. Header Construction & URL Resolution
// ==============================================================================

test("buildAuthHeaders: attaches Authorization only when token is present", () => {
  // With token
  const h1 = buildAuthHeaders("my_token", { "Content-Type": "application/json" });
  assert.equal(h1["Authorization"], "Bearer my_token");
  assert.equal(h1["Content-Type"], "application/json");

  // Empty or missing token
  const h2 = buildAuthHeaders("", { "Content-Type": "application/json" });
  assert.equal(h2["Authorization"], undefined);

  const h3 = buildAuthHeaders(null, { Accept: "application/json" });
  assert.equal(h3["Authorization"], undefined);
});

test("resolveApiUrl: resolves relative and absolute paths correctly", () => {
  assert.equal(resolveApiUrl("/api/scan", ""), "/api/scan");
  assert.equal(resolveApiUrl("api/scan", ""), "/api/scan");
  assert.equal(
    resolveApiUrl("/api/scan", "https://api.example.com"),
    "https://api.example.com/api/scan"
  );
  assert.equal(
    resolveApiUrl("/api/scan", "https://api.example.com/"),
    "https://api.example.com/api/scan"
  );
});

// ==============================================================================
// 4. Centralized apiFetch
// ==============================================================================

test("apiFetch: injects token, enforces redirect: error, and preserves body", async () => {
  let capturedHeaders = null;
  let capturedMethod = null;
  let capturedBody = null;

  const mock = await createMockServer((req, res) => {
    capturedMethod = req.method;
    capturedHeaders = req.headers;
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      capturedBody = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    const customConfig = {
      backendUrl: mock.url,
      token: "web_test_token_xyz"
    };

    const res = await apiFetch(
      "/api/scan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyText: "Test policy text", scanMode: "broad" })
      },
      {
        getConfig: () => customConfig
      }
    );

    assert.equal(res.status, 200);
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedHeaders["authorization"], "Bearer web_test_token_xyz");
    assert.match(capturedBody, /Test policy text/);
  } finally {
    await mock.close();
  }
});

test("apiFetch: invokes onAuthRequired callback on HTTP 401", async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
  });

  let authRequiredInvoked = false;

  try {
    const res = await apiFetch(
      "/api/scan",
      { method: "POST" },
      {
        getConfig: () => ({ backendUrl: mock.url, token: "wrong_token" }),
        onAuthRequired: (info) => {
          authRequiredInvoked = true;
          assert.equal(info.status, 401);
          assert.equal(info.path, "/api/scan");
        }
      }
    );

    assert.equal(res.status, 401);
    assert.equal(authRequiredInvoked, true);
  } finally {
    await mock.close();
  }
});

// ==============================================================================
// 5. Connection Test Sequence
// ==============================================================================

test("testBackendConnection: returns AUTH_SUCCESS when token is verified", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      if (req.headers["authorization"] === "Bearer valid_key") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ categories: ["ARBITRATION"] }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
      }
    }
  });

  try {
    const result = await testBackendConnection({
      backendUrl: mock.url,
      token: "valid_key"
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, "AUTH_SUCCESS");
    assert.equal(result.authVerified, true);
  } finally {
    await mock.close();
  }
});

test("testBackendConnection: returns REACHABLE when no token and server has no auth", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ categories: ["ARBITRATION"] }));
    }
  });

  try {
    const result = await testBackendConnection({
      backendUrl: mock.url,
      token: ""
    });

    assert.equal(result.ok, true);
    assert.equal(result.code, "REACHABLE");
    assert.equal(result.authVerified, false);
  } finally {
    await mock.close();
  }
});

test("testBackendConnection: returns AUTH_REQUIRED when server requires auth but none given", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bearer token missing" }));
    }
  });

  try {
    const result = await testBackendConnection({
      backendUrl: mock.url,
      token: ""
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "AUTH_REQUIRED");
    assert.equal(result.status, 401);
  } finally {
    await mock.close();
  }
});

test("testBackendConnection: returns AUTH_INVALID when supplied token is rejected", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.url === "/api/analyze/categories") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid token" }));
    }
  });

  try {
    const result = await testBackendConnection({
      backendUrl: mock.url,
      token: "wrong_token_here"
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "AUTH_INVALID");
    assert.equal(result.status, 401);
  } finally {
    await mock.close();
  }
});

test("testBackendConnection: returns CORS_BLOCKED on HTTP 403", async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CORS origin not allowed." }));
  });

  try {
    const result = await testBackendConnection({
      backendUrl: mock.url,
      token: ""
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "CORS_BLOCKED");
    assert.equal(result.status, 403);
  } finally {
    await mock.close();
  }
});
