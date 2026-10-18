/**
 * Impact Evaluator & Plain-English Explanations for TOS Red Flag Scanner (Phase 5).
 *
 * Translates technical clause findings into consumer-friendly risk magnitudes
 * ("Critical", "High", "Medium", "Low") and transparent plain-English guidance.
 */

import { getRiskCategory } from "./risk-categories.js";

export const IMPACT_LEVELS = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low"
};

/**
 * Calculates human-facing Impact Magnitude based on rule severity,
 * detection confidence, and personalized user concern weight.
 *
 * @param {Object} finding - Clause finding object
 * @param {number} userWeight - User concern weight (1 to 5)
 * @returns {string} One of "Critical" | "High" | "Medium" | "Low"
 */
export function calculateImpactMagnitude(finding, userWeight = 3) {
  const baseSeverity = String(finding?.severity || "INFO").toUpperCase();
  const confidence = typeof finding?.confidence === "number" ? finding.confidence : 0.85;

  const isOptionalPayment =
    finding?.title === "Optional Recurring Payment Feature" ||
    /\boptional\s+recurring\s+payment\b/i.test(finding?.title || "");

  // An Optional Recurring Payment Feature with LOW severity represents voluntary user configuration;
  // under default preferences (userWeight <= 4), its human-facing impact magnitude is Low.
  // An explicitly configured maximum user concern (weight >= 5) elevates it, capped at Medium.
  if (isOptionalPayment && baseSeverity === "LOW") {
    if (userWeight >= 5) {
      return IMPACT_LEVELS.MEDIUM;
    }
    return IMPACT_LEVELS.LOW;
  }

  // Base numerical value for severity
  const severityPoints = {
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1
  }[baseSeverity] || 1;

  // Combined score: severity (1-4) * userWeight (1-5) * confidence factor (0.8 - 1.0)
  const confidenceFactor = 0.8 + (Math.min(Math.max(confidence, 0), 1) * 0.2);
  const compositeScore = severityPoints * userWeight * confidenceFactor;

  // Composite scale: (1 * 1 * 0.8 = 0.8) to (4 * 5 * 1.0 = 20.0)
  if (compositeScore >= 16) {
    return IMPACT_LEVELS.CRITICAL;
  }
  if (compositeScore >= 11) {
    return IMPACT_LEVELS.HIGH;
  }
  if (compositeScore >= 6) {
    return IMPACT_LEVELS.MEDIUM;
  }
  return IMPACT_LEVELS.LOW;
}

/**
 * Generates transparent, multi-dimensional plain-English guidance for a flagged clause.
 * Answers:
 * 1. What does this clause say?
 * 2. Why was it flagged?
 * 3. What category does it belong to?
 * 4. Why might it matter to the user?
 * 5. What should the user pay attention to?
 *
 * Strictly preserves the original evidence clause excerpt.
 *
 * @param {Object} finding - Raw or AI-enriched finding
 * @param {Object} [categoryMeta] - Category metadata
 * @returns {Object} Structured plain-English explanation
 */
export function generatePlainEnglishExplanation(finding, categoryMeta) {
  const category = categoryMeta || getRiskCategory(finding.categoryId || finding.category);
  const evidence = finding.evidence || "Original clause excerpt not available.";

  // Determine core summary and risk reason
  const coreExplanation = finding.explanation || finding.plainEnglish || category.description;
  const whyItMatters = finding.whyItMatters || category.description;
  const whatToWatchFor = category.whatToWatchFor || "Review dispute and cancellation terms carefully before accepting.";

  const whatItSays = finding.plainEnglish
    ? finding.plainEnglish
    : `This clause establishes terms under ${category.displayName}. Specifically: "${cleanExcerpt(evidence)}"`;

  const whyFlagged = `Flagged for potential consumer risk regarding ${category.displayName}. ${finding.title || "Restricted contractual rights"}.`;

  return {
    summary: coreExplanation,
    whatItSays,
    whyFlagged,
    category: category.displayName,
    impactDomain: category.impactDomain,
    whyItMatters,
    whatToWatchFor,
    originalEvidence: evidence
  };
}

function cleanExcerpt(text, maxChars = 200) {
  if (typeof text !== "string") return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars) + "...";
}
