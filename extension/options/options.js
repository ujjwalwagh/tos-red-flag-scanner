/**
 * TOS Red Flag Scanner — Options Page Controller (Phase 8C.3D)
 *
 * Manages user-configured backend URLs and Bearer Tokens with secure storage,
 * host permission prompts, and multi-stage connection testing.
 */

import {
  DEFAULT_BACKEND_URL,
  validateBackendUrl,
  getStoredBackendConfig,
  saveStoredBackendConfig,
  resetStoredBackendConfig,
  testBackendConnection
} from "../utils/backend-config.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Elements: Form Inputs
  const inputBackendUrlEl = document.getElementById("input-backend-url");
  const inputBearerTokenEl = document.getElementById("input-bearer-token");
  const btnToggleTokenEl = document.getElementById("btn-toggle-token");
  const toggleTokenIconEl = document.getElementById("toggle-token-icon");

  // Elements: Actions
  const btnSaveEl = document.getElementById("btn-save");
  const btnSaveTextEl = document.getElementById("btn-save-text");
  const btnTestEl = document.getElementById("btn-test");
  const btnTestTextEl = document.getElementById("btn-test-text");
  const btnResetEl = document.getElementById("btn-reset");

  // Elements: Status
  const statusCardEl = document.getElementById("status-card");
  const statusBadgeEl = document.getElementById("status-badge");
  const statusTimestampEl = document.getElementById("status-timestamp");
  const statusHeadlineEl = document.getElementById("status-headline");
  const statusDetailsEl = document.getElementById("status-details");

  // Elements: Origin Box
  const extensionOriginCodeEl = document.getElementById("extension-origin-code");
  const btnCopyOriginEl = document.getElementById("btn-copy-origin");

  // 1. Display Extension Origin for CORS configuration
  const extensionId = typeof chrome !== "undefined" && chrome.runtime?.id ? chrome.runtime.id : "your-extension-id";
  const extensionOrigin = `chrome-extension://${extensionId}`;
  if (extensionOriginCodeEl) {
    extensionOriginCodeEl.textContent = extensionOrigin;
  }

  // 2. Load Stored Configuration
  try {
    const config = await getStoredBackendConfig();
    inputBackendUrlEl.value = config.backendUrl || DEFAULT_BACKEND_URL;
    inputBearerTokenEl.value = config.token || "";
  } catch (err) {
    inputBackendUrlEl.value = DEFAULT_BACKEND_URL;
    inputBearerTokenEl.value = "";
    showStatus("error", "Storage Error", `Failed to load saved settings: ${err.message}`);
  }

  // 3. Toggle Token Visibility
  let tokenVisible = false;
  btnToggleTokenEl?.addEventListener("click", () => {
    tokenVisible = !tokenVisible;
    inputBearerTokenEl.type = tokenVisible ? "text" : "password";
    toggleTokenIconEl.textContent = tokenVisible ? "🙈" : "👁";
  });

  // 4. Save Configuration
  btnSaveEl?.addEventListener("click", async () => {
    const rawUrl = inputBackendUrlEl.value;
    const rawToken = inputBearerTokenEl.value;

    const validation = validateBackendUrl(rawUrl);
    if (!validation.valid) {
      showStatus("error", "Invalid URL", validation.error);
      inputBackendUrlEl.focus();
      return;
    }

    setButtonLoading(btnSaveEl, btnSaveTextEl, true, "Saving...");
    try {
      const result = await saveStoredBackendConfig({
        backendUrl: validation.normalizedUrl,
        token: rawToken
      });

      if (!result.ok) {
        showStatus("error", "Save Failed", result.error || "Could not write to storage.");
        return;
      }

      inputBackendUrlEl.value = validation.normalizedUrl;
      const tokenNote = rawToken.trim() ? "Bearer Token saved securely." : "No Bearer Token configured.";
      showStatus(
        "success",
        "Configuration Saved",
        `Backend set to: ${validation.normalizedUrl}. ${tokenNote}`
      );
    } catch (err) {
      showStatus("error", "Save Error", err.message);
    } finally {
      setButtonLoading(btnSaveEl, btnSaveTextEl, false, "Save Configuration");
    }
  });

  // 5. Test Connection
  btnTestEl?.addEventListener("click", async () => {
    const rawUrl = inputBackendUrlEl.value;
    const rawToken = inputBearerTokenEl.value;

    const validation = validateBackendUrl(rawUrl);
    if (!validation.valid) {
      showStatus("error", "Invalid URL", validation.error);
      inputBackendUrlEl.focus();
      return;
    }

    setButtonLoading(btnTestEl, btnTestTextEl, true, "Testing...");
    showStatus("checking", "Testing Connection", `Probing backend at ${validation.normalizedUrl}...`);

    try {
      const res = await testBackendConnection({
        backendUrl: validation.normalizedUrl,
        token: rawToken,
        requestPermission: true
      });

      renderTestResult(res, validation.normalizedUrl);
    } catch (err) {
      showStatus("error", "Test Failed", `Connection test encountered an error: ${err.message}`);
    } finally {
      setButtonLoading(btnTestEl, btnTestTextEl, false, "Test Connection");
    }
  });

  // 6. Reset Configuration
  btnResetEl?.addEventListener("click", async () => {
    const confirmed = window.confirm("Reset backend settings back to default (http://localhost:3000)? Stored tokens will be cleared.");
    if (!confirmed) return;

    try {
      await resetStoredBackendConfig();
      inputBackendUrlEl.value = DEFAULT_BACKEND_URL;
      inputBearerTokenEl.value = "";
      showStatus(
        "success",
        "Settings Reset",
        `Backend restored to default (${DEFAULT_BACKEND_URL}). Stored token was cleared.`
      );
    } catch (err) {
      showStatus("error", "Reset Error", err.message);
    }
  });

  // 7. Copy Extension Origin Button
  btnCopyOriginEl?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(extensionOrigin);
      const originalText = btnCopyOriginEl.textContent;
      btnCopyOriginEl.textContent = "Copied!";
      setTimeout(() => {
        btnCopyOriginEl.textContent = originalText;
      }, 2000);
    } catch {
      // Fallback
      window.prompt("Copy your extension origin:", extensionOrigin);
    }
  });

  // Helpers
  function showStatus(type, headline, details) {
    statusCardEl.className = `card status-card status-${type}`;
    statusCardEl.classList.remove("hidden");

    statusBadgeEl.textContent = type.toUpperCase();
    statusHeadlineEl.textContent = headline;
    statusDetailsEl.textContent = details;
    statusTimestampEl.textContent = new Date().toLocaleTimeString();

    statusCardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderTestResult(res, url) {
    if (res.code === "AUTH_SUCCESS") {
      showStatus(
        "success",
        "Connection & Authentication Successful",
        `Backend at ${url} is online and the Bearer Token was verified successfully against protected API endpoints.`
      );
      return;
    }

    if (res.code === "REACHABLE") {
      showStatus(
        "success",
        "Backend Connected (Authentication Disabled)",
        `Backend at ${url} is online and operational. API authentication is currently disabled on this backend instance.`
      );
      return;
    }

    if (res.code === "AUTH_REQUIRED") {
      showStatus(
        "warning",
        "Authentication Required (HTTP 401)",
        `Backend at ${url} is online, but API authentication is enabled. Please enter a valid Bearer Token above and save.`
      );
      return;
    }

    if (res.code === "AUTH_INVALID") {
      showStatus(
        "error",
        "Authentication Failed (HTTP 401)",
        `Backend at ${url} rejected the supplied Bearer Token. Please verify that your token matches the backend's API_BEARER_TOKEN(S) configuration.`
      );
      return;
    }

    if (res.code === "CORS_BLOCKED") {
      showStatus(
        "error",
        "CORS Origin Not Allowed (HTTP 403)",
        `Backend refused connection from origin '${extensionOrigin}'. Please add this origin to CHROME_EXTENSION_ORIGIN in your backend's .env file and restart the server.`
      );
      return;
    }

    if (res.code === "PERMISSION_DENIED") {
      showStatus(
        "warning",
        "Host Permission Denied",
        res.message || "Chrome permission to access the remote server was declined."
      );
      return;
    }

    // Default error / network offline
    showStatus(
      "error",
      "Connection Failed",
      res.message || `Unable to reach backend at ${url}. Please verify that the server is running and accessible.`
    );
  }

  function setButtonLoading(button, textElement, isLoading, text) {
    if (!button) return;
    button.disabled = isLoading;
    if (textElement) {
      textElement.textContent = text;
    }
  }
});
