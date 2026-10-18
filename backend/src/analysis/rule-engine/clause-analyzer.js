/**
 * Rule-Based Clause Analyzer for TOS Red Flag Scanner (Phase 3).
 *
 * Deterministically analyzes structured clauses/segments against the legal rule engine.
 * Extracts precise textual evidence, calculates transparent confidence scores,
 * verifies false-positive filters, and preserves source page/clause associations.
 */

import crypto from "node:crypto";
import { RULE_DEFINITIONS } from "./rule-definitions.js";

/**
 * Analyzes a single segment/clause against all defined legal rules.
 *
 * @param {Object} segment - Structured segment from Phase 2
 * @param {number} segment.segmentIndex - Segment position index
 * @param {number} segment.pageNumber - Document page number
 * @param {string} segment.text - Segment text
 * @param {string} [segment.title] - Section heading or title
 * @param {Object} [options={}] - Analysis options
 * @returns {Array<Object>} List of detected red-flag findings
 */
export function analyzeSegment(segment, options = {}) {
  if (!segment || typeof segment.text !== "string" || !segment.text.trim()) {
    return [];
  }

  const segmentText = segment.text;
  const pageNumber = segment.pageNumber || 1;
  const segmentIndex = typeof segment.segmentIndex === "number" ? segment.segmentIndex : 0;
  const findings = [];

  for (const rule of RULE_DEFINITIONS) {
    // 1. Check anti-patterns first (false-positive prevention)
    if (rule.negativePatterns && rule.negativePatterns.some((negPat) => negPat.test(segmentText))) {
      continue;
    }

    // 2. Check primary patterns
    for (const pattern of rule.patterns) {
      const match = pattern.exec(segmentText);
      if (match) {
        // Extract precise evidence sentence around the match
        const evidence = extractEvidenceSnippet(segmentText, match.index, match[0].length);

        // Calculate deterministic confidence
        const confidence = calculateConfidence(rule, segmentText, match);

        let findingTitle = rule.title;
        let findingExplanation = rule.explanation;
        let findingSeverity = rule.severity;

        // Distinguish simple governing-law clause from explicit exclusive court venue
        if (rule.id === "RULE_GOVERNING_LAW") {
          const isVenue = /\b(?:exclusive\s+jurisdiction|resolved\s+exclusively|consent\s+to\s+(?:the\s+)?(?:personal|exclusive)\s+jurisdiction|forum\s+selection)\b/i.test(match[0]);
          if (isVenue) {
            findingTitle = "Exclusive Court Jurisdiction & Venue";
            findingExplanation = "This provision designates exclusive court jurisdiction, which may require you to resolve legal disputes in a specific or distant court venue.";
          } else {
            findingTitle = "Governing Law Specification";
            findingExplanation = "This clause designates the governing state or country law that controls the interpretation of this agreement and any contractual claims.";
          }
        }

        // Distinguish Category A (Optional recurring payment feature), Category B (Standard auto-renewal), and Category C (Restrictive renewal/cancellation deadlines)
        if (rule.id === "RULE_AUTO_RENEWAL") {
          const isOptionalFeature = /\b(?:(?:you|users?|customers?)\s+(?:may|can|have\s+the\s+option\s+to)\s+(?:choose\s+to\s+)?(?:set\s+up|configure|enable|use)|you\s+may\s+choose(?:\s+to)?|can\s+choose(?:\s+to)?|choose\s+to\s+(?:set\s+up|enable)|optionally?|optional|option\s+to|at\s+your\s+(?:choice|discretion|option)|(?:allows?|lets?)\s+(?:users?|you|customers?)\b|user\s+may\s+set\s+up|feature\s+(?:that\s+allows|supported\s+by)|"(?:autopay|recurring\s+payments?)"\s+means|autopay\s+(?:lets?|allows?|feature))\b/i.test(segmentText);
          const hasMandatoryRenewal = /\b(?:(?:will\s+)?automatically\s+renew(?:s)?|renews?\s+automatically|automatic\s+renewal|recurring\s+(?:subscription|billing\s+cycle)|continue\s+to\s+bill\s+.*on\s+a\s+recurring\s+basis)\b/i.test(segmentText);
          const hasCancellationRestrictions = /\b(?:(?:at\s+least\s+)?\d+\s+(?:days?|hours?|weeks?)\s+(?:before|prior\s+to)\s+(?:the\s+)?(?:renewal|end\s+of|expiration\s+of|expiration\s+date|renewal\s+date|billing\s+cycle)|prior\s+to\s+(?:the\s+)?(?:renewal|end\s+of|expiration\s+of|expiration\s+date|renewal\s+date|billing\s+cycle)|before\s+renewal|cancel\s+before\s+(?:(?:the|any|your|a)\s+)?(?:[a-z]+\s+)?(?:deadline|cutoff|renewal|end|billing\s+date)|(?:(?:written\s+)?notice\s+of\s+cancell?ation|cancell?ation\s+notice|cancell?ation)\s+(?:must\s+be\s+received|must\s+be\s+given|is\s+required)|advance\s+notice\s+of\s+cancell?ation|non-refundable\s+(?:upon|after)\s+renewal)\b/i.test(segmentText);

          if (isOptionalFeature && !hasMandatoryRenewal) {
            // Category A: Optional recurring payment feature (e.g. Autopay)
            findingTitle = "Optional Recurring Payment Feature";
            findingSeverity = "LOW";
            findingExplanation = "This clause describes an optional recurring payment feature (such as Autopay) that users may choose to configure, rather than a mandatory automatic subscription renewal.";
          } else if (hasCancellationRestrictions) {
            // Category C: Problematic Renewal / Strict Cancellation Deadlines
            findingTitle = "Automatic Subscription Renewal with Cancellation Restrictions";
            findingSeverity = "HIGH";
            findingExplanation = hasMandatoryRenewal
              ? "This clause states that your subscription will renew automatically and bill your payment method unless you cancel before a specified deadline or advance notice window."
              : "This clause establishes a mandatory cancellation deadline or advance notice requirement prior to contract renewal or term expiration.";
          } else {
            // Category B: Standard Automatic Renewal
            findingTitle = "Automatic Subscription Renewal";
            findingSeverity = "MEDIUM";
            findingExplanation = "This clause indicates that your subscription or service arrangement renews automatically on a recurring billing cycle until cancelled.";
          }
        }

        findings.push({
          findingId: `FINDING_${rule.id}_P${pageNumber}_S${segmentIndex}_${crypto.randomUUID().slice(0, 8)}`,
          ruleId: rule.id,
          categoryId: rule.categoryId,
          category: rule.category,
          title: findingTitle,
          severity: findingSeverity,
          confidence,
          explanation: findingExplanation,
          evidence,
          pageNumber,
          segmentIndex,
          detectionMethod: "rule_based"
        });

        // Break pattern loop to avoid duplicate findings for the same rule in the same segment
        break;
      }
    }
  }

  return findings;
}

/**
 * Extracts a concise, readable evidence sentence surrounding a matched regex position.
 * Avoids dumping entire pages while preserving exact original wording.
 *
 * @param {string} text - Source segment text
 * @param {number} matchIndex - Start index of the match
 * @param {number} matchLength - Length of the match
 * @returns {string} Clean excerpt containing the finding
 */
export function extractEvidenceSnippet(text, matchIndex, matchLength) {
  if (!text) return "";

  // Find sentence start (period, newline, or start of text)
  const beforeMatch = text.slice(0, matchIndex);
  let sentenceStart = Math.max(
    beforeMatch.lastIndexOf(". "),
    beforeMatch.lastIndexOf(".\n"),
    beforeMatch.lastIndexOf("\n\n")
  );

  if (sentenceStart === -1) {
    sentenceStart = 0;
  } else {
    // Move past the punctuation and space
    sentenceStart += 2;
  }

  // Find sentence end
  const afterMatch = text.slice(matchIndex + matchLength);
  let sentenceEndOffset = afterMatch.search(/[.!?](?:\s|$)/);

  let sentenceEnd;
  if (sentenceEndOffset === -1) {
    sentenceEnd = text.length;
  } else {
    sentenceEnd = matchIndex + matchLength + sentenceEndOffset + 1;
  }

  let excerpt = text.slice(sentenceStart, sentenceEnd).trim();

  // If the excerpt is excessively long (> 320 chars), center it around the match
  if (excerpt.length > 320) {
    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(text.length, matchIndex + matchLength + 120);
    excerpt = (start > 0 ? "..." : "") + text.slice(start, end).trim() + (end < text.length ? "..." : "");
  }

  return excerpt;
}

/**
 * Computes deterministic confidence based on rule base confidence,
 * presence of secondary keywords, and pattern match specificity.
 *
 * @param {Object} rule - Rule definition
 * @param {string} text - Segment text
 * @param {RegExpExecArray} match - Regex match result
 * @returns {number} Score between 0.0 and 1.0 (rounded to 2 decimals)
 */
function calculateConfidence(rule, text, match) {
  let score = rule.baseConfidence || 0.85;

  // Boost confidence if secondary keywords are present in the segment
  if (Array.isArray(rule.secondaryKeywords)) {
    const lowerText = text.toLowerCase();
    const matchingKeywords = rule.secondaryKeywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
    if (matchingKeywords.length >= 2) {
      score += 0.04;
    } else if (matchingKeywords.length === 1) {
      score += 0.02;
    }
  }

  // Slight boost if match was exact and long (> 20 characters)
  if (match && match[0].length >= 20) {
    score += 0.02;
  }

  // Cap between 0.50 and 0.99
  return Number(Math.min(Math.max(score, 0.5), 0.99).toFixed(2));
}
