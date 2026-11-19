/**
 * TOS Red Flag Scanner — Backend Configuration & Validator (Phase 8C.3D)
 *
 * Provides centralized URL validation, secure storage helpers (chrome.storage.local),
 * host permission verification, and multi-stage connection testing.
 */

export const DEFAULT_BACKEND_URL = "http://localhost:3000";
export const STORAGE_KEY_CONFIG = "tos_backend_config";

/**
 * Validates whether a candidate backend URL meets security and protocol constraints.
 *
 * Rules:
 * - Must be a valid URL string.
 * - Supported protocols: HTTP (localhost/loopback only) and HTTPS (remote servers).
 * - Reject plain HTTP for remote hosts to prevent cleartext token transmission.
 * - Reject URLs with embedded credentials (user:pass@host).
 * - Reject unsupported schemes (file:, ftp:, javascript:, ws:, etc.).
 * - Normalize by trimming trailing slashes and default port redundant components.
 *
 * @param {string} urlInput
 * @returns {{ valid: boolean, normalizedUrl?: string, error?: string }}
 */
export function validateBackendUrl(urlInput) {
  if (!urlInput || typeof urlInput !== "string") {
    return { valid: false, error: "Backend URL is required." };
  }

  const trimmed = urlInput.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Backend URL cannot be empty." };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid URL format. Please provide a full URL (e.g. http://localhost:3000 or https://api.example.com)." };
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

  // 4. Normalize: remove trailing slashes from path, preserve non-empty paths
  const cleanPath = (parsed.pathname === "/" ? "" : parsed.pathname).replace(/\/+$/, "");
  const normalizedUrl = `${parsed.origin}${cleanPath}`;

  return {
    valid: true,
    normalizedUrl
  };
}

/**
 * Retrieves the stored backend configuration from chrome.storage.local.
 * Falls back safely to default localhost settings if unconfigured.
 *
 * @returns {Promise<{ backendUrl: string, token: string, isDefault: boolean }>}
 */
export async function getStoredBackendConfig() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return {
      backendUrl: DEFAULT_BACKEND_URL,
      token: "",
      isDefault: true
    };
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_CONFIG], (result) => {
      const stored = result?.[STORAGE_KEY_CONFIG];
      if (!stored || typeof stored !== "object") {
        resolve({
          backendUrl: DEFAULT_BACKEND_URL,
          token: "",
          isDefault: true
        });
        return;
      }

      const valResult = validateBackendUrl(stored.backendUrl);
      const backendUrl = valResult.valid ? valResult.normalizedUrl : DEFAULT_BACKEND_URL;
      const token = typeof stored.token === "string" ? stored.token.trim() : "";

      resolve({
        backendUrl,
        token,
        isDefault: backendUrl === DEFAULT_BACKEND_URL && !token
      });
    });
  });
}

/**
 * Persists backend configuration securely in chrome.storage.local.
 *
 * NEVER uses chrome.storage.sync (prevents token synchronization across unmanaged devices).
 *
 * @param {Object} config
 * @param {string} config.backendUrl
 * @param {string} [config.token]
 * @returns {Promise<{ ok: boolean, config?: Object, error?: string }>}
 */
export async function saveStoredBackendConfig({ backendUrl, token = "" }) {
  const validation = validateBackendUrl(backendUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const cleanToken = typeof token === "string" ? token.trim() : "";
  const payloadToStore = {
    backendUrl: validation.normalizedUrl,
    token: cleanToken,
    updatedAt: new Date().toISOString()
  };

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return {
      ok: true,
      config: {
        backendUrl: validation.normalizedUrl,
        hasToken: cleanToken.length > 0
      }
    };
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: payloadToStore }, () => {
      if (chrome.runtime?.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({
          ok: true,
          config: {
            backendUrl: validation.normalizedUrl,
            hasToken: cleanToken.length > 0
          }
        });
      }
    });
  });
}

/**
 * Resets backend configuration back to the default localhost configuration.
 * Clears stored Bearer tokens from chrome.storage.local.
 *
 * @returns {Promise<{ ok: boolean }>}
 */
export async function resetStoredBackendConfig() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { ok: true };
  }

  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY_CONFIG], () => {
      resolve({ ok: true });
    });
  });
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
    backendUrl: cfg?.backendUrl || DEFAULT_BACKEND_URL,
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
 * Verifies or requests runtime host permission for remote backends via chrome.permissions.
 *
 * Localhost backends (http://localhost:3000/*) are statically granted in manifest.json.
 * Remote HTTPS backends require runtime consent.
 *
 * @param {string} backendUrl
 * @param {boolean} [interactive=true] - Whether to prompt the user if permission is missing
 * @returns {Promise<{ granted: boolean, isLocalhost: boolean, error?: string }>}
 */
export async function checkOrRequestBackendHostPermission(backendUrl, interactive = true) {
  if (typeof chrome === "undefined" || !chrome.permissions) {
    return { granted: true, isLocalhost: true };
  }

  const validation = validateBackendUrl(backendUrl);
  if (!validation.valid) {
    return { granted: false, isLocalhost: false, error: validation.error };
  }

  const parsed = new URL(validation.normalizedUrl);
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost");

  // Localhost is already granted statically in manifest.json host_permissions
  if (isLoopback) {
    return { granted: true, isLocalhost: true };
  }

  const originPattern = `${parsed.origin}/*`;

  const alreadyGranted = await new Promise((resolve) => {
    chrome.permissions.contains({ origins: [originPattern] }, (res) => resolve(Boolean(res)));
  });

  if (alreadyGranted) {
    return { granted: true, isLocalhost: false };
  }

  if (!interactive) {
    return {
      granted: false,
      isLocalhost: false,
      error: `Host permission for remote origin '${parsed.origin}' has not been granted.`
    };
  }

  const granted = await new Promise((resolve) => {
    chrome.permissions.request({ origins: [originPattern] }, (res) => {
      resolve(Boolean(res));
    });
  });

  return {
    granted,
    isLocalhost: false,
    error: granted ? undefined : `Host permission request for '${parsed.origin}' was declined.`
  };
}

/**
 * Multi-stage connection test sequence.
 *
 * Sequence:
 * 1. Validate URL syntax and protocol.
 * 2. Check/request host permission for remote backends.
 * 3. Query GET /health for server reachability and CORS.
 * 4. Query GET /api/analyze/categories to test Bearer Token authentication.
 *
 * Distinguishes:
 * - REACHABLE: Server online, auth optional / disabled.
 * - AUTH_SUCCESS: Server online and Bearer token successfully verified.
 * - AUTH_REQUIRED: Server online, but backend requires a Bearer token (HTTP 401).
 * - AUTH_INVALID: Server online, but the supplied token was rejected (HTTP 401).
 * - CORS_BLOCKED: Backend returned HTTP 403 (extension origin missing from backend CORS).
 * - PERMISSION_DENIED: User declined host permission.
 * - NETWORK_ERROR: Backend unreachable or offline.
 *
 * @param {Object} options
 * @param {string} options.backendUrl
 * @param {string} [options.token]
 * @param {boolean} [options.requestPermission=true]
 * @returns {Promise<Object>}
 */
export async function testBackendConnection({ backendUrl, token = "", requestPermission = true }) {
  // 1. Validate configured URL
  const validation = validateBackendUrl(backendUrl);
  if (!validation.valid) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: validation.error,
      error: validation.error
    };
  }
  const targetUrl = validation.normalizedUrl;

  // 2. Check host permission
  if (typeof chrome !== "undefined" && chrome.permissions) {
    const permResult = await checkOrRequestBackendHostPermission(targetUrl, requestPermission);
    if (!permResult.granted) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message: permResult.error || "Permission to connect to the specified backend was denied.",
        error: permResult.error
      };
    }
  }

  // 3. Query GET /health (unauthenticated reachability probe)
  const healthController = new AbortController();
  const healthTimer = setTimeout(() => healthController.abort(), 4000);
  let healthRes;

  try {
    healthRes = await fetch(`${targetUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error", // Prevent credential forwarding on redirects
      signal: healthController.signal
    });
  } catch (err) {
    clearTimeout(healthTimer);
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: isTimeout
        ? `Connection to backend at ${targetUrl} timed out.`
        : `Cannot reach backend at ${targetUrl} (${err.message || "Network offline"}).`,
      error: err.message || "Network error"
    };
  }
  clearTimeout(healthTimer);

  if (!healthRes.ok) {
    if (healthRes.status === 403) {
      return {
        ok: false,
        code: "CORS_BLOCKED",
        message: "CORS Forbidden — Add this extension's origin to backend CHROME_EXTENSION_ORIGIN in .env.",
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

  const healthData = await healthRes.json().catch(() => ({ status: "ok" }));

  // 4. Query GET /api/analyze/categories (lightweight read-only endpoint under /api to test auth)
  const cleanToken = typeof token === "string" ? token.trim() : "";
  const authController = new AbortController();
  const authTimer = setTimeout(() => authController.abort(), 5000);

  const authHeaders = { Accept: "application/json" };
  if (cleanToken) {
    authHeaders["Authorization"] = `Bearer ${cleanToken}`;
  }

  try {
    const authTestRes = await fetch(`${targetUrl}/api/analyze/categories`, {
      method: "GET",
      headers: authHeaders,
      redirect: "error", // Guard against auth token forwarding on redirects
      signal: authController.signal
    });
    clearTimeout(authTimer);

    if (authTestRes.status === 401) {
      if (!cleanToken) {
        return {
          ok: false,
          code: "AUTH_REQUIRED",
          message: "Backend reachable, but API authentication is enabled. Please enter a valid Bearer Token.",
          healthOk: true,
          status: 401
        };
      }
      return {
        ok: false,
        code: "AUTH_INVALID",
        message: "Authentication failed (HTTP 401). The supplied Bearer Token was rejected by the backend.",
        healthOk: true,
        status: 401
      };
    }

    if (authTestRes.status === 403) {
      return {
        ok: false,
        code: "CORS_BLOCKED",
        message: "CORS Forbidden on API routes — Ensure extension origin is authorized on backend.",
        healthOk: true,
        status: 403
      };
    }

    if (authTestRes.ok) {
      if (cleanToken) {
        return {
          ok: true,
          code: "AUTH_SUCCESS",
          message: "Backend connected and Bearer Token verified successfully.",
          healthOk: true,
          authVerified: true,
          timestamp: healthData.timestamp
        };
      }
      return {
        ok: true,
        code: "REACHABLE",
        message: "Backend connected. (Authentication is disabled on this backend).",
        healthOk: true,
        authVerified: false,
        timestamp: healthData.timestamp
      };
    }

    return {
      ok: true,
      code: "REACHABLE_API_STATUS",
      message: `Backend reachable (Health HTTP 200, API returned HTTP ${authTestRes.status}).`,
      healthOk: true,
      status: authTestRes.status
    };
  } catch (err) {
    clearTimeout(authTimer);
    return {
      ok: false,
      code: "API_CHECK_FAILED",
      message: `Health probe succeeded, but API check failed: ${err.message}`,
      healthOk: true,
      error: err.message
    };
  }
}
