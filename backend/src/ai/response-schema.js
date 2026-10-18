/**
 * AI Response Schema Validator for TOS Red Flag Scanner (Phase 4).
 *
 * Validates and normalises raw AI provider JSON responses into a stable
 * internal structure. Isolates the rest of the application from malformed,
 * partial, or unexpected model output.
 *
 * All AI provider adapters return raw JSON; this module is the single
 * place where that output is trusted, validated, and normalised.
 */

const VALID_SEVERITIES = new Set(["HIGH", "MEDIUM", "LOW", "INFO"]);

/**
 * All recognised category IDs (matches Phase 3 rule definitions + extras).
 * Unknown values from the model are mapped to "OTHER".
 */
export const KNOWN_CATEGORY_IDS = new Set([
  "ARBITRATION",
  "USER_CONTENT_RIGHTS",
  "AUTO_RENEWAL",
  "DATA_RETENTION",
  "ACCOUNT_CONTROL",
  "TERMINATION_RIGHTS",
  "LIABILITY_LIMITATIONS",
  "INDEMNIFICATION",
  "PRIVACY_DATA_SHARING",
  "GOVERNING_LAW",
  "UNILATERAL_CHANGES",
  "DISPUTE_RESOLUTION",
  "CONTENT_LICENSE",
  "REFUND_RESTRICTIONS",
  "GENERAL_RISK",
  "OTHER"
]);

/**
 * Validates and normalises a raw AI clause analysis object.
 *
 * @param {unknown} raw - JSON-parsed object from the AI provider
 * @returns {{ valid: true, analysis: Object } | { valid: false, reason: string }}
 */
export function validateAiClauseAnalysis(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, reason: "response_not_object" };
  }

  // plainEnglish — required
  const plainEnglish = sanitizeText(raw.plainEnglish, 400);
  if (!plainEnglish) {
    return { valid: false, reason: "missing_plain_english" };
  }

  // whyItMatters — required
  const whyItMatters = sanitizeText(raw.whyItMatters, 400);
  if (!whyItMatters) {
    return { valid: false, reason: "missing_why_it_matters" };
  }

  // severity — normalise; default to INFO if unrecognised
  const rawSeverity = String(raw.severity || "").trim().toUpperCase();
  const severity = VALID_SEVERITIES.has(rawSeverity) ? rawSeverity : "INFO";

  // confidence — clamp to [0.0, 1.0]
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Number(Math.min(Math.max(confidence, 0.0), 1.0).toFixed(2));

  // categoryId — normalise to known set or "OTHER"
  const rawCategoryId = String(raw.categoryId || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const categoryId = KNOWN_CATEGORY_IDS.has(rawCategoryId) ? rawCategoryId : "OTHER";

  // category label — fall back to categoryId if missing
  const category = sanitizeText(raw.category, 120) || categoryId;

  // title — optional but useful
  const title = sanitizeText(raw.title, 120) || "AI-Detected Risk";

  // semanticAssessment — optional
  const semanticAssessment = sanitizeText(raw.semanticAssessment, 500) || "";

  return {
    valid: true,
    analysis: {
      categoryId,
      category,
      title,
      severity,
      confidence,
      plainEnglish,
      whyItMatters,
      semanticAssessment
    }
  };
}

/**
 * Safely parses a raw string as JSON.
 * Handles the common case where a model wraps output in markdown fences.
 *
 * @param {string} raw - Raw string returned by the AI provider
 * @returns {Object|null} Parsed object, or null if parsing fails
 */
export function safeParseAiJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();

  // 1. Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }

  // 2. Strip markdown code fences and retry
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    /* continue */
  }

  // 3. Extract first {...} block
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Collapses whitespace and trims a value to a string within maxLength.
 */
function sanitizeText(value, maxLength = 320) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
