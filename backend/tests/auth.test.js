import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  extractBearerToken,
  safeTokenCompare,
  createAuthMiddleware,
  authenticateRequest
} from "../src/security/auth.js";
import { app } from "../server.js";

const VALID_TOKEN_1 = "tos_test_token_alpha_1234567890abcdef";
const VALID_TOKEN_2 = "tos_test_token_beta_0987654321fedcba";
const INVALID_TOKEN = "tos_invalid_token_999999999999999999";

/* ------------------------------------------------------------------
 * Unit Tests: extractBearerToken
 * ------------------------------------------------------------------ */

test("extractBearerToken rejects missing or undefined header", () => {
  const r1 = extractBearerToken(undefined);
  assert.equal(r1.token, null);
  assert.match(r1.error, /missing/i);

  const r2 = extractBearerToken(null);
  assert.equal(r2.token, null);
  assert.match(r2.error, /missing/i);

  const r3 = extractBearerToken("");
  assert.equal(r3.token, null);
  assert.match(r3.error, /missing/i);

  const r4 = extractBearerToken("   ");
  assert.equal(r4.token, null);
  assert.match(r4.error, /missing/i);
});

test("extractBearerToken rejects invalid authorization schemes", () => {
  const r1 = extractBearerToken("Basic dXNlcjpwYXNz");
  assert.equal(r1.token, null);
  assert.match(r1.error, /expected 'Bearer'/i);

  const r2 = extractBearerToken("Token 12345");
  assert.equal(r2.token, null);
  assert.match(r2.error, /expected 'Bearer'/i);

  const r3 = extractBearerToken("Digest username=xyz");
  assert.equal(r3.token, null);
  assert.match(r3.error, /expected 'Bearer'/i);
});

test("extractBearerToken rejects malformed headers without token", () => {
  const r1 = extractBearerToken("Bearer");
  assert.equal(r1.token, null);
  assert.match(r1.error, /token missing/i);

  const r2 = extractBearerToken("Bearer ");
  assert.equal(r2.token, null);
  assert.match(r2.error, /token missing/i);
});

test("extractBearerToken rejects malformed headers with extra tokens", () => {
  const r = extractBearerToken(`Bearer ${VALID_TOKEN_1} extra_token`);
  assert.equal(r.token, null);
  assert.match(r.error, /unexpected extra credentials/i);
});

test("extractBearerToken accepts valid Bearer header", () => {
  const r = extractBearerToken(`Bearer ${VALID_TOKEN_1}`);
  assert.equal(r.token, VALID_TOKEN_1);
  assert.equal(r.error, null);
});

test("extractBearerToken is case-insensitive for 'bearer' scheme", () => {
  const r1 = extractBearerToken(`bearer ${VALID_TOKEN_1}`);
  assert.equal(r1.token, VALID_TOKEN_1);
  assert.equal(r1.error, null);

  const r2 = extractBearerToken(`BEARER ${VALID_TOKEN_1}`);
  assert.equal(r2.token, VALID_TOKEN_1);
  assert.equal(r2.error, null);
});

/* ------------------------------------------------------------------
 * Unit Tests: safeTokenCompare
 * ------------------------------------------------------------------ */

test("safeTokenCompare returns true for identical tokens", () => {
  assert.equal(safeTokenCompare(VALID_TOKEN_1, VALID_TOKEN_1), true);
});

test("safeTokenCompare returns false for different tokens of equal length", () => {
  const tokenA = "12345678901234567890123456789012";
  const tokenB = "12345678901234567890123456789013";
  assert.equal(safeTokenCompare(tokenA, tokenB), false);
});

test("safeTokenCompare handles unequal token lengths without throwing RangeError", () => {
  const shortToken = "short";
  const longToken = "very_long_token_that_has_much_more_entropy_and_characters_1234567890";
  assert.doesNotThrow(() => {
    const res = safeTokenCompare(shortToken, longToken);
    assert.equal(res, false);
  });
});

test("safeTokenCompare returns false for empty or non-string inputs", () => {
  assert.equal(safeTokenCompare("", VALID_TOKEN_1), false);
  assert.equal(safeTokenCompare(VALID_TOKEN_1, ""), false);
  assert.equal(safeTokenCompare(null, VALID_TOKEN_1), false);
  assert.equal(safeTokenCompare(undefined, VALID_TOKEN_1), false);
  assert.equal(safeTokenCompare(12345, VALID_TOKEN_1), false);
});

/* ------------------------------------------------------------------
 * Unit Tests: createAuthMiddleware (Mock Req / Res)
 * ------------------------------------------------------------------ */

test("createAuthMiddleware: passes through when enabled is false (localhost default)", () => {
  const middleware = createAuthMiddleware({ enabled: false, tokens: [VALID_TOKEN_1] });
  let nextCalled = false;
  const req = { headers: {} };
  const res = {};
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("createAuthMiddleware: rejects missing header when enabled is true", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1] });
  let statusCode = 0;
  let jsonResponse = null;
  let authHeaderSet = null;

  const req = { headers: {} };
  const res = {
    setHeader(name, val) { if (name.toLowerCase() === "www-authenticate") authHeaderSet = val; },
    status(code) {
      statusCode = code;
      return {
        json(data) { jsonResponse = data; }
      };
    }
  };

  middleware(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResponse.error, /missing/i);
  assert.match(authHeaderSet, /Bearer/);
});

test("createAuthMiddleware: rejects wrong scheme when enabled is true", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1] });
  let statusCode = 0;
  let jsonResponse = null;

  const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return {
        json(data) { jsonResponse = data; }
      };
    }
  };

  middleware(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResponse.error, /expected 'Bearer'/i);
});

test("createAuthMiddleware: rejects incorrect token when enabled is true", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1] });
  let statusCode = 0;
  let jsonResponse = null;

  const req = { headers: { authorization: `Bearer ${INVALID_TOKEN}` } };
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return {
        json(data) { jsonResponse = data; }
      };
    }
  };

  middleware(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResponse.error, /invalid or expired/i);
});

test("createAuthMiddleware: accepts valid token and sets non-sensitive metadata", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1] });
  let nextCalled = false;

  const req = { headers: { authorization: `Bearer ${VALID_TOKEN_1}` } };
  const res = {};

  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.authenticated, true);
  assert.equal(typeof req.tokenIdentifier, "string");
  assert.equal(req.tokenIdentifier.length, 8);
});

test("createAuthMiddleware: supports multi-token pool", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1, VALID_TOKEN_2] });

  let next1 = false;
  const req1 = { headers: { authorization: `Bearer ${VALID_TOKEN_1}` } };
  middleware(req1, {}, () => { next1 = true; });
  assert.equal(next1, true);

  let next2 = false;
  const req2 = { headers: { authorization: `Bearer ${VALID_TOKEN_2}` } };
  middleware(req2, {}, () => { next2 = true; });
  assert.equal(next2, true);

  let status3 = 0;
  const req3 = { headers: { authorization: `Bearer ${INVALID_TOKEN}` } };
  const res3 = {
    setHeader() {},
    status(code) {
      status3 = code;
      return { json() {} };
    }
  };
  middleware(req3, res3, () => {});
  assert.equal(status3, 401);
});

test("createAuthMiddleware: safely rejects when server has no configured tokens", () => {
  const middleware = createAuthMiddleware({ enabled: true, tokens: [] });
  let statusCode = 0;
  let jsonResponse = null;

  const req = { headers: { authorization: `Bearer ${VALID_TOKEN_1}` } };
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return { json(data) { jsonResponse = data; } };
    }
  };

  middleware(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResponse.error, /no valid API tokens configured/i);
});

/* ------------------------------------------------------------------
 * Integration Tests: Express Server with Auth Middleware
 * ------------------------------------------------------------------ */

test("Express Integration: /health remains public and /api requires auth when enabled", async () => {
  const testApp = express();
  const testAuth = createAuthMiddleware({ enabled: true, tokens: [VALID_TOKEN_1] });

  testApp.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  testApp.use("/api", testAuth);
  testApp.get("/api/test-protected", (_req, res) => {
    res.status(200).json({ protected: true, client: _req.tokenIdentifier });
  });

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;

  async function request(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            let body;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  try {
    // 1. Health check is public without token
    const healthRes = await request("/health");
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, "ok");

    // 2. Protected endpoint without token returns 401
    const unauthRes = await request("/api/test-protected");
    assert.equal(unauthRes.status, 401);
    assert.match(unauthRes.body.error, /missing/i);
    assert.match(unauthRes.headers["www-authenticate"], /Bearer/);

    // 3. Protected endpoint with invalid token returns 401
    const badTokenRes = await request("/api/test-protected", {
      authorization: `Bearer ${INVALID_TOKEN}`
    });
    assert.equal(badTokenRes.status, 401);
    assert.match(badTokenRes.body.error, /invalid or expired/i);

    // 4. Protected endpoint with valid token returns 200
    const validRes = await request("/api/test-protected", {
      authorization: `Bearer ${VALID_TOKEN_1}`
    });
    assert.equal(validRes.status, 200);
    assert.equal(validRes.body.protected, true);
    assert.equal(typeof validRes.body.client, "string");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * Live Server Regression: Existing Application operates unauthenticated by default
 * ------------------------------------------------------------------ */

test("Live app regression: /health is 200 and /api/analyze/categories works without token by default", async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;

  async function request(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            let body;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: res.statusCode, body });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  try {
    // 1. Health check works
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");

    // 2. Categories works without token because ENABLE_API_AUTH defaults to false
    const categories = await request("/api/analyze/categories");
    assert.equal(categories.status, 200);
    assert.equal(categories.body.success, true);
    assert.ok(Array.isArray(categories.body.categories));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
