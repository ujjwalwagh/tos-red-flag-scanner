import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { MemoryStore } from "express-rate-limit";

import {
  createRateLimitKey,
  resolveRateLimitTier,
  createTierLimiter,
  createTieredLimiters,
  createApiRateLimiter,
  limiters,
  healthLimiter,
  apiRateLimiter
} from "../src/security/rate-limits.js";
import { config } from "../src/config/env.js";
import { app } from "../server.js";

/* ------------------------------------------------------------------
 * Helper: Send HTTP request to ephemeral Express server
 * ------------------------------------------------------------------ */

function makeRequest(server, path, options = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method || "GET",
        headers: options.headers || {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

/* ------------------------------------------------------------------
 * 1. Unit Tests: createRateLimitKey
 * ------------------------------------------------------------------ */

test("createRateLimitKey: uses token identifier when request is authenticated", () => {
  const req = {
    authenticated: true,
    tokenIdentifier: "abcd1234efgh5678",
    ip: "192.168.1.50",
    headers: {
      authorization: "Bearer secret-raw-token-never-expose"
    }
  };

  const key = createRateLimitKey(req);
  assert.equal(key, "token:abcd1234efgh5678");
  assert.ok(!key.includes("secret-raw-token-never-expose"), "Key must not contain raw token");
});

test("createRateLimitKey: falls back to req.ip when unauthenticated", () => {
  const req = {
    authenticated: false,
    ip: "10.0.0.5",
    headers: {
      authorization: "Bearer some-token"
    }
  };

  const key = createRateLimitKey(req);
  assert.equal(key, "10.0.0.5");
  assert.ok(!key.includes("Bearer"), "Key must not contain raw token");
});

test("createRateLimitKey: falls back to socket remoteAddress when req.ip is missing", () => {
  const req = {
    authenticated: false,
    socket: { remoteAddress: "127.0.0.1" }
  };

  const key = createRateLimitKey(req);
  assert.equal(key, "127.0.0.1");
});

test("createRateLimitKey: falls back to default 127.0.0.1 when both ip and socket missing", () => {
  const req = { authenticated: false };
  const key = createRateLimitKey(req);
  assert.equal(key, "127.0.0.1");
});

test("createRateLimitKey: ignores invalid tokenIdentifier format even if authenticated", () => {
  const req = {
    authenticated: true,
    tokenIdentifier: "",
    ip: "172.16.0.1"
  };
  const key = createRateLimitKey(req);
  assert.equal(key, "172.16.0.1");
});

/* ------------------------------------------------------------------
 * 2. Unit Tests: resolveRateLimitTier (Route-to-tier classification)
 * ------------------------------------------------------------------ */

test("resolveRateLimitTier: correctly classifies health check endpoints", () => {
  assert.equal(resolveRateLimitTier({ path: "/health", method: "GET" }), "health");
  assert.equal(resolveRateLimitTier({ originalUrl: "/health?check=1", method: "GET" }), "health");
  assert.equal(resolveRateLimitTier({ path: "/HEALTH", method: "GET" }), "health");
});

test("resolveRateLimitTier: correctly classifies heavy AI endpoints", () => {
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/analyze/qa", method: "POST" }), "heavyAi");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/analyze/qa?lang=en", method: "POST" }), "heavyAi");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/analyze", method: "POST" }), "heavyAi");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/ANALYZE", method: "POST" }), "heavyAi");

  // Non-POST requests to analyze do not get heavyAi tier
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/analyze", method: "GET" }), "general");
});

test("resolveRateLimitTier: correctly classifies document ingestion endpoints", () => {
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/scan", method: "POST" }), "ingestion");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/documents/ingest", method: "POST" }), "ingestion");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/pdf/ingest", method: "POST" }), "ingestion");
});

test("resolveRateLimitTier: correctly classifies general API endpoints", () => {
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/remediation/categories", method: "GET" }), "general");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/negotiation/generate", method: "POST" }), "general");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/compliance/audit", method: "POST" }), "general");
  assert.equal(resolveRateLimitTier({ originalUrl: "/api/compliance/jurisdictions", method: "GET" }), "general");
});

/* ------------------------------------------------------------------
 * 3. Unit Tests: Limiter configuration and factory defaults
 * ------------------------------------------------------------------ */

test("Tier default configurations match security specifications", () => {
  assert.equal(config.rateLimit.heavyAi.windowMs, 60 * 1000, "Heavy AI window is 1 minute");
  assert.equal(config.rateLimit.heavyAi.max, 10, "Heavy AI limit is 10 requests");

  assert.equal(config.rateLimit.ingestion.windowMs, 15 * 60 * 1000, "Ingestion window is 15 minutes");
  assert.equal(config.rateLimit.ingestion.max, 25, "Ingestion limit is 25 requests");

  assert.equal(config.rateLimit.general.windowMs, 15 * 60 * 1000, "General window is 15 minutes");
  assert.equal(config.rateLimit.general.max, 100, "General limit is 100 requests");

  assert.equal(config.rateLimit.health.windowMs, 60 * 1000, "Health window is 1 minute");
  assert.equal(config.rateLimit.health.max, 60, "Health limit is 60 requests");
});

/* ------------------------------------------------------------------
 * 4. Integration Tests: Below limit (200 OK) and Exceeding limit (429)
 * ------------------------------------------------------------------ */

test("Limiter allows requests within limit and returns 429 when exceeded with Retry-After", async () => {
  const testApp = express();
  const limiter = createTierLimiter(
    {
      windowMs: 60 * 1000,
      max: 2,
      message: "Custom rate limit exceeded."
    },
    { store: new MemoryStore() }
  );

  testApp.use("/test", limiter);
  testApp.get("/test", (_req, res) => res.json({ success: true }));

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    // Request 1: within limit -> 200
    const res1 = await makeRequest(server, "/test");
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.success, true);
    assert.ok(res1.headers["ratelimit-remaining"] !== undefined || res1.headers["x-ratelimit-remaining"] !== undefined);

    // Request 2: within limit -> 200
    const res2 = await makeRequest(server, "/test");
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.success, true);

    // Request 3: exceeded -> 429
    const res3 = await makeRequest(server, "/test");
    assert.equal(res3.statusCode, 429);
    assert.equal(res3.body.error, "Custom rate limit exceeded.");
    assert.ok(typeof res3.body.retryAfter === "number", "Body must include numeric retryAfter");
    assert.ok(res3.headers["retry-after"] !== undefined, "Headers must include Retry-After");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * 5. Integration Tests: Independent buckets between tiers
 * ------------------------------------------------------------------ */

test("Independent rate-limit tiers: heavy AI tier depletion does not affect general tier", async () => {
  const testApp = express();

  const customLimiters = {
    heavyAi: createTierLimiter({ windowMs: 60000, max: 2, message: "AI limit reached." }, { store: new MemoryStore() }),
    ingestion: createTierLimiter({ windowMs: 60000, max: 5, message: "Ingestion limit reached." }, { store: new MemoryStore() }),
    general: createTierLimiter({ windowMs: 60000, max: 10, message: "General limit reached." }, { store: new MemoryStore() }),
    health: createTierLimiter({ windowMs: 60000, max: 20, message: "Health limit reached." }, { store: new MemoryStore() })
  };

  const dispatcher = createApiRateLimiter(customLimiters);
  testApp.use("/api", dispatcher);

  testApp.post("/api/analyze/qa", (_req, res) => res.json({ tier: "heavyAi" }));
  testApp.get("/api/remediation/categories", (_req, res) => res.json({ tier: "general" }));

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    // Deplete heavyAi tier (max: 2)
    const ai1 = await makeRequest(server, "/api/analyze/qa", { method: "POST" });
    assert.equal(ai1.statusCode, 200);
    const ai2 = await makeRequest(server, "/api/analyze/qa", { method: "POST" });
    assert.equal(ai2.statusCode, 200);
    const ai3 = await makeRequest(server, "/api/analyze/qa", { method: "POST" });
    assert.equal(ai3.statusCode, 429);
    assert.equal(ai3.body.error, "AI limit reached.");

    // General tier must still succeed with 200 (not affected by heavyAi depletion)
    const gen1 = await makeRequest(server, "/api/remediation/categories", { method: "GET" });
    assert.equal(gen1.statusCode, 200);
    assert.equal(gen1.body.tier, "general");

    const gen2 = await makeRequest(server, "/api/remediation/categories", { method: "GET" });
    assert.equal(gen2.statusCode, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * 6. Integration Tests: Authenticated token keying isolation
 * ------------------------------------------------------------------ */

test("Authenticated rate-limiting keys on token:tokenIdentifier and isolates clients", async () => {
  const testApp = express();

  // Middleware simulating auth resolution
  testApp.use((req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader === "Bearer token_alpha_secret_key_111111") {
      req.authenticated = true;
      req.tokenIdentifier = "alpha_ident_1111";
    } else if (authHeader === "Bearer token_beta_secret_key_222222") {
      req.authenticated = true;
      req.tokenIdentifier = "beta_ident_2222";
    }
    next();
  });

  const limiter = createTierLimiter(
    { windowMs: 60000, max: 2, message: "Limit reached" },
    { store: new MemoryStore() }
  );

  testApp.use("/test", limiter);
  testApp.get("/test", (req, res) => res.json({ client: req.tokenIdentifier }));

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const alphaHeaders = { authorization: "Bearer token_alpha_secret_key_111111" };
    const betaHeaders = { authorization: "Bearer token_beta_secret_key_222222" };

    // Alpha uses 2 requests
    const a1 = await makeRequest(server, "/test", { headers: alphaHeaders });
    assert.equal(a1.statusCode, 200);
    const a2 = await makeRequest(server, "/test", { headers: alphaHeaders });
    assert.equal(a2.statusCode, 200);

    // Alpha 3rd request is blocked (429)
    const a3 = await makeRequest(server, "/test", { headers: alphaHeaders });
    assert.equal(a3.statusCode, 429);

    // Beta's bucket is fresh and must succeed with 200
    const b1 = await makeRequest(server, "/test", { headers: betaHeaders });
    assert.equal(b1.statusCode, 200);
    assert.equal(b1.body.client, "beta_ident_2222");

    const b2 = await makeRequest(server, "/test", { headers: betaHeaders });
    assert.equal(b2.statusCode, 200);

    // Beta 3rd request is blocked (429)
    const b3 = await makeRequest(server, "/test", { headers: betaHeaders });
    assert.equal(b3.statusCode, 429);

    // Verify raw tokens are NEVER present in 429 body or headers
    const bodyStr = JSON.stringify(a3.body);
    assert.ok(!bodyStr.includes("token_alpha_secret_key_111111"), "Raw token must not appear in 429 response body");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * 7. Reverse Proxy Trust & Spoofed X-Forwarded-For Behavior
 * ------------------------------------------------------------------ */

test("Reverse proxy trust disabled (default): ignores spoofed X-Forwarded-For header", async () => {
  const testApp = express();
  // Express default: app.get("trust proxy") is false
  assert.equal(testApp.get("trust proxy"), false);

  testApp.get("/ip-check", (req, res) => {
    res.json({
      resolvedIp: req.ip,
      rateLimitKey: createRateLimitKey(req)
    });
  });

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    // Client sends spoofed X-Forwarded-For header
    const res = await makeRequest(server, "/ip-check", {
      headers: { "x-forwarded-for": "203.0.113.195, 198.51.100.22" }
    });

    assert.equal(res.statusCode, 200);
    // Express must ignore X-Forwarded-For and report local loopback IP
    assert.ok(
      res.body.resolvedIp === "127.0.0.1" || res.body.resolvedIp === "::ffff:127.0.0.1" || res.body.resolvedIp === "::1",
      `Expected loopback IP, got: ${res.body.resolvedIp}`
    );
    assert.ok(!res.body.rateLimitKey.includes("203.0.113.195"), "Rate limit key must not use untrusted forwarded IP");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Reverse proxy trust enabled: respects upstream X-Forwarded-For header safely", async () => {
  const testApp = express();
  // Explicitly enable trust proxy (e.g. behind NGINX or ALB)
  testApp.set("trust proxy", true);

  testApp.get("/ip-check", (req, res) => {
    res.json({
      resolvedIp: req.ip,
      rateLimitKey: createRateLimitKey(req)
    });
  });

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const res = await makeRequest(server, "/ip-check", {
      headers: { "x-forwarded-for": "203.0.113.195" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.resolvedIp, "203.0.113.195");
    assert.equal(res.body.rateLimitKey, "203.0.113.195");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * 8. Integration Tests: Health endpoint dedicated limiter
 * ------------------------------------------------------------------ */

test("Health check endpoint has dedicated rate limiter independent of API routes", async () => {
  const testApp = express();
  const testHealthLimiter = createTierLimiter(
    { windowMs: 60000, max: 2, message: "Health limit reached" },
    { store: new MemoryStore() }
  );

  testApp.get("/health", testHealthLimiter, (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const h1 = await makeRequest(server, "/health");
    assert.equal(h1.statusCode, 200);
    const h2 = await makeRequest(server, "/health");
    assert.equal(h2.statusCode, 200);
    const h3 = await makeRequest(server, "/health");
    assert.equal(h3.statusCode, 429);
    assert.equal(h3.body.error, "Health limit reached");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------
 * 9. Integration Tests: Full server.js live mounting verification
 * ------------------------------------------------------------------ */

test("Live server.js export mounts healthLimiter and apiRateLimiter without breaking routes", async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    // 1. Health check works
    const healthRes = await makeRequest(server, "/health");
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.body.status, "ok");

    // 2. API routes work under apiRateLimiter (e.g. /api/analyze/categories)
    const catRes = await makeRequest(server, "/api/analyze/categories");
    assert.equal(catRes.statusCode, 200);
    assert.ok(catRes.body.categories !== undefined || catRes.body.status !== undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
