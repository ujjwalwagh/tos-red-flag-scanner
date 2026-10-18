/**
 * NVIDIA NIM AI Provider Adapter for TOS Red Flag Scanner (Phase 4).
 *
 * Sends structured clause context to the NVIDIA NIM inference endpoint
 * and returns the raw model output for validation by the AI service layer.
 *
 * All NVIDIA-specific API details (endpoint URL, auth header format, model
 * name, error classification) are isolated here. The rest of the application
 * interacts only with the stable provider interface:
 *
 *   analyzeClause(clauseContext) → Promise<ProviderResult>
 *
 * ProviderResult:
 *   { available: true,  data: rawParsedObject }
 *   { available: false, reason: string        }
 */

import axios from "axios";
import { safeParseAiJson } from "../response-schema.js";

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "meta/llama-4-maverick-17b-128e-instruct";
const DEFAULT_TIMEOUT_MS = 25_000;
/** Characters of clause text sent per request (prevents runaway token usage). */
const MAX_CLAUSE_CHARS = 1_200;

export class NvidiaProvider {
  /**
   * @param {Object} [options={}]
   * @param {string} options.apiKey      - NVIDIA NIM API key (required for real calls)
   * @param {string} [options.model]     - Model identifier override
   * @param {number} [options.timeout]   - Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.name = "nvidia";
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_MODEL;
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Analyzes a single clause using NVIDIA NIM.
   *
   * @param {Object} clauseContext
   * @param {string}  clauseContext.clauseText        - Text of the clause to analyze
   * @param {string|null} [clauseContext.existingCategory]  - Phase 3 categoryId if matched
   * @param {string|null} [clauseContext.existingSeverity]  - Phase 3 severity if matched
   * @param {string|null} [clauseContext.existingTitle]     - Phase 3 rule title if matched
   * @returns {Promise<{ available: boolean, reason?: string, data?: Object }>}
   */
  async analyzeClause(clauseContext) {
    if (!this.apiKey) {
      return { available: false, reason: "no_api_key_configured" };
    }

    const prompt = clauseContext.customPrompt || buildPrompt(clauseContext);

    let response;
    try {
      response = await axios.post(
        NVIDIA_API_URL,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                "You are a legal clause risk analyst. Return strict JSON only. " +
                "Never include markdown fences. Never provide legal advice."
            },
            { role: "user", content: prompt }
          ],
          max_tokens: 450,
          temperature: 0.15,
          top_p: 1.0,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json"
          },
          timeout: this.timeout
        }
      );
    } catch (error) {
      return { available: false, reason: classifyNetworkError(error) };
    }

    const rawContent = response?.data?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      return { available: false, reason: "empty_model_response" };
    }

    const parsed = safeParseAiJson(rawContent);
    if (!parsed) {
      return { available: false, reason: "malformed_model_response" };
    }

    return { available: true, data: parsed };
  }
}

/**
 * Builds a focused, token-efficient analysis prompt for a single clause.
 * Includes Phase 3 context when available so the model can confirm or refine.
 */
function buildPrompt(ctx) {
  const clauseText = String(ctx.clauseText || "").slice(0, MAX_CLAUSE_CHARS);

  const contextLine = ctx.existingCategory
    ? `Rule-based analysis flagged this as "${ctx.existingTitle}" ` +
      `(${ctx.existingCategory}, ${ctx.existingSeverity}). ` +
      `Provide semantic confirmation or correction.`
    : "No rule-based match. Analyze independently for potential user risk.";

  return `Analyze this Terms of Service clause for potential user risk.

Clause:
"""
${clauseText}
"""

Context: ${contextLine}

Return ONLY a JSON object (no markdown, no explanation):
{
  "categoryId": "one of: ARBITRATION, USER_CONTENT_RIGHTS, AUTO_RENEWAL, DATA_RETENTION, ACCOUNT_CONTROL, TERMINATION_RIGHTS, LIABILITY_LIMITATIONS, INDEMNIFICATION, PRIVACY_DATA_SHARING, GOVERNING_LAW, UNILATERAL_CHANGES, DISPUTE_RESOLUTION, CONTENT_LICENSE, REFUND_RESTRICTIONS, GENERAL_RISK, OTHER",
  "category": "human-readable category name",
  "title": "brief risk title (max 80 chars)",
  "severity": "HIGH or MEDIUM or LOW or INFO",
  "semanticAssessment": "one sentence: what does this clause do legally",
  "plainEnglish": "plain-language meaning for a non-lawyer (max 200 chars)",
  "whyItMatters": "why this may be concerning for the user (max 200 chars)",
  "confidence": 0.0-1.0
}

Rules:
- If this is harmless standard boilerplate, use severity INFO and confidence <= 0.3.
- Provide informational analysis only — never legal advice.
- Output JSON only.`;
}

/**
 * Maps axios / network error objects to machine-readable reason strings.
 */
function classifyNetworkError(error) {
  if (!error) return "unknown_error";
  const status = error?.response?.status;
  const code = error?.code;

  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_server_error";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return "timeout";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") return "network_error";
  return "provider_error";
}
