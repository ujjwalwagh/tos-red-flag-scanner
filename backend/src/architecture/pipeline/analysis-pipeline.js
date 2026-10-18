/**
 * Analysis Pipeline & Orchestrator for TOS Red Flag Scanner (Phase 3 & Phase 4).
 *
 * Coordinates deterministic rule-based analysis across document segments.
 * Provides a clean architecture decoupling the deterministic RuleAnalyzer
 * from AI/LLM analyzers.
 */

import { analyzeSegment } from "../../analysis/rule-engine/clause-analyzer.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";
import { SEVERITY_LEVELS } from "../../analysis/rule-engine/rule-definitions.js";
import { AiAnalysisService } from "../../ai/ai-service.js";
import { rankFindings, computePersonalizedSummary } from "../../analysis/personalized-ranker.js";
import { generateActionChecklist } from "../../remediation/checklist-generator.js";
import { evaluateDocumentBenchmark } from "../../benchmarks/benchmark-engine.js";
import { auditStatutoryCompliance } from "../../compliance/statutory-auditor.js";

/**
 * Deterministic Rule-Based Analyzer.
 * Evaluates document clauses locally and offline without external dependencies.
 */
export class RuleAnalyzer {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Analyzes an array of document segments.
   * @param {Array<Object>} segments
   * @returns {Array<Object>}
   */
  analyzeSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return [];
    }

    const allFindings = [];
    for (const segment of segments) {
      const findings = analyzeSegment(segment, this.options);
      allFindings.push(...findings);
    }

    return deduplicateFindings(allFindings);
  }
}

/**
 * Deduplicates findings that represent the same underlying contractual provision
 * (e.g. definitions vs substantive clauses, or redundant matches across segments),
 * while preserving distinct findings when they represent materially different provisions.
 *
 * @param {Array<Object>} findings - Raw list of findings
 * @returns {Array<Object>} Deduplicated findings
 */
export function deduplicateFindings(findings = []) {
  if (!Array.isArray(findings) || findings.length <= 1) {
    return findings;
  }

  const result = [];
  for (const finding of findings) {
    // 1. Multiple substantive findings titled "Optional Recurring Payment Feature"
    // that describe the same underlying Autopay feature are collapsed into one representative finding.
    if (finding.title === "Optional Recurring Payment Feature") {
      const existingOptIndex = result.findIndex(
        (f) =>
          f.title === "Optional Recurring Payment Feature" &&
          (f.categoryId === finding.categoryId || f.ruleId === finding.ruleId) &&
          (/\bautopay\b/i.test(f.evidence || "") ||
            /\bautopay\b/i.test(finding.evidence || "") ||
            f.categoryId === "AUTO_RENEWAL")
      );

      if (existingOptIndex !== -1) {
        const existing = result[existingOptIndex];
        // Preserve the strongest relevant evidence; prefer substantive clause over glossary definition
        if (scoreEvidenceStrength(finding) > scoreEvidenceStrength(existing)) {
          result[existingOptIndex] = finding;
        }
        continue;
      }
    }

    // 2. General deduplication for other findings
    const isDef = isDefinitionExcerpt(finding.evidence || "");
    const existingIndex = result.findIndex(
      (f) =>
        (f.ruleId === finding.ruleId && f.title === finding.title) ||
        (f.categoryId === finding.categoryId && f.title === finding.title)
    );

    if (existingIndex !== -1) {
      const existing = result[existingIndex];
      const existingIsDef = isDefinitionExcerpt(existing.evidence || "");

      // 1. If existing was a definition and current finding is a substantive clause, replace definition with substantive clause
      if (existingIsDef && !isDef) {
        result[existingIndex] = finding;
        continue;
      }

      // 2. If current finding is a definition and we already have a substantive clause, discard the definition
      if (isDef && !existingIsDef) {
        continue;
      }

      // 3. If both findings are for the same title, check evidence similarity
      const similarity = computeTextSimilarity(existing.evidence, finding.evidence);
      // If evidence is substantially similar (> 50% overlap), deduplicate
      if (similarity > 0.5) {
        // Keep the finding with higher confidence or longer evidence
        if (
          (finding.confidence || 0) > (existing.confidence || 0) ||
          (finding.evidence?.length || 0) > (existing.evidence?.length || 0)
        ) {
          result[existingIndex] = finding;
        }
        continue;
      }
    }

    // Materially different provision or first finding for rule -> preserve
    result.push(finding);
  }

  return result;
}

function scoreEvidenceStrength(finding) {
  const text = finding?.evidence || "";
  let score = 0;

  // Heavy penalty for glossary definitions
  if (isDefinitionExcerpt(text)) {
    score -= 100;
  }

  // Strong preference for substantive user choice or operational clauses
  if (/\b(?:you\s+may\s+choose(?:\s+to)?|choose\s+to\s+set\s+up|optionally\s+set\s+up|set\s+up\s+recurring\s+payments)\b/i.test(text)) {
    score += 50;
  }
  if (/\b(?:allows?|lets?)\s+(?:users?|you)\s+to\s+set\s+up\b/i.test(text)) {
    score += 25;
  }

  // Bonus for mentioning both Autopay and recurring payments
  if (/\bautopay\b/i.test(text)) {
    score += 15;
  }
  if (/\brecurring\s+payments?\b/i.test(text)) {
    score += 15;
  }

  // Bonus for length / substance (avoiding short fragments, max +20)
  score += Math.min(text.length / 5, 20);

  // Confidence contribution
  score += (finding?.confidence || 0) * 10;

  return score;
}

function isDefinitionExcerpt(text) {
  if (!text) return false;
  return /^\s*"(?:[A-Za-z0-9\s]+)"\s+means\b/i.test(text) ||
         /^\s*definitions?\s*:/i.test(text) ||
         /\bmeans\s+a\s+feature\s+(?:supported\s+by|within|provided\s+by)\b/i.test(text);
}

function computeTextSimilarity(str1 = "", str2 = "") {
  if (!str1 || !str2) return 0;
  const words1 = new Set(str1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  const union = new Set([...words1, ...words2]).size;
  return intersection / union;
}

/**
 * Phase 4 AI Analyzer.
 * Delegates to AiAnalysisService which selects the configured AI provider
 * (NVIDIA NIM when NVIDIA_API_KEY is set; NullProvider otherwise).
 * Accepts an optional pre-built _aiService for testing / dependency injection.
 */
export class AIAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.isStub = false;
    // Allow injecting a pre-configured AiAnalysisService for testing
    this._service = options._aiService ?? new AiAnalysisService(options);
  }

  /**
   * Runs AI semantic analysis across document segments.
   *
   * @param {Array<Object>} segments    - Phase 2 clause segments
   * @param {Array<Object>} [ruleFindings=[]] - Phase 3 findings for context
   * @returns {Promise<{ available: boolean, reason?: string, findings: Array<Object>, segmentsAnalyzed: number }>}
   */
  async analyzeSegments(segments, ruleFindings = []) {
    return this._service.analyzeSegments(segments, ruleFindings);
  }
}

/**
 * Unified Analysis Pipeline.
 * Orchestrates analysis passes and synthesizes structured findings and summaries.
 */
export class AnalysisPipeline {
  constructor(options = {}) {
    this.ruleAnalyzer = new RuleAnalyzer(options);
    this.aiAnalyzer = new AIAnalyzer(options);
    this.options = options;
  }

  /**
   * Executes analysis across a structured document.
   *
   * @param {Object} document - Structured Phase 2 document
   * @returns {Promise<{
   *   documentMetadata: Object,
   *   findings: Array<Object>,
   *   summary: Object
   * }>}
   */
  async run(document) {
    if (!document) {
      return createEmptyAnalysisResult();
    }

    // Ensure segments exist: if missing, synthesize from pages or empty array
    let segments = Array.isArray(document.segments) ? document.segments : [];
    if (segments.length === 0 && Array.isArray(document.pages) && document.pages.length > 0) {
      segments = segmentDocumentPages(document.pages);
    }

    // 1. Run deterministic Phase 3 RuleAnalyzer
    const ruleFindings = this.ruleAnalyzer.analyzeSegments(segments);

    // 2. Run Phase 4 AI semantic analysis — failure-safe
    //    If AI is unavailable or fails, Phase 3 results are fully preserved.
    let aiResult = {
      available: false,
      reason: "not_attempted",
      findings: [],
      segmentsAnalyzed: 0
    };
    try {
      aiResult = await this.aiAnalyzer.analyzeSegments(segments, ruleFindings);
    } catch {
      aiResult = {
        available: false,
        reason: "ai_exception",
        findings: [],
        segmentsAnalyzed: 0
      };
    }

    // 3. Combine rule + AI findings; mark each with ruleDetected / aiDetected
    const combinedFindings = AiAnalysisService.combineFindings(
      ruleFindings,
      aiResult.available ? aiResult.findings : []
    );

    // 4. Sort by severity (HIGH > MEDIUM > LOW > INFO) and confidence
    const sortedFindings = sortFindingsBySeverity(combinedFindings);

    // 5. Phase 5: Personalized Risk Ranking & Impact Magnitude
    const userPreferences = this.options.userPreferences || this.options.preferences || {};
    const rankedFindings = rankFindings(sortedFindings, userPreferences);
    const personalizedSummary = computePersonalizedSummary(rankedFindings, userPreferences);

    // 6. Compute deterministic summary + AI metadata + personalized summary
    const summary = {
      ...computeAnalysisSummary(segments, sortedFindings),
      aiAnalysis: {
        available: aiResult.available,
        reason: aiResult.reason ?? null,
        segmentsAnalyzed: aiResult.segmentsAnalyzed ?? 0,
        aiDetectedCount: sortedFindings.filter((f) => f.aiDetected).length,
        ruleDetectedCount: sortedFindings.filter((f) => f.ruleDetected).length
      },
      personalized: personalizedSummary
    };

    // 6. Phase 6: Actionable Pre-Agreement Checklist
    const checklist = generateActionChecklist(rankedFindings, {
      companyName: document.metadata?.filename?.replace(/\.[^/.]+$/, "") || ""
    });

    // 7. Phase 7: Sector Benchmark Evaluation
    const sector = this.options.sector || "GENERAL";
    const benchmarks = evaluateDocumentBenchmark({
      findings: rankedFindings,
      clauses: segments,
      sector
    });

    // 8. Phase 8: Jurisdictional Regulatory Compliance Audit
    const jurisdiction = this.options.jurisdiction;
    const compliance = auditStatutoryCompliance({
      findings: rankedFindings,
      jurisdiction,
      sourceUrl: document.metadata?.filename || "",
      policyText: document.normalizedText || document.rawText || ""
    });

    return {
      documentMetadata: document.metadata || {
        filename: "unnamed-document",
        pageCount: document.pages?.length || 1
      },
      findings: sortedFindings,
      rankedFindings,
      checklist,
      benchmarks,
      compliance,
      summary
    };
  }
}

/**
 * Helper function to run the analysis pipeline directly.
 *
 * @param {Object} document - Structured document
 * @param {Object} [options={}] - Options
 * @returns {Promise<Object>}
 */
export async function analyzeDocument(document, options = {}) {
  const pipeline = new AnalysisPipeline(options);
  return pipeline.run(document);
}

/**
 * Computes deterministic aggregate metrics across analysis findings.
 */
function computeAnalysisSummary(segments, findings) {
  const findingsByCategory = {};
  const findingsBySeverity = {
    [SEVERITY_LEVELS.HIGH]: 0,
    [SEVERITY_LEVELS.MEDIUM]: 0,
    [SEVERITY_LEVELS.LOW]: 0,
    [SEVERITY_LEVELS.INFO]: 0
  };
  const pagesWithFindingsSet = new Set();

  for (const finding of findings) {
    // Count by category
    const cat = finding.categoryId || "UNKNOWN";
    findingsByCategory[cat] = (findingsByCategory[cat] || 0) + 1;

    // Count by severity
    if (findingsBySeverity[finding.severity] !== undefined) {
      findingsBySeverity[finding.severity] += 1;
    }

    // Record page
    if (finding.pageNumber) {
      pagesWithFindingsSet.add(finding.pageNumber);
    }
  }

  const pagesWithFindings = Array.from(pagesWithFindingsSet).sort((a, b) => a - b);

  return {
    totalSegmentsAnalyzed: segments.length,
    totalFindings: findings.length,
    findingsByCategory,
    findingsBySeverity,
    pagesWithFindings,
    analyzedAt: new Date().toISOString()
  };
}

/**
 * Sorts findings in descending priority: HIGH > MEDIUM > LOW > INFO.
 */
function sortFindingsBySeverity(findings) {
  const priority = {
    [SEVERITY_LEVELS.HIGH]: 4,
    [SEVERITY_LEVELS.MEDIUM]: 3,
    [SEVERITY_LEVELS.LOW]: 2,
    [SEVERITY_LEVELS.INFO]: 1
  };

  return [...findings].sort((a, b) => {
    const diff = (priority[b.severity] || 0) - (priority[a.severity] || 0);
    if (diff !== 0) return diff;
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

function createEmptyAnalysisResult() {
  return {
    documentMetadata: { filename: "none", pageCount: 0 },
    findings: [],
    rankedFindings: [],
    benchmarks: {
      sector: "GENERAL",
      restrictivenessScore: 0,
      percentileRank: 0,
      relativeStanding: "Favorable",
      domainBreakdown: {},
      keyRiskOutliers: []
    },
    compliance: {
      jurisdiction: "US_FEDERAL",
      jurisdictionDisplayName: "United States (Federal Law & FTC)",
      complianceStanding: "COMPLIANT_STANDARD",
      totalStatutoryAlerts: 0,
      unenforceableClausesCount: 0,
      criticalViolationsCount: 0,
      statutoryAlerts: []
    },
    summary: {
      totalSegmentsAnalyzed: 0,
      totalFindings: 0,
      findingsByCategory: {},
      findingsBySeverity: {
        [SEVERITY_LEVELS.HIGH]: 0,
        [SEVERITY_LEVELS.MEDIUM]: 0,
        [SEVERITY_LEVELS.LOW]: 0,
        [SEVERITY_LEVELS.INFO]: 0
      },
      pagesWithFindings: [],
      analyzedAt: new Date().toISOString(),
      aiAnalysis: {
        available: false,
        reason: "no_document",
        segmentsAnalyzed: 0,
        aiDetectedCount: 0,
        ruleDetectedCount: 0
      },
      personalized: {
        totalRanked: 0,
        averagePersonalizedScore: 0,
        impactDistribution: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        topConcernCategories: [],
        highestImpactFinding: null,
        personalizedAt: new Date().toISOString()
      }
    }
  };
}
