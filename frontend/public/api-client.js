/**
 * TOS Red Flag Scanner — Centralized Web API Client & Configuration (Phase 8C.4B).
 *
 * Implements SEC-BACK-1 web application authentication compatibility:
 * - Centralized fetch helper (apiFetch) prepending backend URL and injecting Bearer tokens.
 * - Dynamic backend URL validation (HTTP localhost only, HTTPS for remote).
 * - Secure credential storage in localStorage (with safe fallback for non-browser/test environments).
 * - Multi-stage connection test (/health -> /api/analyze/categories).
 * - Redirection protection (redirect: "error") preventing credential leakage.
 * - Safe credential masking for logging and diagnostics.
 */

export const STORAGE_KEY_CONFIG = "tos_web_backend_config";
export const DEFAULT_BACKEND_URL = "http://localhost:3000";

// In-memory fallback storage for Node.js / test environments where window.localStorage is unavailable
const memoryStorage = new Map();

/**
 * Resolves safe storage interface (browser localStorage or in-memory fallback).
 *
 * @param {Storage} [customStorage]
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
export function resolveStorage(customStorage) {
  if (customStorage && typeof customStorage.getItem === "function") {
    return customStorage;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return {
    getItem: (key) => memoryStorage.get(key) || null,
    setItem: (key, val) => memoryStorage.set(key, String(val)),
    removeItem: (key) => memoryStorage.delete(key),
    clear: () => memoryStorage.clear()
  };
}

/**
 * Validates whether a candidate backend URL meets protocol and security constraints.
 *
 * Rules:
 * - Empty string or whitespace defaults safely to same-origin / default localhost.
 * - Supported protocols: HTTP (strictly loopback/localhost) and HTTPS (remote servers).
 * - Reject cleartext HTTP for remote hosts to prevent plaintext token transmission.
 * - Reject URLs with embedded credentials (user:pass@host).
 * - Reject unsupported schemes (file:, ftp:, javascript:, etc.).
 * - Normalize by removing trailing slashes.
 *
 * @param {string} urlInput
 * @returns {{ valid: boolean, normalizedUrl?: string, error?: string }}
 */
export function validateBackendUrl(urlInput) {
  if (urlInput === undefined || urlInput === null) {
    return { valid: true, normalizedUrl: "" };
  }

  if (typeof urlInput !== "string") {
    return { valid: false, error: "Backend URL must be a string." };
  }

  const trimmed = urlInput.trim();
  if (trimmed.length === 0) {
    return { valid: true, normalizedUrl: "" };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: "Invalid URL format. Please provide a full URL (e.g. http://localhost:3000 or https://api.example.com)."
    };
  }

  // 1. Protocol check: only http: and https: are allowed
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Unsupported protocol '${parsed.protocol}'. Only HTTP (localhost) and HTTPS (remote) are supported.`
    };
  }

  // 2. Reject embedded credentials (security safeguard against credential leakage)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: "URLs with embedded credentials (username or password) are not permitted."
    };
  }

  // 3. Localhost vs Remote HTTP check
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost");

  if (parsed.protocol === "http:" && !isLoopback) {
    return {
      valid: false,
      error: "Insecure HTTP is strictly restricted to local development (localhost / 127.0.0.1). Remote backends must use HTTPS."
    };
  }

  // 4. Normalize: remove trailing slashes from path
  const cleanPath = (parsed.pathname === "/" ? "" : parsed.pathname).replace(/\/+$/, "");
  const normalizedUrl = `${parsed.origin}${cleanPath}`;

  return {
    valid: true,
    normalizedUrl
  };
}

/**
 * Retrieves the stored backend configuration.
 *
 * @param {Storage} [customStorage]
 * @returns {{ backendUrl: string, token: string, isDefault: boolean }}
 */
export function getStoredConfig(customStorage) {
  const storage = resolveStorage(customStorage);
  try {
    const raw = storage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) {
      return {
        backendUrl: "",
        token: "",
        isDefault: true
      };
    }
    const parsed = JSON.parse(raw);
    const valResult = validateBackendUrl(parsed?.backendUrl || "");
    const backendUrl = valResult.valid ? (valResult.normalizedUrl || "") : "";
    const token = typeof parsed?.token === "string" ? parsed.token.trim() : "";

    return {
      backendUrl,
      token,
      isDefault: !backendUrl && !token
    };
  } catch {
    return {
      backendUrl: "",
      token: "",
      isDefault: true
    };
  }
}

/**
 * Persists backend configuration in localStorage.
 *
 * @param {Object} params
 * @param {string} params.backendUrl
 * @param {string} [params.token]
 * @param {Storage} [customStorage]
 * @returns {{ ok: boolean, config?: Object, error?: string }}
 */
export function saveStoredConfig({ backendUrl = "", token = "" }, customStorage) {
  const validation = validateBackendUrl(backendUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const cleanToken = typeof token === "string" ? token.trim() : "";
  const payloadToStore = {
    backendUrl: validation.normalizedUrl || "",
    token: cleanToken,
    updatedAt: new Date().toISOString()
  };

  const storage = resolveStorage(customStorage);
  try {
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(payloadToStore));
    return {
      ok: true,
      config: {
        backendUrl: validation.normalizedUrl || "",
        hasToken: cleanToken.length > 0
      }
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to save configuration to browser storage: ${err.message}`
    };
  }
}

/**
 * Resets configuration back to default (same-origin / empty credentials).
 *
 * @param {Storage} [customStorage]
 * @returns {{ ok: boolean }}
 */
export function resetStoredConfig(customStorage) {
  const storage = resolveStorage(customStorage);
  try {
    storage.removeItem(STORAGE_KEY_CONFIG);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/**
 * Sanitizes configuration metadata for logging or diagnostics.
 * NEVER returns or prints the raw Bearer token string.
 *
 * @param {Object} cfg
 * @returns {{ backendUrl: string, hasToken: boolean }}
 */
export function sanitizeConfigForLogging(cfg) {
  return {
    backendUrl: cfg?.backendUrl || "(same-origin)",
    hasToken: Boolean(cfg?.token && String(cfg.token).trim().length > 0)
  };
}

/**
 * Builds HTTP headers, attaching the Bearer Authorization header only if a token is present.
 *
 * @param {string} [token]
 * @param {Record<string, string>} [existingHeaders={}]
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(token, existingHeaders = {}) {
  const headers = { ...existingHeaders };
  const clean = typeof token === "string" ? token.trim() : "";
  if (clean.length > 0) {
    headers["Authorization"] = `Bearer ${clean}`;
  }
  return headers;
}

/**
 * Resolves the full URL for an API path based on stored configuration.
 *
 * @param {string} path - Relative API path (e.g. "/api/scan")
 * @param {string} [customBackendUrl] - Optional base URL override
 * @returns {string}
 */
export function resolveApiUrl(path, customBackendUrl) {
  const base = customBackendUrl !== undefined
    ? customBackendUrl
    : getStoredConfig().backendUrl;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    return normalizedPath;
  }
  return `${base.replace(/\/+$/, "")}${normalizedPath}`;
}

/**
 * Centralized API request helper for all frontend fetch calls.
 *
 * Features:
 * - Automatically routes to configured backend URL.
 * - Injects Authorization: Bearer <token> when configured.
 * - Enforces redirect: "error" to prevent credential forwarding on redirects.
 * - Preserves caller options, JSON bodies, and multipart FormData bodies.
 * - Dispatches 'tos:auth_required' event on HTTP 401.
 *
 * @param {string} path - Target API path (e.g. "/api/scan", "/api/analyze/qa")
 * @param {RequestInit} [options={}] - Standard fetch RequestInit options
 * @param {Object} [deps={}] - Dependency injection for testing
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}, deps = {}) {
  const getConfig = deps.getConfig || getStoredConfig;
  const fetchFn = deps.fetchFn || (typeof window !== "undefined" ? window.fetch.bind(window) : fetch);
  const onAuthRequired = deps.onAuthRequired || null;

  const config = getConfig();
  const url = resolveApiUrl(path, config.backendUrl);

  const baseHeaders = options.headers || {};
  const headers = buildAuthHeaders(config.token, baseHeaders);

  const fetchOptions = {
    ...options,
    headers,
    redirect: "error" // Security invariant: abort on redirect to prevent credential leakage
  };

  const response = await fetchFn(url, fetchOptions);

  if (response.status === 401) {
    if (typeof onAuthRequired === "function") {
      onAuthRequired({ path, url, status: 401 });
    } else if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent("tos:auth_required", {
          detail: { path, url, status: 401 }
        })
      );
    }
  }

  return response;
}

/**
 * Multi-stage connection test sequence for the web application.
 *
 * Sequence:
 * 1. Validate configured URL format and protocol constraints.
 * 2. Query GET /health for server reachability and CORS.
 * 3. Query GET /api/analyze/categories to test Bearer Token authentication.
 *
 * Status Codes:
 * - AUTH_SUCCESS: Server online and Bearer token accepted.
 * - REACHABLE: Server online, authentication disabled or optional.
 * - AUTH_REQUIRED: Server online, but backend requires a Bearer token (HTTP 401).
 * - AUTH_INVALID: Server online, but the supplied Bearer token was rejected (HTTP 401).
 * - CORS_BLOCKED: Backend returned HTTP 403 (CORS rejection).
 * - NETWORK_ERROR: Backend offline or unreachable.
 *
 * @param {Object} params
 * @param {string} [params.backendUrl]
 * @param {string} [params.token]
 * @param {Function} [params.fetchFn]
 * @returns {Promise<{ ok: boolean, code: string, message: string, status?: number, error?: string }>}
 */
export async function testBackendConnection({ backendUrl = "", token = "", fetchFn } = {}) {
  const fetcher = fetchFn || (typeof window !== "undefined" ? window.fetch.bind(window) : fetch);

  // 1. Validate URL
  const validation = validateBackendUrl(backendUrl);
  if (!validation.valid) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: validation.error,
      error: validation.error
    };
  }

  const targetUrl = validation.normalizedUrl || "";
  const cleanToken = typeof token === "string" ? token.trim() : "";

  // 2. Query GET /health (unauthenticated reachability probe)
  const healthUrl = targetUrl ? `${targetUrl}/health` : "/health";
  let healthRes;

  try {
    const healthController = new AbortController();
    const healthTimer = setTimeout(() => healthController.abort(), 4000);
    healthRes = await fetcher(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: healthController.signal
    });
    clearTimeout(healthTimer);
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: isTimeout
        ? `Connection to backend at ${targetUrl || "localhost"} timed out.`
        : `Cannot reach backend at ${targetUrl || "localhost"} (${err.message || "Network offline"}).`,
      error: err.message || "Network error"
    };
  }

  if (!healthRes.ok) {
    if (healthRes.status === 403) {
      return {
        ok: false,
        code: "CORS_BLOCKED",
        message: "CORS Forbidden — Backend rejected request origin.",
        status: 403
      };
    }
    return {
      ok: false,
      code: "HEALTH_FAILED",
      message: `Backend health check returned HTTP ${healthRes.status}.`,
      status: healthRes.status
    };
  }

  // 3. Query GET /api/analyze/categories (lightweight read route to test auth)
  const categoriesUrl = targetUrl ? `${targetUrl}/api/analyze/categories` : "/api/analyze/categories";
  const authHeaders = { Accept: "application/json" };
  if (cleanToken) {
    authHeaders["Authorization"] = `Bearer ${cleanToken}`;
  }

  try {
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), 5000);
    const authTestRes = await fetcher(categoriesUrl, {
      method: "GET",
      headers: authHeaders,
      redirect: "error",
      signal: authController.signal
    });
    clearTimeout(authTimer);

    if (authTestRes.status === 401) {
      if (!cleanToken) {
        return {
          ok: false,
          code: "AUTH_REQUIRED",
          message: "Backend reachable, but API authentication is enabled. Please enter a valid Bearer Token.",
          status: 401
        };
      }
      return {
        ok: false,
        code: "AUTH_INVALID",
        message: "Authentication failed (HTTP 401). The supplied Bearer Token was rejected by the backend.",
        status: 401
      };
    }

    if (authTestRes.status === 403) {
      return {
        ok: false,
        code: "CORS_BLOCKED",
        message: "CORS Forbidden on API routes — Ensure origin is authorized in backend ALLOWED_ORIGINS.",
        status: 403
      };
    }

    if (authTestRes.ok) {
      if (cleanToken) {
        return {
          ok: true,
          code: "AUTH_SUCCESS",
          message: "Backend connected and Bearer Token verified successfully.",
          authVerified: true
        };
      }
      return {
        ok: true,
        code: "REACHABLE",
        message: "Backend connected. (Authentication is disabled on this backend).",
        authVerified: false
      };
    }

    return {
      ok: true,
      code: "REACHABLE_API_STATUS",
      message: `Backend reachable (Health HTTP 200, API returned HTTP ${authTestRes.status}).`,
      status: authTestRes.status
    };
  } catch (err) {
    return {
      ok: false,
      code: "API_CHECK_FAILED",
      message: `Health probe succeeded, but API check failed: ${err.message}`,
      error: err.message
    };
  }
}
