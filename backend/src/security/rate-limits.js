/**
 * Tiered Rate Limiting & Abuse Prevention for TOS Red Flag Scanner (Phase 8C.3C).
 *
 * Implements SEC-BACK-2 tiered rate limits to protect expensive AI operations,
 * document ingestion pipelines, and general endpoints from quota drainage and DoS.
 *
 * Rate Limit Tiers:
 * - Heavy AI Tier: 10 requests / minute (Gemini LLM & DeBERTa NLI cross-encoder)
 * - Ingestion Tier: 25 requests / 15 minutes (PDF extraction & Cheerio URL fetching)
 * - General API Tier: 100 requests / 15 minutes (Deterministic legal heuristics)
 * - Health Check Tier: 60 requests / minute (Uptime & connectivity probes)
 *
 * Keying Strategy:
 * - Authenticated requests: Keys on `token:<req.tokenIdentifier>` (never uses raw Bearer token)
 * - Unauthenticated requests: Keys on resolved client IP (`req.ip`)
 *
 * Limitations of In-Memory Storage:
 * - The default MemoryStore maintains hit counters in process RAM.
 * - In multi-instance or clustered deployments (e.g. Kubernetes, multiple Docker containers),
 *   rate-limit state is isolated per process unless a shared Redis store is configured.
 */

import rateLimit, { MemoryStore, ipKeyGenerator } from "express-rate-limit";
import { config } from "../config/env.js";

/**
 * Generates a safe rate-limit key.
 *
 * When authenticated, uses the non-sensitive tokenIdentifier established by auth.js.
 * The raw Bearer token is NEVER used as a key or stored in memory.
 * When unauthenticated, falls back to the resolved client IP wrapped by ipKeyGenerator
 * to prevent IPv6 subnet rotation bypasses.
 *
 * @param {import("express").Request} req
 * @returns {string} Safe cache key
 */
export function createRateLimitKey(req) {
  if (req.authenticated && typeof req.tokenIdentifier === "string" && req.tokenIdentifier.length > 0) {
    return `token:${req.tokenIdentifier}`;
  }
  const rawIp = req.ip || req.socket?.remoteAddress || "127.0.0.1";
  return ipKeyGenerator(rawIp);
}

/**
 * Standardized rate-limit error handler returning consistent JSON responses.
 *
 * @param {string} defaultMessage
 * @returns {import("express-rate-limit").RateLimitHandler}
 */
function createRateLimitHandler(defaultMessage) {
  return function rateLimitHandler(_req, res, _next, options) {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.status(options.statusCode || 429).json({
      error: options.message || defaultMessage,
      retryAfter
    });
  };
}

/**
 * Factory creating an express-rate-limit middleware with consistent headers and keying.
 *
 * @param {Object} tierConfig
 * @param {number} tierConfig.windowMs
 * @param {number} tierConfig.max
 * @param {string} tierConfig.message
 * @param {Object} [overrides={}]
 * @returns {import("express").RequestHandler}
 */
export function createTierLimiter(tierConfig, overrides = {}) {
  const windowMs = overrides.windowMs !== undefined ? overrides.windowMs : tierConfig.windowMs;
  const max = overrides.max !== undefined ? overrides.max : tierConfig.max;
  const message = overrides.message || tierConfig.message;

  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: overrides.keyGenerator || createRateLimitKey,
    handler: overrides.handler || createRateLimitHandler(message),
    store: overrides.store || undefined, // undefined uses express-rate-limit default MemoryStore
    validate: { xForwardedForHeader: false, default: false, ...overrides.validate }
  });
}

// ------------------------------------------------------------------
// Tier Definitions
// ------------------------------------------------------------------

const TIER_DEFAULTS = {
  heavyAi: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: "Too many AI analysis requests. Please try again in a minute."
  },
  ingestion: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 25,
    message: "Too many document ingestion requests. Please try again later."
  },
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: "Too many requests. Please try again later."
  },
  health: {
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: "Too many health check requests."
  }
};

/**
 * Creates individual rate limiters using application configuration.
 */
export function createTieredLimiters(overrides = {}) {
  const cfg = config.rateLimit || {};
  const isTest = Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "test");

  const heavyAi = createTierLimiter(
    {
      windowMs: cfg.heavyAi?.windowMs || TIER_DEFAULTS.heavyAi.windowMs,
      max: isTest ? 1000 : (cfg.heavyAi?.max || TIER_DEFAULTS.heavyAi.max),
      message: TIER_DEFAULTS.heavyAi.message
    },
    overrides.heavyAi
  );

  const ingestion = createTierLimiter(
    {
      windowMs: cfg.ingestion?.windowMs || TIER_DEFAULTS.ingestion.windowMs,
      max: isTest ? 1000 : (cfg.ingestion?.max || TIER_DEFAULTS.ingestion.max),
      message: TIER_DEFAULTS.ingestion.message
    },
    overrides.ingestion
  );

  const general = createTierLimiter(
    {
      windowMs: cfg.general?.windowMs || TIER_DEFAULTS.general.windowMs,
      max: isTest ? 1000 : (cfg.general?.max || TIER_DEFAULTS.general.max),
      message: TIER_DEFAULTS.general.message
    },
    overrides.general
  );

  const health = createTierLimiter(
    {
      windowMs: cfg.health?.windowMs || TIER_DEFAULTS.health.windowMs,
      max: isTest ? 1000 : (cfg.health?.max || TIER_DEFAULTS.health.max),
      message: TIER_DEFAULTS.health.message
    },
    overrides.health
  );

  return { heavyAi, ingestion, general, health };
}

export const limiters = createTieredLimiters();
export const heavyAiLimiter = limiters.heavyAi;
export const ingestionLimiter = limiters.ingestion;
export const generalLimiter = limiters.general;
export const healthLimiter = limiters.health;

/**
 * Resolves the rate-limiting tier for an incoming HTTP request.
 *
 * @param {import("express").Request} req
 * @returns {"health" | "heavyAi" | "ingestion" | "general"}
 */
export function resolveRateLimitTier(req) {
  const method = (req.method || "").toUpperCase();
  const rawPath = (req.originalUrl || req.path || req.url || "").split("?")[0].toLowerCase();

  // Health check route
  if (rawPath === "/health" || rawPath.endsWith("/health")) {
    return "health";
  }

  // Heavy AI routes: Q&A and AI document analysis
  if (method === "POST" && (rawPath.includes("/analyze/qa") || rawPath.endsWith("/analyze") || rawPath === "/api/analyze")) {
    return "heavyAi";
  }

  // Ingestion routes: URL scanning, PDF document ingestion
  if (method === "POST" && (rawPath.includes("/scan") || rawPath.includes("/ingest"))) {
    return "ingestion";
  }

  // All other API routes fall under General
  return "general";
}

/**
 * Creates a composite dispatcher middleware that routes incoming requests
 * to exactly one rate-limit tier based on resolveRateLimitTier(req).
 *
 * Avoids accidental double-counting by ensuring each request passes through
 * one tier only.
 *
 * @param {Object} [customLimiters]
 * @returns {import("express").RequestHandler}
 */
export function createApiRateLimiter(customLimiters = limiters) {
  return function apiRateLimiter(req, res, next) {
    const tier = resolveRateLimitTier(req);

    if (tier === "heavyAi") {
      return customLimiters.heavyAi(req, res, next);
    }
    if (tier === "ingestion") {
      return customLimiters.ingestion(req, res, next);
    }
    return customLimiters.general(req, res, next);
  };
}

export const apiRateLimiter = createApiRateLimiter();
