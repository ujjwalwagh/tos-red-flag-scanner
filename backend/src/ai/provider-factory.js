/**
 * AI Provider Factory for TOS Red Flag Scanner (Phase 4).
 *
 * Selects and instantiates the appropriate AI provider based on environment
 * configuration. This is the single location in the codebase that maps
 * environment state to a concrete provider. The rest of the application
 * remains entirely provider-agnostic.
 *
 * Provider resolution order:
 *   1. Explicitly injected provider instance (for testing / DI)
 *   2. NVIDIA NIM   — when NVIDIA_API_KEY is set in the environment
 *   3. NullProvider — when no key is available (graceful degradation)
 *
 * To add a new provider in future, add its condition here and export a
 * new concrete class — no other module needs to change.
 */

import { NvidiaProvider } from "./providers/nvidia-provider.js";
import { GeminiProvider } from "./providers/gemini-provider.js";
import { NullProvider } from "./providers/null-provider.js";

/**
 * Creates the AI provider appropriate for the current runtime environment.
 *
 * @param {Object} [config={}]
 * @param {string} [config.apiKey]          - Explicit API key (for default/active provider)
 * @param {string} [config.provider]        - Explicit provider name ("gemini" | "nvidia" | "null")
 * @param {string} [config.providerName]    - Alias for config.provider
 * @param {boolean} [config.enableGemini]   - Feature flag override for Gemini
 * @param {string} [config.geminiApiKey]    - Explicit Gemini API key
 * @param {string} [config.geminiModel]     - Explicit Gemini model name
 * @param {string} [config.geminiBaseUrl]   - Explicit Gemini base URL
 * @param {string} [config.nvidiaApiKey]    - Explicit NVIDIA API key
 * @param {string} [config.nvidiaModel]     - Explicit NVIDIA model name
 * @param {string} [config.model]           - Generic model name override
 * @param {number} [config.timeout]         - Request timeout (ms)
 * @returns {GeminiProvider|NvidiaProvider|NullProvider}
 */
export function createAiProvider(config = {}) {
  const requestedProvider = String(
    config.providerName || config.provider || process.env.AI_PROVIDER || ""
  ).toLowerCase().trim();

  const isGeminiEnabled =
    config.enableGemini ??
    (process.env.ENABLE_GEMINI_PROVIDER === "true" || requestedProvider === "gemini");

  const geminiKey = (
    config.geminiApiKey ??
    (requestedProvider === "gemini" ? config.apiKey : null) ??
    process.env.GEMINI_API_KEY ??
    ""
  ).trim();

  // 1. Gemini Provider — when explicitly requested or enabled with a valid key
  if (isGeminiEnabled && geminiKey) {
    return new GeminiProvider({
      apiKey: geminiKey,
      model: config.geminiModel || (requestedProvider === "gemini" ? config.model : null) || process.env.GEMINI_MODEL,
      timeout: config.timeout,
      baseUrl: config.geminiBaseUrl || process.env.GEMINI_BASE_URL
    });
  }

  // 2. NVIDIA NIM Provider — when NVIDIA_API_KEY is configured (and Gemini not forced)
  const nvidiaKey = (
    config.nvidiaApiKey ??
    (requestedProvider !== "gemini" ? config.apiKey : null) ??
    process.env.NVIDIA_API_KEY ??
    ""
  ).trim();

  if (nvidiaKey && requestedProvider !== "gemini") {
    return new NvidiaProvider({
      apiKey: nvidiaKey,
      model: config.nvidiaModel || (requestedProvider === "nvidia" ? config.model : null) || process.env.NVIDIA_MODEL,
      timeout: config.timeout
    });
  }

  // 3. NullProvider — graceful fallback when no provider key is available or enabled
  return new NullProvider();
}
