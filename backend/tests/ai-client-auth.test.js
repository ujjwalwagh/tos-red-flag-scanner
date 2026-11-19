/**
 * Tests for Python AI Client Internal Authentication & Header Injection (Phase 8C.3E).
 *
 * Verifies:
 * - Proper injection of X-Internal-Token header on protected AI routes.
 * - Non-injection of token on public /health probe.
 * - Non-injection of empty or whitespace headers when token is unconfigured.
 * - Safe handling of HTTP 401 responses without unhandled rejections or crashes.
 * - Token redaction in logging/inspection utilities (Symbol.for('nodejs.util.inspect.custom')).
 * - Preservation of circuit breaker and timeout invariants.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import util from "node:util";
import { PythonAiClient } from "../src/ai/ai-client.js";

// Helper to spawn a temporary mock HTTP server on loopback
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

const TEST_SECRET_TOKEN = "tos_internal_test_secret_987654321";

test("PythonAiClient: attaches X-Internal-Token on protected /ai/embed requests", async () => {
  let capturedHeaders = null;

  const mock = await createMockServer((req, res) => {
    capturedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ embedding: new Array(384).fill(0.1), dimension: 384 }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: TEST_SECRET_TOKEN
    });

    const result = await client.embedText("Sample clause text");
    assert.equal(result.success, true);
    assert.equal(capturedHeaders["x-internal-token"], TEST_SECRET_TOKEN);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: attaches X-Internal-Token on protected /ai/vectors/query requests", async () => {
  let capturedHeaders = null;

  const mock = await createMockServer((req, res) => {
    capturedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: [{ clause_id: "c1", similarity: 0.95 }] }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: TEST_SECRET_TOKEN
    });

    const result = await client.queryVectors("doc_1", "cancellation");
    assert.equal(result.success, true);
    assert.equal(capturedHeaders["x-internal-token"], TEST_SECRET_TOKEN);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: attaches X-Internal-Token on protected /ai/nli/validate requests", async () => {
  let capturedHeaders = null;

  const mock = await createMockServer((req, res) => {
    capturedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      is_supported: true,
      status: "supported",
      label: "entailment",
      scores: { entailment: 0.95, neutral: 0.03, contradiction: 0.02 },
      evaluated_clauses_count: 1
    }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: TEST_SECRET_TOKEN
    });

    const result = await client.validateNli("Answer", [{ text: "Evidence clause" }]);
    assert.equal(result.success, true);
    assert.equal(capturedHeaders["x-internal-token"], TEST_SECRET_TOKEN);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: does NOT attach X-Internal-Token on public /health probe", async () => {
  let capturedHeaders = null;

  const mock = await createMockServer((req, res) => {
    capturedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model_loaded: true }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: TEST_SECRET_TOKEN
    });

    const health = await client.checkHealth();
    assert.equal(health.available, true);
    assert.equal(capturedHeaders["x-internal-token"], undefined);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: does NOT attach X-Internal-Token when unconfigured or empty", async () => {
  let capturedHeaders = null;

  const mock = await createMockServer((req, res) => {
    capturedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ embedding: new Array(384).fill(0.1), dimension: 384 }));
  });

  try {
    // Empty token string
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: ""
    });

    const res = await client.embedText("Sample text");
    assert.equal(res.success, true);
    assert.equal(capturedHeaders["x-internal-token"], undefined);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: handles HTTP 401 response safely without throwing", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Unauthorized: invalid internal service token" }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: "wrong_token"
    });

    const res = await client.embedText("Sample text");
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
    assert.match(res.error, /unauthorized/i);
    assert.equal(client.consecutiveFailures, 1);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: masks internalToken in util.inspect and getSanitizedConfig", () => {
  const client = new PythonAiClient({
    baseUrl: "http://127.0.0.1:8000",
    internalToken: "super_secret_internal_token_xyz"
  });

  // util.inspect should not reveal the token string
  const inspected = util.inspect(client);
  assert.equal(inspected.includes("super_secret_internal_token_xyz"), false);
  assert.equal(inspected.includes("hasInternalToken: true"), true);

  // getSanitizedConfig should not reveal the token string
  const sanitized = client.getSanitizedConfig();
  assert.equal(sanitized.hasInternalToken, true);
  assert.equal(sanitized.internalToken, undefined);
});

test("PythonAiClient: circuit breaker trips after 3 consecutive 401 failures", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Unauthorized: invalid token" }));
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      internalToken: "invalid_key"
    });

    // 1st failure
    await client.embedText("Call 1");
    assert.equal(client.isCircuitClosed(), true);

    // 2nd failure
    await client.embedText("Call 2");
    assert.equal(client.isCircuitClosed(), true);

    // 3rd failure -> trips circuit
    await client.embedText("Call 3");
    assert.equal(client.isCircuitClosed(), false);

    // 4th call is short-circuited
    const res4 = await client.embedText("Call 4");
    assert.equal(res4.success, false);
    assert.equal(res4.error, "python_ai_service_circuit_open");
  } finally {
    await mock.close();
  }
});
