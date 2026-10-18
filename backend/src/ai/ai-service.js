/**
 * AI Analysis Service for TOS Red Flag Scanner (Phase 4).
 *
 * Orchestrates semantic AI clause analysis as a complement to the
 * Phase 3 deterministic rule engine.
 *
 * Responsibilities
 * ────────────────
 * 1. Select the most relevant document segments for AI analysis.
 *    (Prioritises Phase 3 rule-matched segments; fills remaining budget
 *    with keyword-signal segments.)
 * 2. Call the configured provider adapter for each selected segment.
 * 3. Validate and normalise every AI response via response-schema.js.
 * 4. Handle every AI failure mode without crashing or fabricating results.
 * 5. Expose a static combineFindings() method that merges Phase 3 rule
 *    findings and Phase 4 AI findings into a single annotated list.
 *
 * Provider communication
 * ──────────────────────
 * The service communicates with the configured provider through the stable
 * interface: provider.analyzeClause(clauseContext) → ProviderResult.
 * Concrete provider details are fully isolated in the providers/ directory.
 *
 * Failure safety
 * ──────────────
 * If the provider is unavailable for any reason (missing key, timeout,
 * rate-limit, malformed response, network error), the service returns
 * { available: false, reason, findings: [], segmentsAnalyzed: 0 }.
 * The pipeline layer preserves the Phase 3 result unchanged and sets
 * aiAnalysis.available = false in the summary.
 * AI analysis failures NEVER cause the scanner to return an error response.
 */

import crypto from "node:crypto";
import { createAiProvider } from "./provider-factory.js";
import { validateAiClauseAnalysis } from "./response-schema.js";
import { aiClient } from "./ai-client.js";
import { config } from "../config/env.js";

/** Maximum segments sent to AI per document (cost / latency control). */
const DEFAULT_MAX_SEGMENTS = 8;
/** Minimum characters for a segment to be worth analysing. */
const MIN_SEGMENT_CHARS = 60;

/**
 * Lowercase keyword substrings that signal a segment may carry legal risk.
 * Used as a fast heuristic to prioritise segments that lack a rule match.
 */
const RISK_KEYWORDS = [
  "arbitrat", "waive", "class action", "indemnif",
  "licens", "retain", "terminat", "suspend", "liabilit",
  "refund", "renew", "disclos", "govern", "jurisdict",
  "disclaim", "warrant", "modify", "amend",
  "perpetual", "irrevocable", "royalty", "sublicens", "binding"
];

export class AiAnalysisService {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.provider]            - Pre-built provider (overrides factory)
   * @param {number} [options.maxSegmentsToAnalyze] - Per-document segment cap
   * @param {string} [options.apiKey]              - Forwarded to factory when no provider is given
   * @param {string} [options.model]               - Forwarded to factory
   * @param {number} [options.timeout]             - Forwarded to factory
   * @param {Object} [options.aiClient]            - PythonAiClient instance override
   * @param {boolean} [options.enableRag]          - Feature flag override
   * @param {string} [options.documentId]          - Default document ID for vector session
   * @param {number} [options.ragTopK]             - Top K for vector query
   */
  constructor(options = {}) {
    this.provider = options.provider ?? createAiProvider(options);
    this.maxSegmentsToAnalyze = options.maxSegmentsToAnalyze ?? DEFAULT_MAX_SEGMENTS;
    this.aiClient = options.aiClient ?? aiClient;
    this.enableRag = options.enableRag !== undefined
      ? Boolean(options.enableRag)
      : (config?.ai?.enableRag !== undefined ? Boolean(config.ai.enableRag) : true);
    this.documentId = options.documentId || null;
    this.ragTopK = options.ragTopK || 3;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Runs AI semantic analysis across the most relevant document segments.
   *
   * @param {Array<Object>} segments         - Phase 2 clause segments
   * @param {Array<Object>} [ruleFindings=[]] - Phase 3 rule-based findings
   * @param {Object|string} [optionsOrDocId] - Optional documentId or options
   * @returns {Promise<{
   *   available:         boolean,
   *   reason?:           string,
   *   findings:          Array<Object>,
   *   segmentsAnalyzed:  number
   * }>}
   */
  async analyzeSegments(segments, ruleFindings = [], optionsOrDocId = null) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return emptyResult();
    }

    const toAnalyze = this.selectSegmentsForAnalysis(segments, ruleFindings);
    if (toAnalyze.length === 0) {
      return emptyResult();
    }

    // Fast-fail if provider is explicitly NullProvider (no key configured)
    if (this.provider?.name === "null") {
      return {
        available: false,
        reason: "no_api_key_configured",
        findings: [],
        segmentsAnalyzed: 0
      };
    }

    let docId = this.documentId;
    if (typeof optionsOrDocId === "string" && optionsOrDocId.trim()) {
      docId = optionsOrDocId.trim();
    } else if (typeof optionsOrDocId === "object" && optionsOrDocId?.documentId) {
      docId = String(optionsOrDocId.documentId).trim();
    } else if (segments?.[0]?.documentId || segments?.[0]?.document_id) {
      docId = String(segments[0].documentId || segments[0].document_id).trim();
    }

    if (!docId) {
      docId = `doc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    }

    const clausesToIndex = segments
      .map((s, idx) => ({
        clause_id: String(s.clauseId || s.clause_id || `clause_${s.segmentIndex ?? idx}`),
        text: String(s.text || s.rawText || "").trim(),
        category: String(s.clauseCategory || s.category || s.categoryId || "general").trim(),
        section: String(s.section || s.title || "").trim()
      }))
      .filter((c) => c.text.length > 0);

    const ruleMap = buildRuleFindingMap(ruleFindings);

    const executeAnalysisLoop = async (canQueryVectors) => {
      const aiFindings = [];

      for (const segment of toAnalyze) {
        const segmentRules = ruleMap.get(segment.segmentIndex) || [];
        const primaryRule = segmentRules[0] ?? null;

        let retrievedEvidence = [];
        if (canQueryVectors && this.aiClient) {
          try {
            const queryRes = await this.aiClient.queryVectors(
              docId,
              segment.text,
              this.ragTopK
            );
            if (queryRes?.success && Array.isArray(queryRes.results)) {
              retrievedEvidence = queryRes.results;
            }
          } catch {
            // Requirement 6: If vector querying fails, use empty array and continue normally
            retrievedEvidence = [];
          }
        }

        const clauseContext = {
          clauseText: segment.text,
          pageNumber: segment.pageNumber ?? 1,
          segmentIndex: segment.segmentIndex ?? 0,
          existingCategory: primaryRule?.categoryId ?? null,
          existingTitle: primaryRule?.title ?? null,
          existingSeverity: primaryRule?.severity ?? null,
          retrievedEvidence
        };

        let providerResult;
        try {
          providerResult = await this.provider.analyzeClause(clauseContext);
        } catch {
          // Unexpected provider exception — stop AI analysis, preserve Phase 3
          return { available: false, reason: "provider_exception", findings: [], segmentsAnalyzed: 0 };
        }

        // Provider is globally unavailable (no key, auth error, timeout, etc.)
        if (!providerResult.available) {
          return {
            available: false,
            reason: providerResult.reason ?? "provider_unavailable",
            findings: [],
            segmentsAnalyzed: 0
          };
        }

        const validated = validateAiClauseAnalysis(providerResult.data);
        if (!validated.valid) {
          // Skip this segment's AI result — malformed output is not an error
          continue;
        }

        aiFindings.push(
          buildAiFinding(validated.analysis, segment, segmentRules.length > 0)
        );
      }

      return {
        available: true,
        findings: aiFindings,
        segmentsAnalyzed: toAnalyze.length
      };
    };

    const shouldAttemptRag = Boolean(
      this.enableRag &&
      this.aiClient &&
      clausesToIndex.length > 0
    );

    if (shouldAttemptRag) {
      try {
        return await this.aiClient.withDocumentVectors(docId, clausesToIndex, async (indexRes) => {
          const indexingSucceeded = indexRes?.success === true;
          return await executeAnalysisLoop(indexingSucceeded);
        });
      } catch {
        // If withDocumentVectors itself threw unexpectedly, fall back to unaugmented analysis
        return await executeAnalysisLoop(false);
      }
    }

    return await executeAnalysisLoop(false);
  }

  /**
   * Selects segments to send to the AI provider within the configured cap.
   *
   * Priority 1 — segments that already have Phase 3 rule matches
   *   (AI will confirm, refine, or generate plain-English explanations)
   * Priority 2 — segments that contain legal risk signal keywords
   *   (AI may surface findings that Phase 3 rules missed)
   *
   * @param {Array<Object>} segments
   * @param {Array<Object>} ruleFindings
   * @returns {Array<Object>}
   */
  selectSegmentsForAnalysis(segments, ruleFindings) {
    if (!Array.isArray(segments)) return [];

    const ruleSegmentIndices = new Set(
      (Array.isArray(ruleFindings) ? ruleFindings : []).map((f) => f.segmentIndex)
    );

    const eligible = segments.filter(
      (s) => typeof s.text === "string" && s.text.trim().length >= MIN_SEGMENT_CHARS
    );

    const ruleMatched = eligible.filter((s) =>
      ruleSegmentIndices.has(s.segmentIndex)
    );

    const remainingBudget = this.maxSegmentsToAnalyze - ruleMatched.length;
    const keywordOnly = remainingBudget > 0
      ? eligible
          .filter((s) => !ruleSegmentIndices.has(s.segmentIndex) && hasRiskSignals(s.text))
          .slice(0, remainingBudget)
      : [];

    return [...ruleMatched, ...keywordOnly].slice(0, this.maxSegmentsToAnalyze);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static combination helper
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Merges Phase 3 rule findings and Phase 4 AI findings into one annotated
   * list.
   *
   * Combination rules
   * ─────────────────
   * - Every rule finding is marked  ruleDetected: true,  aiDetected: false.
   * - When an AI finding targets the SAME segment AND category as an existing
   *   rule finding, the rule finding is enhanced in-place:
   *     aiDetected: true, detectionMethod: 'rule_and_ai',
   *     aiEnhancement: { plainEnglish, whyItMatters, semanticAssessment, aiConfidence }
   * - When an AI finding has no corresponding rule finding it is appended as
   *   a new entry:
   *     ruleDetected: false, aiDetected: true, detectionMethod: 'ai_semantic'
   *
   * Phase 3 results are ALWAYS preserved regardless of AI outcome.
   *
   * @param {Array<Object>} ruleFindings - Phase 3 results
   * @param {Array<Object>} aiFindings   - Phase 4 results (may be empty)
   * @returns {Array<Object>} Combined, annotated findings
   */
  static combineFindings(ruleFindings, aiFindings) {
    const rules = Array.isArray(ruleFindings) ? ruleFindings : [];
    const ai = Array.isArray(aiFindings) ? aiFindings : [];

    // Base: every rule finding, fully annotated
    const combined = rules.map((f) => ({
      ...f,
      ruleDetected: true,
      aiDetected: false,
      aiEnhancement: null,
      detectionMethod: f.detectionMethod || "rule_based"
    }));

    for (const aiFinding of ai) {
      const idx = combined.findIndex(
        (f) =>
          f.segmentIndex === aiFinding.segmentIndex &&
          f.categoryId === aiFinding.categoryId
      );

      if (idx !== -1) {
        // AI confirmed / enhanced an existing rule finding
        combined[idx] = {
          ...combined[idx],
          aiDetected: true,
          detectionMethod: "rule_and_ai",
          aiEnhancement: {
            plainEnglish: aiFinding.plainEnglish,
            whyItMatters: aiFinding.whyItMatters,
            semanticAssessment: aiFinding.semanticAssessment,
            aiConfidence: aiFinding.confidence
          }
        };
      } else {
        // AI surfaced a new finding not caught by Phase 3
        combined.push({
          ...aiFinding,
          ruleDetected: false,
          aiDetected: true,
          detectionMethod: "ai_semantic"
        });
      }
    }

    return combined;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Constructs a normalised AI finding object from a validated analysis.
 */
function buildAiFinding(analysis, segment, hasRuleMatch) {
  return {
    findingId: `FINDING_AI_${analysis.categoryId}_P${segment.pageNumber ?? 1}_S${segment.segmentIndex ?? 0}_${crypto.randomUUID().slice(0, 8)}`,
    ruleId: null,
    categoryId: analysis.categoryId,
    category: analysis.category,
    title: analysis.title,
    severity: analysis.severity,
    confidence: analysis.confidence,
    explanation: analysis.whyItMatters,
    plainEnglish: analysis.plainEnglish,
    whyItMatters: analysis.whyItMatters,
    semanticAssessment: analysis.semanticAssessment,
    evidence: String(segment.text || "").slice(0, 280),
    pageNumber: segment.pageNumber ?? 1,
    segmentIndex: segment.segmentIndex ?? 0,
    detectionMethod: hasRuleMatch ? "rule_and_ai" : "ai_semantic",
    ruleDetected: hasRuleMatch,
    aiDetected: true,
    aiEnhancement: null
  };
}

/**
 * Builds a Map of segmentIndex → [ruleFindings] for O(1) lookup.
 */
function buildRuleFindingMap(ruleFindings) {
  const map = new Map();
  for (const finding of ruleFindings) {
    const key = finding.segmentIndex ?? 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(finding);
  }
  return map;
}

/**
 * Returns true if the text contains at least one legal risk keyword.
 */
function hasRiskSignals(text) {
  const lower = String(text || "").toLowerCase();
  return RISK_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Standard "nothing to do" result for early-exit paths.
 */
function emptyResult() {
  return { available: true, findings: [], segmentsAnalyzed: 0 };
}
