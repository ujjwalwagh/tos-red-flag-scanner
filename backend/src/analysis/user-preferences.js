/**
 * User Concern Weights & Preferences Layer for TOS Red Flag Scanner (Phase 5).
 *
 * Manages user-configured category priorities (weights 1 to 5),
 * validates custom inputs with safe clamping, and provides deterministic defaults.
 */

import { RISK_CATEGORIES, normalizeCategoryId } from "./risk-categories.js";

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;
export const DEFAULT_WEIGHT = 3;

/**
 * Generates default user preferences populated with each category's defined defaultWeight.
 * @returns {Record<string, number>} Canonical category ID to weight (1-5)
 */
export function getDefaultPreferences() {
  const defaults = {};
  for (const cat of Object.values(RISK_CATEGORIES)) {
    defaults[cat.id] = cat.defaultWeight || DEFAULT_WEIGHT;
  }
  return defaults;
}

/**
 * Validates, normalizes, and sanitizes user concern weights.
 * Accepts category IDs or aliases with numeric weights.
 * Ensures all canonical categories are represented, with values clamped to [1, 5].
 *
 * @param {unknown} input - User preferences object (e.g. { privacy: 5, arbitration: 1 })
 * @returns {Record<string, number>} Canonical category ID to sanitized integer weight
 */
export function validateUserPreferences(input) {
  const preferences = getDefaultPreferences();

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return preferences;
  }

  for (const [key, rawWeight] of Object.entries(input)) {
    const canonicalId = normalizeCategoryId(key);

    const num = Number(rawWeight);
    if (!Number.isFinite(num)) {
      continue;
    }

    // Clamp weight between MIN_WEIGHT and MAX_WEIGHT as integer
    const clamped = Math.round(Math.min(Math.max(num, MIN_WEIGHT), MAX_WEIGHT));
    preferences[canonicalId] = clamped;
  }

  return preferences;
}

/**
 * Retrieves the effective user weight for a given category.
 *
 * @param {Record<string, number>} preferences - Validated user preferences
 * @param {string} categoryIdOrAlias - Category identifier
 * @returns {number} Weight between 1 and 5
 */
export function getCategoryWeight(preferences, categoryIdOrAlias) {
  const canonicalId = normalizeCategoryId(categoryIdOrAlias);
  if (preferences && typeof preferences[canonicalId] === "number") {
    return preferences[canonicalId];
  }
  const category = RISK_CATEGORIES[canonicalId];
  return category?.defaultWeight || DEFAULT_WEIGHT;
}
