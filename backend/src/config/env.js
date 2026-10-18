import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  maxPdfBytes: 10 * 1024 * 1024, // 10MB
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  },
  ai: {
    nvidiaApiKey: process.env.NVIDIA_API_KEY || "",
    nvidiaModel: process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct",
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    geminiBaseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    enableGemini: process.env.ENABLE_GEMINI_PROVIDER === "true",
    enableRag: process.env.ENABLE_RAG !== "false"
  },
  pythonAi: {
    enabled: process.env.ENABLE_PYTHON_AI_SERVICE !== "false",
    baseUrl: process.env.PYTHON_AI_SERVICE_URL || "http://localhost:8000",
    timeoutMs: Number(process.env.PYTHON_AI_SERVICE_TIMEOUT_MS || 5000)
  }
};
