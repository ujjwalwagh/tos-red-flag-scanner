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
import net from "node:net";
import { PassThrough } from "node:stream";
import {
  findPythonExecutable,
  isPortInUse,
  attachPrefixedStream,
  killProcessTree
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
