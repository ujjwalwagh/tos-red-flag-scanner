import dotenv from "dotenv";

dotenv.config();

/**
 * Validates and parses positive integers with a safe fallback.
 *
 * @param {any} val
 * @param {number} defaultVal
 * @param {number} [min=1]
 * @param {number} [max=300000]
 * @returns {number}
 */
export function parsePositiveInt(val, defaultVal, min = 1, max = 300000) {
  if (val === undefined || val === null || String(val).trim() === "") {
    return defaultVal;
  }
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return defaultVal;
  }
  return n;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  maxPdfBytes: 10 * 1024 * 1024, // 10MB
  trustProxy: process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1"
    ? true
    : (Number.isInteger(Number(process.env.TRUST_PROXY)) && Number(process.env.TRUST_PROXY) > 0
      ? Number(process.env.TRUST_PROXY)
      : false),
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
    heavyAi: {
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_AI_WINDOW_MS, 60 * 1000, 1000, 3600000),
      max: parsePositiveInt(process.env.RATE_LIMIT_AI_MAX, 10, 1, 10000)
    },
    ingestion: {
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_INGESTION_WINDOW_MS, 15 * 60 * 1000, 1000, 3600000),
      max: parsePositiveInt(process.env.RATE_LIMIT_INGESTION_MAX, 25, 1, 10000)
    },
    general: {
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS, 15 * 60 * 1000, 1000, 3600000),
      max: parsePositiveInt(process.env.RATE_LIMIT_GENERAL_MAX, 100, 1, 10000)
    },
    health: {
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_HEALTH_WINDOW_MS, 60 * 1000, 1000, 3600000),
      max: parsePositiveInt(process.env.RATE_LIMIT_HEALTH_MAX, 60, 1, 10000)
    }
  },
  chromeExtension: {
    origin: process.env.CHROME_EXTENSION_ORIGIN || process.env.CHROME_EXTENSION_ORIGINS || ""
  },
  auth: {
    enabled: process.env.ENABLE_API_AUTH === "true",
    token: process.env.API_BEARER_TOKEN || "",
    tokens: (process.env.API_BEARER_TOKENS || process.env.API_BEARER_TOKEN || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  },
  ai: {
    nvidiaApiKey: process.env.NVIDIA_API_KEY || "",
    nvidiaModel: process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct",
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    geminiBaseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    enableGemini: process.env.ENABLE_GEMINI_PROVIDER === "true",
    enableRag: process.env.ENABLE_RAG !== "false",
    enableLangGraphQa: process.env.ENABLE_LANGGRAPH_QA === "true"
  },
  pythonAi: {
    enabled: process.env.ENABLE_PYTHON_AI_SERVICE !== "false",
    baseUrl: process.env.PYTHON_AI_SERVICE_URL || "http://localhost:8000",
    timeoutMs: parsePositiveInt(process.env.PYTHON_AI_SERVICE_TIMEOUT_MS, 5000),
    nliTimeoutMs: parsePositiveInt(process.env.PYTHON_AI_NLI_TIMEOUT_MS, 15000),
    startupTimeoutMs: parsePositiveInt(
      process.env.PYTHON_AI_STARTUP_TIMEOUT_MS || process.env.PYTHON_STARTUP_TIMEOUT_MS,
      60000
    ),
    internalToken: (process.env.INTERNAL_AI_SERVICE_TOKEN || "").trim()
  }
};
