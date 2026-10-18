import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { processPdfDocument } from "../../ingestion/pdf/document-processor.js";
import { analyzeDocument } from "../../architecture/pipeline/analysis-pipeline.js";
import { normalizeText, countWords, countCharacters } from "../../processing/normalization/text-normalizer.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";
import { getAllRiskCategories } from "../../analysis/risk-categories.js";
import { compareClauses } from "../../analysis/semantic/clause-comparator.js";
import { logAudit } from "../../utils/logger.js";
import { config } from "../../config/env.js";
import { aiClient } from "../../ai/ai-client.js";
import { createAiProvider } from "../../ai/provider-factory.js";

/**
 * Controller for POST /api/analyze
 * Supports document JSON, raw policyText, or uploaded PDF file,
 * with optional user concern weights for personalized risk ranking.
 */
export async function analyzeDocumentController(req, res, next) {
  const requestId = crypto.randomUUID();
  try {
    let document = req.body?.document;
    const uploadedFile = req.files?.file?.[0] || req.files?.policyFile?.[0] || req.file;

    // Parse user preferences if provided
    let userPreferences = req.body?.userPreferences || req.body?.preferences;
    if (typeof userPreferences === "string") {
      try {
        userPreferences = JSON.parse(userPreferences);
      } catch {
        // Fall back to empty object, defaults will apply safely
        userPreferences = {};
      }
    }

    if (uploadedFile) {
      document = await processPdfDocument(uploadedFile.buffer, {
        filename: uploadedFile.originalname,
        maxSize: config.maxPdfBytes
      });
    } else if (typeof document === "string") {
      try {
        document = JSON.parse(document);
      } catch {
        throw new AppError(400, "Invalid document JSON payload.");
      }
    } else if (typeof req.body?.policyText === "string" && req.body.policyText.trim()) {
      const text = req.body.policyText.trim();
      const normalized = normalizeText(text);
      const pages = [{ pageNumber: 1, rawText: text, normalizedText: normalized }];
      document = {
        metadata: {
          filename: req.body.filename || "pasted-policy.txt",
          pageCount: 1,
          wordCount: countWords(normalized),
          characterCount: countCharacters(normalized)
        },
        pages,
        segments: segmentDocumentPages(pages),
        normalizedText: normalized,
        rawText: text
      };
    }

    if (!document || (!document.pages && !document.segments && !document.normalizedText)) {
      throw new AppError(400, "Please provide a structured document, uploaded PDF, or policy text to analyze.");
    }

    const analysis = await analyzeDocument(document, { userPreferences });

    logAudit("document_analyzed", {
      requestId,
      totalFindings: analysis.summary?.totalFindings || 0,
      totalRanked: analysis.rankedFindings?.length || 0,
      totalSegments: analysis.summary?.totalSegmentsAnalyzed || 0
    });

    return res.status(200).json({
      success: true,
      analysis
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller for GET /api/analyze/categories
 * Returns the centralized legal risk categories and default weights.
 */
export function getCategoriesController(_req, res) {
  const categories = getAllRiskCategories();
  return res.status(200).json({
    success: true,
    categories
  });
}

/**
 * Controller for POST /api/analyze/compare
 * Compares two versions of a clause for semantic and lexical modifications.
 */
export async function compareClausesController(req, res, next) {
  const requestId = crypto.randomUUID();
  try {
    const comparison = await compareClauses(req.body);

    logAudit("clauses_compared", {
      requestId,
      available: comparison.available,
      method: comparison.method,
      similarityScore: comparison.similarityScore,
      changeMagnitude: comparison.changeMagnitude
    });

    return res.status(200).json({
      success: true,
      comparison
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller for POST /api/analyze/qa
 * Interactive Q&A grounded in Terms of Service clauses using ephemeral RAG retrieval.
 */
export async function qaDocumentController(req, res, next) {
  const requestId = crypto.randomUUID();
  try {
    const rawQuestion = req.body?.question;
    if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
      throw new AppError(400, "A valid question is required.");
    }

    const question = rawQuestion.trim();
    if (question.length < 3) {
      throw new AppError(400, "Question must be at least 3 characters long.");
    }
    if (question.length > 500) {
      throw new AppError(400, "Question must not exceed 500 characters.");
    }

    let clauses = req.body?.clauses;
    const policyText = req.body?.policyText;

    if (Array.isArray(clauses) && clauses.length > 0) {
      // Provided as clauses array
    } else if (typeof policyText === "string" && policyText.trim()) {
      const text = policyText.trim();
      const normalized = normalizeText(text);
      const pages = [{ pageNumber: 1, rawText: text, normalizedText: normalized }];
      const segments = segmentDocumentPages(pages);
      clauses = segments.map((s, idx) => ({
        clauseId: String(s.clauseId || `clause_${s.segmentIndex ?? idx}`),
        text: s.text,
        section: s.title || ""
      }));
    } else {
      throw new AppError(400, "Either non-empty clauses array or policyText must be provided.");
    }

    if (!Array.isArray(clauses) || clauses.length === 0) {
      throw new AppError(400, "No valid clauses could be extracted from the provided document context.");
    }

    const boundedClauses = clauses.slice(0, 250).map((c, idx) => ({
      clauseId: String(c?.clauseId || c?.clause_id || `clause_${idx}`),
      text: typeof c === "string" ? c.trim() : String(c?.text || c?.rawText || "").trim(),
      section: String(c?.section || c?.title || "")
    })).filter((c) => c.text.length > 0);

    if (boundedClauses.length === 0) {
      throw new AppError(400, "Clauses must contain non-empty text.");
    }

    const client = req.app?.locals?.aiClient || req.aiClient || aiClient;
    const provider = req.app?.locals?.aiProvider || req.aiProvider || createAiProvider();

    // Generate ephemeral Q&A session ID for zero retention
    const qaSessionId = `qa_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let retrievedEvidence = [];

    // Session-scoped vector indexing & retrieval
    try {
      await client.withDocumentVectors(qaSessionId, boundedClauses, async (indexRes) => {
        if (indexRes?.success) {
          try {
            const queryRes = await client.queryVectors(qaSessionId, question, 4);
            if (queryRes?.success && Array.isArray(queryRes.results) && queryRes.results.length > 0) {
              retrievedEvidence = queryRes.results.map((r, idx) => ({
                clauseId: String(r.clause_id || r.clauseId || `c_${idx}`),
                text: String(r.text || r.rawText || "").trim(),
                section: String(r.section || r.title || "").trim(),
                similarityScore: Number(r.similarity_score ?? r.similarityScore ?? 0)
              }));
            }
          } catch {
            retrievedEvidence = [];
          }
        } else {
          retrievedEvidence = [];
        }
      });
    } catch {
      retrievedEvidence = [];
    }

    // Fallback: If vector retrieval returned no evidence (e.g. Python vector service offline or empty),
    // supply bounded request clauses directly as evidence to prevent Gemini starvation.
    if (retrievedEvidence.length === 0 && boundedClauses.length > 0) {
      if (boundedClauses.length <= 10) {
        retrievedEvidence = boundedClauses.map((c, idx) => ({
          clauseId: String(c.clauseId || `clause_${idx + 1}`),
          text: String(c.text || "").slice(0, 1500).trim(),
          section: String(c.section || "").trim()
        }));
      } else {
        // Relevance ranking: prioritize clauses matching question keywords
        const queryTerms = question
          .toLowerCase()
          .replace(/[^\w\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 2);

        const scored = boundedClauses.map((c, originalIdx) => {
          const hay = `${c.section} ${c.text}`.toLowerCase();
          let score = 0;
          for (const term of queryTerms) {
            if (hay.includes(term)) score += 1;
          }
          return { clause: c, originalIdx, score };
        });

        // Stable sort: highest keyword score first, tie-break preserves document order
        scored.sort((a, b) => b.score - a.score || a.originalIdx - b.originalIdx);

        retrievedEvidence = scored.slice(0, 10).map(({ clause: c }, idx) => ({
          clauseId: String(c.clauseId || `clause_${idx + 1}`),
          text: String(c.text || "").slice(0, 1500).trim(),
          section: String(c.section || "").trim()
        }));
      }
    }

    // Call Gemini Q&A provider
    let providerResult;
    try {
      providerResult = await provider.answerQuestion({
        question,
        retrievedEvidence
      });
    } catch {
      providerResult = { available: false, reason: "provider_exception" };
    }

    // Handle Gemini failure / unavailable
    if (!providerResult?.available) {
      logAudit("qa_analyzed", {
        requestId,
        questionLength: question.length,
        available: false,
        reason: providerResult?.reason || "provider_unavailable"
      });

      return res.status(200).json({
        success: true,
        qa: {
          question,
          answer: "Unable to generate an AI answer. Please review the provided ToS evidence directly.",
          evidence: retrievedEvidence,
          grounded: false,
          confidence: 0,
          available: false,
          reason: providerResult?.reason || "provider_unavailable"
        }
      });
    }

    const data = providerResult.data || {};
    const grounded = Boolean(data.grounded);
    const confidence = typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : (grounded ? 0.8 : 0.0);

    // Map relevantClauseIds to the retrieved evidence
    const relevantIds = new Set(
      Array.isArray(data.relevantClauseIds) ? data.relevantClauseIds.map(String) : []
    );

    let mappedEvidence = [];
    if (grounded && retrievedEvidence.length > 0) {
      mappedEvidence = retrievedEvidence.filter((e) => relevantIds.has(e.clauseId));
      if (mappedEvidence.length === 0) {
        mappedEvidence = retrievedEvidence;
      }
    }

    logAudit("qa_analyzed", {
      requestId,
      questionLength: question.length,
      grounded,
      evidenceCount: mappedEvidence.length,
      available: true
    });

    return res.status(200).json({
      success: true,
      qa: {
        question,
        answer: String(data.answer || "No answer provided.").trim(),
        evidence: mappedEvidence,
        grounded,
        confidence,
        available: true,
        reason: null
      }
    });
  } catch (error) {
    next(error);
  }
}

