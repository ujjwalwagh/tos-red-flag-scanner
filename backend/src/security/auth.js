/**
 * Bearer Token Authentication Middleware for TOS Red Flag Scanner (Phase 8C.3B).
 *
 * Implements SEC-BACK-1 foundational API authentication using constant-time
 * token comparison over SHA-256 digests to prevent timing attacks.
 *
 * Operates behind the ENABLE_API_AUTH feature flag (default: false).
 */

import crypto from "node:crypto";
import { config } from "../config/env.js";

/**
 * Safely extracts the Bearer token from an Authorization header.
 *
 * @param {string} [authHeader] - Raw Authorization header value
 * @returns {{ token: string | null, error: string | null }}
 */
export function extractBearerToken(authHeader) {
  if (typeof authHeader !== "string" || !authHeader.trim()) {
    return { token: null, error: "Authorization header is missing." };
  }

  const trimmed = authHeader.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length < 2) {
    return { token: null, error: "Malformed authorization header: Bearer token missing." };
  }

  const scheme = parts[0];
  if (scheme.toLowerCase() !== "bearer") {
    return { token: null, error: "Invalid authorization scheme: expected 'Bearer'." };
  }

  if (parts.length > 2) {
    return { token: null, error: "Malformed authorization header: unexpected extra credentials." };
  }

  const token = parts[1].trim();
  if (!token) {
    return { token: null, error: "Bearer token cannot be empty." };
  }

  return { token, error: null };
}

/**
 * Constant-time comparison of two token strings using SHA-256 digests.
 *
 * Hashing both inputs ensures fixed 32-byte buffers, completely avoiding
 * RangeError length exceptions and eliminating timing-attack side channels.
 *
 * @param {string} provided - Token provided by client
 * @param {string} expected - Expected server-side token
 * @returns {boolean} True if tokens match identically
 */
export function safeTokenCompare(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  const cleanProvided = provided.trim();
  const cleanExpected = expected.trim();
  if (!cleanProvided || !cleanExpected) {
    return false;
  }

  const hashProvided = crypto.createHash("sha256").update(cleanProvided).digest();
  const hashExpected = crypto.createHash("sha256").update(cleanExpected).digest();

  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

/**
 * Creates authentication middleware with customizable options.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.enabled] - Override feature flag state
 * @param {string|string[]} [options.tokens] - Override valid token pool
 * @returns {import("express").RequestHandler}
 */
export function createAuthMiddleware(options = {}) {
  return function authenticateRequest(req, res, next) {
    const isEnabled = options.enabled !== undefined
      ? Boolean(options.enabled)
      : Boolean(config.auth?.enabled);

    // 1. If authentication is disabled (localhost default), pass through
    if (!isEnabled) {
      return next();
    }

    // 2. Resolve expected tokens pool
    let validTokens = [];
    if (options.tokens !== undefined) {
      const raw = options.tokens;
      validTokens = Array.isArray(raw) ? raw : String(raw).split(",");
    } else if (Array.isArray(config.auth?.tokens) && config.auth.tokens.length > 0) {
      validTokens = config.auth.tokens;
    } else if (config.auth?.token) {
      validTokens = [config.auth.token];
    }

    validTokens = validTokens
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);

    // 3. Safety guard: if auth is enabled but server has no configured tokens, reject safely
    if (validTokens.length === 0) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_token"');
      return res.status(401).json({
        error: "Authentication error: Server has no valid API tokens configured."
      });
    }

    // 4. Extract Bearer token
    const authHeader = req.headers.authorization;
    const { token, error: extractError } = extractBearerToken(authHeader);

    if (extractError || !token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_token"');
      return res.status(401).json({
        error: extractError || "Authentication required. Bearer token missing."
      });
    }

    // 5. Verify token against valid token pool using constant-time comparison
    const isMatched = validTokens.some((expected) => safeTokenCompare(token, expected));

    if (!isMatched) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TOS Scanner API", error="invalid_token"');
      return res.status(401).json({
        error: "Unauthorized: Invalid or expired API token."
      });
    }

    // 6. Attach non-sensitive authenticated metadata (never attach raw token)
    req.authenticated = true;
    req.tokenIdentifier = crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);

    return next();
  };
}

/**
 * Default singleton authentication middleware instance using application config.
 */
export const authenticateRequest = createAuthMiddleware();
