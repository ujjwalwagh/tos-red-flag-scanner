import { config } from "../config/env.js";

/**
 * Validates whether an origin string matches the canonical Chrome extension format.
 * Chrome/Chromium extension IDs are strictly 32 characters in the range [a-p].
 *
 * @param {string} origin
 * @returns {boolean}
 */
export function isValidChromeExtensionOrigin(origin) {
  if (typeof origin !== "string") return false;
  const trimmed = origin.trim();
  return /^chrome-extension:\/\/[a-p]{32}$/i.test(trimmed);
}

/**
 * Parses and returns a Set of valid lowercase Chrome extension origins from
 * a comma-separated string or array.
 *
 * @param {string|string[]} [rawConfig]
 * @returns {Set<string>}
 */
export function parseAllowedExtensionOrigins(rawConfig) {
  const source = arguments.length === 0 ? config.chromeExtension?.origin : rawConfig;
  const allowed = new Set();
  if (!source) return allowed;

  const rawList = Array.isArray(rawConfig) ? rawConfig : String(rawConfig).split(",");

  for (const item of rawList) {
    if (typeof item === "string") {
      const clean = item.trim().toLowerCase();
      if (isValidChromeExtensionOrigin(clean)) {
        allowed.add(clean);
      }
    }
  }

  return allowed;
}

/**
 * Determines whether a request origin is considered same-origin with the server.
 *
 * @param {string} origin
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function isSameOrigin(origin, req) {
  if (!origin) return true;

  const originLower = origin.trim().toLowerCase();
  const host = req.headers.host;

  if (host) {
    const hostLower = host.toLowerCase();
    if (originLower === `http://${hostLower}` || originLower === `https://${hostLower}`) {
      return true;
    }
  }

  const configuredPort = config.port || 3000;
  if (
    originLower === `http://localhost:${configuredPort}` ||
    originLower === `http://127.0.0.1:${configuredPort}`
  ) {
    return true;
  }

  return false;
}

/**
 * Creates restricted CORS middleware.
 *
 * @param {Object} [options]
 * @param {Set<string>|string|string[]} [options.allowedOrigins]
 * @returns {import("express").RequestHandler}
 */
export function createCorsMiddleware(options = {}) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    // 1. Same-origin or non-browser requests without Origin header proceed directly
    if (!origin) {
      return next();
    }

    // 2. Same-origin web application requests
    if (isSameOrigin(origin, req)) {
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.setHeader("Vary", "Origin");
        return res.status(204).end();
      }
      return next();
    }

    // 3. Resolve configured extension origins
    const allowedSet = options.allowedOrigins instanceof Set
      ? options.allowedOrigins
      : (options.allowedOrigins !== undefined
        ? parseAllowedExtensionOrigins(options.allowedOrigins)
        : parseAllowedExtensionOrigins());

    const originLower = origin.trim().toLowerCase();

    // 4. Configured Chrome extension origin
    if (allowedSet.has(originLower)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      res.setHeader("Access-Control-Max-Age", "86400");
      res.setHeader("Vary", "Origin");

      if (req.method === "OPTIONS") {
        return res.status(204).end();
      }

      return next();
    }

    // 5. Unauthorized origin (unconfigured extension, arbitrary website, or wildcard attempt)
    return res.status(403).json({ error: "CORS origin not allowed." });
  };
}

