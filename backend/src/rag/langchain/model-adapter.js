/**
 * LangChain Google Model Adapter for TOS Red Flag Scanner (Phase 8B.1).
 *
 * Connects LangChain's recommended ChatGoogle class to the existing Gemini configuration,
 * model settings, and environment variables without exposing sensitive credentials.
 */

import { ChatGoogle } from "@langchain/google";
import { config } from "../../config/env.js";
import { qaAnswerSchema } from "./output-schemas.js";

/**
 * Creates and configures a LangChain ChatGoogle model instance using existing environment configuration.
 *
 * @param {Object} [options={}]
 * @param {string} [options.model] - Model name override (defaults to config.ai.geminiModel or 'gemini-2.5-pro')
 * @param {string} [options.apiKey] - API key override (defaults to config.ai.geminiApiKey / GEMINI_API_KEY)
 * @param {number} [options.temperature=0.1] - Sampling temperature (low temperature for legal analysis)
 * @param {number} [options.maxOutputTokens=800] - Token limit
 * @param {Object} [options.extraConfig={}] - Additional ChatGoogle configuration options
 * @returns {ChatGoogle} Configured ChatGoogle instance
 */
export function createLangChainGoogleModel(options = {}) {
  const model = options.model || config.ai?.geminiModel || "gemini-2.5-pro";
  const apiKey =
    options.apiKey ||
    config.ai?.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  const temperature = options.temperature !== undefined ? options.temperature : 0.1;
  const maxOutputTokens = options.maxOutputTokens !== undefined ? options.maxOutputTokens : 800;

  return new ChatGoogle({
    model,
    apiKey,
    temperature,
    maxOutputTokens,
    ...(options.extraConfig || {})
  });
}

/**
 * Checks whether the Gemini API key is configured without exposing or logging the key itself.
 *
 * @param {Object} [options={}]
 * @returns {boolean} True if an API key is present and non-empty
 */
export function isGeminiConfigured(options = {}) {
  const key =
    options.apiKey !== undefined
      ? options.apiKey
      : (config.ai?.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "");
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Safely inspects model metadata for logging or diagnostics without leaking credentials.
 *
 * @param {ChatGoogle} [modelInstance]
 * @param {Object} [overrideOptions={}]
 * @returns {Object} Safe configuration metadata (never includes actual API key strings)
 */
export function getModelConfigurationInfo(modelInstance = null, overrideOptions = {}) {
  const hasKey = Boolean(
    overrideOptions.apiKey ||
    modelInstance?.apiKey ||
    modelInstance?.params?.apiKey ||
    config.ai?.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );

  const modelName =
    overrideOptions.model ||
    modelInstance?.model ||
    modelInstance?.params?.model ||
    config.ai?.geminiModel ||
    "gemini-2.5-pro";

  const temperature =
    overrideOptions.temperature !== undefined
      ? overrideOptions.temperature
      : (modelInstance?.params?.temperature ?? modelInstance?.lc_kwargs?.temperature ?? 0.1);

  const maxOutputTokens =
    overrideOptions.maxOutputTokens !== undefined
      ? overrideOptions.maxOutputTokens
      : (modelInstance?.params?.maxOutputTokens ?? modelInstance?.lc_kwargs?.maxOutputTokens ?? 800);

  return {
    provider: "google",
    model: modelName,
    temperature,
    maxOutputTokens,
    hasApiKey: hasKey,
    apiKeyConfigured: hasKey
  };
}

/**
 * Creates a ChatGoogle model pre-bound with the Zod-based Q&A structured output schema.
 *
 * @param {Object} [options={}]
 * @returns {any} Runnable with structured output schema attached
 */
export function createStructuredQaModel(options = {}) {
  const model = createLangChainGoogleModel(options);
  return model.withStructuredOutput(qaAnswerSchema);
}
