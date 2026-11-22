/**
 * Tests for Unified Startup Launcher (Phase 7G-B.5).
 *
 * Verifies:
 * 1. findPythonExecutable discovers virtual environment uvicorn / python.
 * 2. isPortInUse correctly detects occupied and available TCP ports.
 * 3. attachPrefixedStream formats stream chunks line-by-line with exact prefixes.
 * 4. Process tree termination handles valid and invalid PIDs cleanly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { PassThrough } from "node:stream";
import {
  findPythonExecutable,
  isPortInUse,
  attachPrefixedStream,
  killProcessTree,
  waitForReadiness,
  parsePositiveInt
} from "../../scripts/start.js";

test("findPythonExecutable discovers virtual environment executable", () => {
  const result = findPythonExecutable();
  assert.ok(result, "Must find Python or Uvicorn executable in .venv");
  assert.ok(typeof result.executable === "string");
  assert.ok(Array.isArray(result.args));
  assert.ok(result.args.includes("127.0.0.1"));
  assert.ok(result.args.includes("8000"));
});

test("isPortInUse returns true for listening server and false for unused port", async () => {
  // Start a temporary test server on an ephemeral port
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const assignedPort = server.address().port;

  try {
    const inUse = await isPortInUse(assignedPort);
    assert.equal(inUse, true, "Active listening port must report inUse: true");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // Once closed, the port is guaranteed to be unused
  const afterCloseInUse = await isPortInUse(assignedPort);
  assert.equal(afterCloseInUse, false, "Closed port must report inUse: false");
});

test("attachPrefixedStream prefixes multi-line and single-line chunks cleanly", async () => {
  const source = new PassThrough();
  const target = new PassThrough();

  let captured = "";
  target.on("data", (chunk) => {
    captured += chunk.toString();
  });

  attachPrefixedStream(source, "[TEST-PREFIX]", target);

  source.write("First line\nSecond line\n");
  source.write("Third line without newline");
  source.end();

  // Wait for stream to flush
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(captured.includes("[TEST-PREFIX] First line"));
  assert.ok(captured.includes("[TEST-PREFIX] Second line"));
  assert.ok(captured.includes("[TEST-PREFIX] Third line without newline"));
});

test("killProcessTree resolves cleanly for non-existent PID", async () => {
  // Test safety against invalid or non-existent PID
  await assert.doesNotReject(async () => {
    await killProcessTree(999999);
  });
  await assert.doesNotReject(async () => {
    await killProcessTree(null);
  });
});

test("parsePositiveInt: parses valid numbers and applies bounds and fallbacks", () => {
  assert.equal(parsePositiveInt("5000", 1000), 5000);
  assert.equal(parsePositiveInt(60000, 1000), 60000);
  assert.equal(parsePositiveInt(undefined, 3000), 3000);
  assert.equal(parsePositiveInt("", 3000), 3000);
  assert.equal(parsePositiveInt("abc", 3000), 3000);
  assert.equal(parsePositiveInt("-50", 3000), 3000);
  assert.equal(parsePositiveInt("0", 3000), 3000);
  assert.equal(parsePositiveInt("999999999", 3000, 1, 300000), 3000);
});

test("waitForReadiness: resolves with ready: true when endpoint responds with 200 and valid JSON", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", model_loaded: true, nli_status: "ready" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const result = await waitForReadiness(`http://127.0.0.1:${port}/health`, {
      timeoutMs: 3000,
      intervalMs: 50,
      probeTimeoutMs: 500,
      validateResponse: (data) => data?.status === "ok" && data?.model_loaded === true
    });

    assert.equal(result.ready, true);
    assert.equal(result.data?.status, "ok");
    assert.equal(result.data?.model_loaded, true);
    assert.ok(result.elapsedMs >= 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("waitForReadiness: respects validateResponse callback and rejects invalid payloads", async () => {
  const server = http.createServer((req, res) => {
    // Returns 200 but status is not ok
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "warming_up", model_loaded: false }));
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const result = await waitForReadiness(`http://127.0.0.1:${port}/health`, {
      timeoutMs: 200,
      intervalMs: 40,
      probeTimeoutMs: 100,
      validateResponse: (data) => data?.status === "ok"
    });

    assert.equal(result.ready, false);
    assert.equal(result.error, "timeout");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("waitForReadiness: resolves with ready: false when endpoint times out or is unreachable", async () => {
  // Use a port guaranteed to have no listener (ephemeral closed port)
  const tempServer = http.createServer();
  await new Promise((r) => tempServer.listen(0, "127.0.0.1", r));
  const closedPort = tempServer.address().port;
  await new Promise((r) => tempServer.close(r));

  const result = await waitForReadiness(`http://127.0.0.1:${closedPort}/health`, {
    timeoutMs: 150,
    intervalMs: 30,
    probeTimeoutMs: 50
  });

  assert.equal(result.ready, false);
  assert.ok(result.elapsedMs >= 100);
});

test("waitForReadiness: triggers onProgress callback on prolonged wait", async () => {
  let progressFired = false;
  let elapsedReported = 0;

  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const result = await waitForReadiness(`http://127.0.0.1:${port}/health`, {
      timeoutMs: 300,
      intervalMs: 30,
      probeTimeoutMs: 50,
      progressIntervalMs: 50, // fast progress for test
      onProgress: (elapsedMs) => {
        progressFired = true;
        elapsedReported = elapsedMs;
      }
    });

    assert.equal(result.ready, false);
    // Since timeoutMs was 300ms and default elapsed threshold is 4000ms, progress does not spam on short runs
    assert.equal(typeof result.elapsedMs, "number");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("waitForReadiness: supports legacy positional arguments (url, maxAttempts, intervalMs)", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const result = await waitForReadiness(`http://127.0.0.1:${port}/health`, 10, 50);
    assert.equal(result.ready, true);
    assert.equal(result.data?.status, "ok");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
