/**
 * Tests for Python AI Client Bridge (Phase 9.3).
 *
 * Verifies Node <-> Python communication, endpoint schemas, timeout handling,
 * error shielding, fallback behavior, and zero-retention session cleanup.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { PythonAiClient } from "../src/ai/ai-client.js";
import { compareClauses } from "../src/analysis/semantic/clause-comparator.js";
import { parsePositiveInt } from "../src/config/env.js";

// Helper to spawn a temporary mock HTTP server for deterministic failure injection
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

test("PythonAiClient: successful /ai/embed single and batch requests", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/ai/embed" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const payload = JSON.parse(body);
        if (payload.text) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ embedding: new Array(384).fill(0.05), dimension: 384 }));
        } else if (payload.texts) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            embeddings: payload.texts.map(() => new Array(384).fill(0.05)),
            dimension: 384,
            count: payload.texts.length
          }));
        }
      });
    }
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });

    // Single text embedding
    const single = await client.embedText("Sample clause text");
    assert.equal(single.success, true);
    assert.equal(single.dimension, 384);
    assert.equal(single.embedding.length, 384);

    // Batch embedding
    const batch = await client.embedBatch(["Clause 1", "Clause 2"]);
    assert.equal(batch.success, true);
    assert.equal(batch.count, 2);
    assert.equal(batch.embeddings.length, 2);
    assert.equal(batch.embeddings[0].length, 384);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: successful vector indexing, query, and deletion", async () => {
  let indexedDocId = null;
  let deletedDocId = null;

  const mock = await createMockServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/ai/vectors/index" && req.method === "POST") {
        const payload = JSON.parse(body);
        indexedDocId = payload.document_id;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ document_id: indexedDocId, indexed_count: payload.clauses.length, status: "success" }));
      } else if (req.url === "/ai/vectors/query" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          results: [
            { clause_id: "c1", category: "privacy", similarity: 0.88, distance: 0.12, text: "Privacy text" }
          ]
        }));
      } else if (req.url.startsWith("/ai/vectors/") && req.method === "DELETE") {
        deletedDocId = decodeURIComponent(req.url.replace("/ai/vectors/", ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ document_id: deletedDocId, deleted: true, status: "deleted" }));
      }
    });
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });

    // Index
    const indexRes = await client.indexClauses("doc_101", [
      { clause_id: "c1", text: "Privacy text", category: "privacy" }
    ]);
    assert.equal(indexRes.success, true);
    assert.equal(indexRes.documentId, "doc_101");
    assert.equal(indexRes.indexedCount, 1);
    assert.equal(indexedDocId, "doc_101");

    // Query
    const queryRes = await client.queryVectors("doc_101", "personal info", 2);
    assert.equal(queryRes.success, true);
    assert.equal(queryRes.results.length, 1);
    assert.equal(queryRes.results[0].clause_id, "c1");

    // Delete
    const delRes = await client.deleteDocumentVectors("doc_101");
    assert.equal(delRes.success, true);
    assert.equal(delRes.deleted, true);
    assert.equal(deletedDocId, "doc_101");
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: handles service unavailable gracefully without crashing", async () => {
  // Port where no server is running
  const client = new PythonAiClient({ baseUrl: "http://127.0.0.1:59999", timeoutMs: 500 });

  const health = await client.checkHealth();
  assert.equal(health.available, false);

  const embed = await client.embedText("Arbitration clause");
  assert.equal(embed.success, false);
  assert.ok(embed.error);

  const index = await client.indexClauses("doc_fail", [{ clause_id: "c1", text: "text" }]);
  assert.equal(index.success, false);

  const query = await client.queryVectors("doc_fail", "query");
  assert.equal(query.success, false);
  assert.deepEqual(query.results, []);

  const del = await client.deleteDocumentVectors("doc_fail");
  assert.equal(del.success, false);
});

test("PythonAiClient: handles request timeout safely", async () => {
  const mock = await createMockServer((req, res) => {
    // Intentionally delay longer than client timeout
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }, 500);
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 50 });
    const res = await client.embedText("Testing timeout");
    assert.equal(res.success, false);
    assert.equal(res.isTimeout, true);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: handles HTTP 4xx and 5xx errors cleanly", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/ai/embed") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Input text must not be empty or whitespace only." }));
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Internal model execution failure" }));
    }
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });
    const embedRes = await client.embedText("bad_input");
    assert.equal(embedRes.success, false);
    assert.equal(embedRes.status, 400);
    assert.ok(embedRes.error.includes("whitespace"));

    const indexRes = await client.indexClauses("doc_err", [{ clause_id: "c1", text: "txt" }]);
    assert.equal(indexRes.success, false);
    assert.equal(indexRes.status, 500);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: handles invalid or non-JSON responses without throwing", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Bad Gateway</body></html>");
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });
    const res = await client.embedText("Text");
    assert.equal(res.success, false);
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: withDocumentVectors guarantees cleanup in finally block even on error", async () => {
  let deletedId = null;

  const mock = await createMockServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/ai/vectors/index" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ document_id: "temp_doc", indexed_count: 1, status: "success" }));
      } else if (req.url.startsWith("/ai/vectors/") && req.method === "DELETE") {
        deletedId = decodeURIComponent(req.url.replace("/ai/vectors/", ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ document_id: deletedId, deleted: true, status: "deleted" }));
      }
    });
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });

    // Worker throws an unexpected error
    await assert.rejects(async () => {
      await client.withDocumentVectors("temp_doc", [{ clause_id: "c1", text: "text" }], async () => {
        throw new Error("Worker failed mid-analysis!");
      });
    }, /Worker failed mid-analysis!/);

    // Verify cleanup was still triggered
    assert.equal(deletedId, "temp_doc");
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: computeCosineSimilarity returns correct dot product and clamps bounds", () => {
  const client = new PythonAiClient();

  // Orthogonal vectors
  const simOrtho = client.computeCosineSimilarity([1, 0, 0], [0, 1, 0]);
  assert.equal(simOrtho, 0.0);

  // Identical normalized vectors
  const simIdentical = client.computeCosineSimilarity([0.6, 0.8], [0.6, 0.8]);
  assert.equal(simIdentical, 1.0);

  // Opposite vectors
  const simOpposite = client.computeCosineSimilarity([1, 0], [-1, 0]);
  assert.equal(simOpposite, -1.0);
});

test("compareClauses: uses semantic embedding when enabled and falls back on failure", async () => {
  const mockAiClientSuccess = {
    enabled: true,
    compareClausesSemantic: async () => ({
      success: true,
      available: true,
      similarityScore: 0.82
    })
  };

  const resSuccess = await compareClauses(
    { oldClauseText: "You have 30 days notice.", newClauseText: "We give 30 days notice." },
    { aiClient: mockAiClientSuccess, useEmbeddings: true }
  );

  assert.equal(resSuccess.available, true);
  assert.equal(resSuccess.method, "semantic_embedding");
  assert.equal(resSuccess.similarityScore, 0.82);

  // Failure fallback
  const mockAiClientFail = {
    enabled: true,
    compareClausesSemantic: async () => ({
      success: false,
      available: false,
      error: "service_down"
    })
  };

  const resFallback = await compareClauses(
    { oldClauseText: "Old text", newClauseText: "New text" },
    { aiClient: mockAiClientFail, useEmbeddings: true }
  );

  assert.equal(resFallback.available, false);
  assert.equal(resFallback.method, "lexical_fallback");
  assert.ok(typeof resFallback.similarityScore === "number");
});

test("PythonAiClient: disabled feature flag skips network calls immediately", async () => {
  const client = new PythonAiClient({ baseUrl: "http://invalid-host-should-not-be-called", enabled: false });

  const health = await client.checkHealth();
  assert.equal(health.available, false);
  assert.equal(health.status, "unavailable");

  const embed = await client.embedText("Test");
  assert.equal(embed.success, false);
  assert.equal(embed.error, "python_ai_service_disabled");
});

test("PythonAiClient: default NLI timeout is 15000 ms and independent of general timeout", () => {
  const client = new PythonAiClient({ timeoutMs: 4000 });
  assert.equal(client.timeoutMs, 4000, "General timeout must respect explicit configuration");
  assert.equal(client.nliTimeoutMs, 15000, "Default NLI timeout must be 15000 ms");

  const defaultClient = new PythonAiClient();
  assert.equal(defaultClient.nliTimeoutMs, 15000, "Unconfigured client must use 15000 ms NLI timeout");
});

test("PythonAiClient: options and environment override work for nliTimeoutMs", () => {
  const client = new PythonAiClient({ nliTimeoutMs: 25000, timeoutMs: 3000 });
  assert.equal(client.nliTimeoutMs, 25000, "Explicit nliTimeoutMs option must override default");
  assert.equal(client.timeoutMs, 3000, "General timeout must remain completely independent");
});

test("PythonAiClient: invalid timeout configurations fall back safely to defaults", () => {
  const clientNeg = new PythonAiClient({ nliTimeoutMs: -1000, timeoutMs: 0 });
  assert.equal(clientNeg.nliTimeoutMs, 15000, "Negative NLI timeout must fall back to 15000");
  assert.equal(clientNeg.timeoutMs, 5000, "Zero general timeout must fall back to 5000");

  const clientStr = new PythonAiClient({ nliTimeoutMs: "invalid_string", timeoutMs: NaN });
  assert.equal(clientStr.nliTimeoutMs, 15000, "Non-numeric NLI timeout must fall back to 15000");
  assert.equal(clientStr.timeoutMs, 5000, "NaN timeout must fall back to 5000");
});

test("PythonAiClient: parsePositiveInt validates positive integers within range", () => {
  assert.equal(parsePositiveInt("20000", 15000), 20000);
  assert.equal(parsePositiveInt("15000", 15000), 15000);
  assert.equal(parsePositiveInt("-500", 15000), 15000);
  assert.equal(parsePositiveInt("0", 15000), 15000);
  assert.equal(parsePositiveInt("abc", 15000), 15000);
  assert.equal(parsePositiveInt("", 15000), 15000);
  assert.equal(parsePositiveInt(undefined, 15000), 15000);
  assert.equal(parsePositiveInt(null, 15000), 15000);
  assert.equal(parsePositiveInt(400000, 15000, 1, 300000), 15000, "Exceeding max must fall back");
});

test("PythonAiClient: validateNli respects effective NLI timeout during HTTP request", async () => {
  const mock = await createMockServer((req, res) => {
    if (req.url === "/ai/nli/validate") {
      // Intentionally delay longer than the test timeout
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "supported",
          is_supported: true,
          label: "entailment",
          scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 }
        }));
      }, 150);
    }
  });

  try {
    const client = new PythonAiClient({
      baseUrl: mock.url,
      nliTimeoutMs: 50 // Short timeout to verify trigger
    });

    const res = await client.validateNli("Test answer", [{ text: "Test evidence" }]);
    assert.equal(res.success, false);
    assert.equal(res.available, false);
    assert.equal(res.isTimeout, true);
    assert.equal(res.error, "request_timeout");
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: indexClauses correctly chunks batches > 400 and aggregates indexed count", async () => {
  const receivedChunks = [];
  const mock = await createMockServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/ai/vectors/index" && req.method === "POST") {
        const payload = JSON.parse(body);
        receivedChunks.push({
          docId: payload.document_id,
          clauseCount: payload.clauses.length,
          firstId: payload.clauses[0].clause_id,
          lastId: payload.clauses[payload.clauses.length - 1].clause_id
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          document_id: payload.document_id,
          indexed_count: payload.clauses.length,
          status: "success"
        }));
      }
    });
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });

    // Test with 693 clauses (Spotify Privacy Policy size)
    const clauses693 = Array.from({ length: 693 }, (_, i) => ({
      clause_id: `clause_${i}`,
      text: `Clause text ${i}`
    }));

    const res693 = await client.indexClauses("spotify_privacy", clauses693);
    assert.equal(res693.success, true);
    assert.equal(res693.indexedCount, 693);
    assert.equal(res693.documentId, "spotify_privacy");

    // Must be split into 2 chunks: 400 + 293
    assert.equal(receivedChunks.length, 2);
    assert.equal(receivedChunks[0].clauseCount, 400);
    assert.equal(receivedChunks[0].firstId, "clause_0");
    assert.equal(receivedChunks[0].lastId, "clause_399");
    assert.equal(receivedChunks[1].clauseCount, 293);
    assert.equal(receivedChunks[1].firstId, "clause_400");
    assert.equal(receivedChunks[1].lastId, "clause_692");

    receivedChunks.length = 0;

    // Test with boundary counts: 400 (1 chunk), 401 (2 chunks: 400 + 1), 1000 (3 chunks: 400 + 400 + 200)
    const clauses400 = Array.from({ length: 400 }, (_, i) => ({ clause_id: `c_${i}`, text: `txt ${i}` }));
    const res400 = await client.indexClauses("doc_400", clauses400);
    assert.equal(res400.success, true);
    assert.equal(res400.indexedCount, 400);
    assert.equal(receivedChunks.length, 1);
    assert.equal(receivedChunks[0].clauseCount, 400);

    receivedChunks.length = 0;

    const clauses401 = Array.from({ length: 401 }, (_, i) => ({ clause_id: `c_${i}`, text: `txt ${i}` }));
    const res401 = await client.indexClauses("doc_401", clauses401);
    assert.equal(res401.success, true);
    assert.equal(res401.indexedCount, 401);
    assert.equal(receivedChunks.length, 2);
    assert.equal(receivedChunks[0].clauseCount, 400);
    assert.equal(receivedChunks[1].clauseCount, 1);

    receivedChunks.length = 0;

    const clauses1000 = Array.from({ length: 1000 }, (_, i) => ({ clause_id: `c_${i}`, text: `txt ${i}` }));
    const res1000 = await client.indexClauses("doc_1000", clauses1000);
    assert.equal(res1000.success, true);
    assert.equal(res1000.indexedCount, 1000);
    assert.equal(receivedChunks.length, 3);
    assert.equal(receivedChunks[0].clauseCount, 400);
    assert.equal(receivedChunks[1].clauseCount, 400);
    assert.equal(receivedChunks[2].clauseCount, 200);

    // Test rejection over 1000 clauses
    const clauses1001 = Array.from({ length: 1001 }, (_, i) => ({ clause_id: `c_${i}`, text: `txt ${i}` }));
    const res1001 = await client.indexClauses("doc_1001", clauses1001);
    assert.equal(res1001.success, false);
    assert.ok(res1001.error.includes("maximum limit of 1,000 clauses"));
  } finally {
    await mock.close();
  }
});

test("PythonAiClient: indexClauses safely rolls back and deletes vectors if any chunk fails", async () => {
  let chunkCount = 0;
  let deletedDocId = null;

  const mock = await createMockServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/ai/vectors/index" && req.method === "POST") {
        chunkCount++;
        if (chunkCount === 1) {
          // Chunk 1 succeeds
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ document_id: "doc_fail", indexed_count: 400, status: "success" }));
        } else {
          // Chunk 2 fails with 500
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "ChromaDB disk full" }));
        }
      } else if (req.url.startsWith("/ai/vectors/") && req.method === "DELETE") {
        deletedDocId = decodeURIComponent(req.url.replace("/ai/vectors/", ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ document_id: deletedDocId, deleted: true, status: "deleted" }));
      }
    });
  });

  try {
    const client = new PythonAiClient({ baseUrl: mock.url, timeoutMs: 1000 });
    const clauses = Array.from({ length: 600 }, (_, i) => ({ clause_id: `c_${i}`, text: `text ${i}` }));

    const res = await client.indexClauses("doc_fail", clauses);
    assert.equal(res.success, false);
    assert.equal(res.status, 500);
    // Verified that deleteDocumentVectors was triggered to clean up partially indexed chunk 1
    assert.equal(deletedDocId, "doc_fail");
  } finally {
    await mock.close();
  }
});
