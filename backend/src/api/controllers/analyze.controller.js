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
import { executeLangGraphQa } from "../../rag/langgraph/graph-runner.js";

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
 * Known domain topics with triggers and domain keywords for exception matching.
 */
const EXPANSION_DOMAINS = {
  cancellation: {
    triggers: /\b(cancel|cancellation|terminate|termination|ending|renew|renewal|subscription)\b/i,
    keywords: ["cancel", "cancellation", "terminate", "termination", "renew", "renewal", "subscription", "recurring", "notice", "days"]
  },
  refund: {
    triggers: /\b(refund|refunds|money back|reimburse|reimbursement|charge|fee|payment|billing)\b/i,
    keywords: ["refund", "refundable", "fee", "fees", "charge", "charges", "payment", "billing", "reimburse", "prorated"]
  },
  commercial: {
    triggers: /\b(commercial|business|monetiz|resell|resale|enterprise)\b/i,
    keywords: ["commercial", "business", "personal", "internal", "resell", "resale", "monetize", "prohibited", "license"]
  },
  privacy: {
    triggers: /\b(privacy|personal data|share|sell|tracking|cookies|third party)\b/i,
    keywords: ["privacy", "data", "personal", "collect", "share", "selling", "tracking", "third-party", "disclosure"]
  },
  dispute: {
    triggers: /\b(sue|court|arbitrat|dispute|class action|jury)\b/i,
    keywords: ["arbitration", "dispute", "court", "class action", "jury", "waiver", "litigation", "jurisdiction"]
  }
};

const RESTRICTION_REGEX = /\b(unless|except(?:ing)?|provided that|subject to|notwithstanding|non-refundable|no refunds?|lock-?in|minimum commitment|prior (?:written )?notice|at least \d+\s*(?:business |calendar )?(?:days?|hours?|weeks?|months?)|automatic(?:ally)? renew(?:al|s)?|promotional (?:tier|plan|subscription|trial))\b/i;

/**
 * Normalizes and extracts genuine similarity score across all supported field names.
 * Never fabricates a score. Returns null for missing, null, or non-finite values.
 *
 * @param {any} objOrVal
 * @returns {number|null}
 */
export function normalizeSimilarityScore(objOrVal) {
  if (objOrVal === null || objOrVal === undefined) return null;
  const raw = (typeof objOrVal === "object")
    ? (objOrVal.similarityScore ?? objOrVal.similarity_score ?? objOrVal.similarity)
    : objOrVal;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const parsedPct = Number(trimmed.slice(0, -1).trim());
      if (Number.isFinite(parsedPct)) {
        return parsedPct / 100;
      }
    } else {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Stage 2: Expands Stage 1 retrieved evidence with sibling clauses from the same section
 * and relevant exceptions/restrictions matching the question domain, capped strictly at 10 clauses.
 *
 * @param {Array<Object>} stage1Results - Direct retrieved evidence clauses from Stage 1
 * @param {Array<Object>} boundedClauses - Full document clauses pool
 * @param {string} question - User question
 * @returns {Array<Object>} Expanded, deduplicated evidence array (max 10)
 */
export function expandEvidenceWithExceptions(stage1Results, boundedClauses, question = "") {
  const expanded = [];
  const seenIds = new Set();

  if (Array.isArray(stage1Results)) {
    for (const item of stage1Results) {
      if (item && item.clauseId && !seenIds.has(String(item.clauseId))) {
        seenIds.add(String(item.clauseId));
        const out = {
          clauseId: String(item.clauseId),
          text: String(item.text || "").slice(0, 1500).trim(),
          section: String(item.section || "").trim()
        };
        const sim = normalizeSimilarityScore(item);
        if (sim !== null) {
          out.similarityScore = sim;
          out.similarity = sim;
          out.similarity_score = sim;
        }
        expanded.push(out);
      }
    }
  }

  if (expanded.length >= 10 || !Array.isArray(boundedClauses) || boundedClauses.length === 0) {
    return expanded.slice(0, 10);
  }

  const qLower = String(question || "").toLowerCase();
  const queryTerms = qLower
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const activeDomains = Object.keys(EXPANSION_DOMAINS).filter((dom) =>
    EXPANSION_DOMAINS[dom].triggers.test(qLower)
  );

  // Identify sections and indices of Stage 1 hits within boundedClauses
  const stage1Sections = new Set(expanded.map((r) => r.section).filter(Boolean));
  const stage1Indices = new Set();

  boundedClauses.forEach((c, idx) => {
    const cid = String(c?.clauseId || c?.clause_id || "");
    if (seenIds.has(cid)) {
      stage1Indices.add(idx);
    }
  });

  const candidates = [];

  boundedClauses.forEach((c, idx) => {
    const cid = String(c?.clauseId || c?.clause_id || `clause_${idx}`);
    if (seenIds.has(cid)) return;

    const text = typeof c === "string" ? c.trim() : String(c?.text || c?.rawText || "").trim();
    if (!text) return;

    const section = String(c?.section || c?.title || "").trim();
    const textLower = text.toLowerCase();
    const secLower = section.toLowerCase();

    let score = 0;

    // 1. Sibling expansion: same section bonus
    if (section && stage1Sections.has(section)) {
      score += 3;
      // Neighbor bonus: immediately preceding or following a Stage 1 match
      if (stage1Indices.has(idx - 1) || stage1Indices.has(idx + 1)) {
        score += 2;
      }
    }

    // 2. Exception / restriction detection
    const hasRestriction = RESTRICTION_REGEX.test(text);

    if (hasRestriction) {
      let matchesActiveDomain = false;
      for (const dom of activeDomains) {
        const domKws = EXPANSION_DOMAINS[dom].keywords;
        if (domKws.some((kw) => textLower.includes(kw) || secLower.includes(kw))) {
          matchesActiveDomain = true;
          break;
        }
      }

      if (matchesActiveDomain) {
        score += 5;
      } else {
        // Only count if it matches question query terms
        let queryMatches = 0;
        for (const term of queryTerms) {
          if (textLower.includes(term) || secLower.includes(term)) {
            queryMatches += 1;
          }
        }
        if (queryMatches > 0) {
          score += (2 + queryMatches);
        }
      }
    } else {
      // General query term relevance bonus
      let queryMatches = 0;
      for (const term of queryTerms) {
        if (textLower.includes(term) || secLower.includes(term)) {
          queryMatches += 1;
        }
      }
      if (queryMatches > 0) {
        score += queryMatches;
      }
    }

    if (score > 0) {
      const cand = {
        clauseId: cid,
        text: text.slice(0, 1500),
        section
      };
      const sim = normalizeSimilarityScore(c);
      if (sim !== null) {
        cand.similarityScore = sim;
        cand.similarity = sim;
        cand.similarity_score = sim;
      }
      candidates.push({
        clause: cand,
        originalIdx: idx,
        score
      });
    }
  });

  // Sort candidates by descending score, tie-break preserves document order
  candidates.sort((a, b) => b.score - a.score || a.originalIdx - b.originalIdx);

  for (const { clause } of candidates) {
    if (expanded.length >= 10) break;
    if (!seenIds.has(clause.clauseId)) {
      seenIds.add(clause.clauseId);
      expanded.push(clause);
    }
  }

  return expanded.slice(0, 10);
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

    if (clauses.length > 1000) {
      throw new AppError(400, "Document clause count exceeds the maximum limit of 1,000 clauses for Q&A analysis.");
    }

    const boundedClauses = clauses.slice(0, 1000).map((c, idx) => ({
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

    // Resolve documentType and documentLabel
    const documentType = req.body?.documentType;
    let documentLabel = typeof req.body?.documentLabel === "string" && req.body.documentLabel.trim()
      ? req.body.documentLabel.trim()
      : null;
    if (!documentLabel) {
      if (documentType === "PRIVACY") documentLabel = "Privacy Policy";
      else if (documentType === "OTHER_PRIVACY") documentLabel = "Cookie / Privacy Notice";
      else documentLabel = "Terms of Service";
    }

    // Phase 8B.3: Controlled Dual-Engine Architecture via feature flag (default: false)
    if (config.ai?.enableLangGraphQa === true) {
      try {
        const langGraphResponse = await executeLangGraphQa({
          question,
          clauses: boundedClauses,
          policyText,
          documentType,
          documentLabel,
          isPartial: Boolean(req.body?.isPartial),
          client,
          provider,
          qaSessionId,
          requestId
        });

        if (langGraphResponse && langGraphResponse.success) {
          logAudit("qa_analyzed", {
            requestId,
            engine: "langgraph",
            questionLength: question.length,
            grounded: langGraphResponse.qa?.grounded,
            evidenceCount: langGraphResponse.qa?.evidence?.length || 0,
            available: langGraphResponse.qa?.available,
            nliStatus: langGraphResponse.qa?.nliValidation?.status
          });

          return res.status(200).json(langGraphResponse);
        }
      } catch (graphErr) {
        logAudit("qa_langgraph_fallback", {
          requestId,
          error: graphErr?.message || "langgraph_execution_failed"
        });
        // Graceful non-breaking fallback to the existing procedural pipeline below
      }
    }

    let retrievedEvidence = [];

    // Session-scoped vector indexing & retrieval
    try {
      await client.withDocumentVectors(qaSessionId, boundedClauses, async (indexRes) => {
        if (indexRes?.success) {
          try {
            const queryRes = await client.queryVectors(qaSessionId, question, 8);
            if (queryRes?.success && Array.isArray(queryRes.results) && queryRes.results.length > 0) {
              retrievedEvidence = queryRes.results.map((r, idx) => {
                const sim = normalizeSimilarityScore(r);
                const item = {
                  clauseId: String(r.clause_id || r.clauseId || `c_${idx}`),
                  text: String(r.text || r.rawText || "").trim(),
                  section: String(r.section || r.title || "").trim()
                };
                if (sim !== null) {
                  item.similarityScore = sim;
                  item.similarity = sim;
                  item.similarity_score = sim;
                }
                return item;
              });
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
      // Relevance ranking: prioritize clauses matching question keywords and operational procedures
      const STOP_WORDS = new Set([
        "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with",
        "from", "by", "is", "are", "was", "were", "be", "been", "being",
        "can", "could", "may", "might", "will", "would", "shall", "should", "must",
        "do", "does", "did", "have", "has", "had", "how", "what", "when", "where",
        "who", "why", "which", "this", "that", "these", "those", "my", "your", "our",
        "their", "his", "her", "its", "i", "you", "we", "they", "it"
      ]);

        const allTerms = question
          .toLowerCase()
          .replace(/[^\w\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 2);

        const substantiveTerms = allTerms.filter((t) => !STOP_WORDS.has(t));
        const queryTerms = substantiveTerms.length > 0 ? substantiveTerms : allTerms;

        const isCancelQuery = /\b(cancel|cancellation|terminate|termination|unsubscribe)\b/i.test(question);
        const isRefundQuery = /\b(refund|money back|reimburse)\b/i.test(question);
        const isDisputeQuery = /\b(arbitrat|court|dispute|sue|class action)\b/i.test(question);
        const isPrivacyQuery = /\b(privacy|personal data|share data|sell data|delete data|erasure)\b/i.test(question);

        const OPERATIONAL_CANCEL_REGEX = /\b(?:you\s+may\s+cancel|how\s+to\s+cancel|cancel\s+(?:your\s+)?(?:paid\s+)?subscription|cancel\s+(?:at\s+any\s+time|anytime)|cancel\s+(?:your\s+)?account|unsubscrib(?:e|ing)|cancellation\s+(?:will\s+take\s+effect|takes\s+effect|procedure|policy)|prompts\s+on\s+the\s+account\s+page|account\s+settings|customer\s+support\s+team\s+here\s+for\s+instructions\s+on\s+how\s+to\s+cancel)\b/i;
        const OPERATIONAL_REFUND_REGEX = /\b(?:how\s+to\s+request\s+a\s+refund|refund\s+eligib|refund\s+policy|no\s+refunds?|non-refundable)\b/i;
        const OPERATIONAL_DISPUTE_REGEX = /\b(?:binding\s+individual\s+arbitration|dispute\s+resolution|class\s+action\s+waiver)\b/i;
        const OPERATIONAL_PRIVACY_REGEX = /\b(?:request\s+(?:data\s+)?deletion|right\s+to\s+eras(?:e|ure)|we\s+do\s+not\s+sell|opt-?out)\b/i;

        const scored = boundedClauses.map((c, originalIdx) => {
          const textLower = String(c.text || "").toLowerCase();
          const secLower = String(c.section || "").toLowerCase();

          let score = 0;
          let matchedTerms = 0;

          for (const term of queryTerms) {
            const inText = textLower.includes(term);
            const inSec = secLower.includes(term);
            if (inText || inSec) {
              matchedTerms += 1;
              score += inText ? 2 : 0;
              score += inSec ? 3 : 0;
            }
          }

          // Bonus if all substantive query terms appear in the same clause
          if (queryTerms.length > 1 && matchedTerms === queryTerms.length) {
            score += 4;
          }

          // Operational procedure intent weighting
          if (isCancelQuery) {
            if (OPERATIONAL_CANCEL_REGEX.test(textLower) || OPERATIONAL_CANCEL_REGEX.test(secLower)) {
              score += 10;
            }
            if (secLower.includes("cancel") || secLower.includes("cancellation")) {
              score += 6;
            } else if (secLower.includes("payment") || secLower.includes("billing") || secLower.includes("renewal")) {
              score += 2;
            }
          } else if (isRefundQuery) {
            if (OPERATIONAL_REFUND_REGEX.test(textLower) || OPERATIONAL_REFUND_REGEX.test(secLower)) {
              score += 10;
            }
            if (secLower.includes("refund")) {
              score += 6;
            }
          } else if (isDisputeQuery) {
            if (OPERATIONAL_DISPUTE_REGEX.test(textLower) || OPERATIONAL_DISPUTE_REGEX.test(secLower)) {
              score += 10;
            }
            if (secLower.includes("arbitrat") || secLower.includes("dispute")) {
              score += 6;
            }
          } else if (isPrivacyQuery) {
            if (OPERATIONAL_PRIVACY_REGEX.test(textLower) || OPERATIONAL_PRIVACY_REGEX.test(secLower)) {
              score += 10;
            }
            if (secLower.includes("privacy") || secLower.includes("data") || secLower.includes("rights")) {
              score += 6;
            }
          }

          return { clause: c, originalIdx, score };
        });

      // Stable sort: highest score first, tie-break preserves document order
      scored.sort((a, b) => b.score - a.score || a.originalIdx - b.originalIdx);

      retrievedEvidence = scored.slice(0, 8).map(({ clause: c }, idx) => ({
        clauseId: String(c.clauseId || `clause_${idx + 1}`),
        text: String(c.text || "").slice(0, 1500).trim(),
        section: String(c.section || "").trim()
      }));
    }

    // Stage 2: Deterministic Exception & Related-Clause Expansion (strictly capped at 10)
    retrievedEvidence = expandEvidenceWithExceptions(retrievedEvidence, boundedClauses, question);

    // Call Gemini Q&A provider
    let providerResult;
    try {
      providerResult = await provider.answerQuestion({
        question,
        retrievedEvidence,
        documentLabel
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
          answer: `Unable to generate an AI answer. Please review the provided ${documentLabel} evidence directly.`,
          evidence: retrievedEvidence,
          grounded: false,
          confidence: 0,
          available: false,
          reason: providerResult?.reason || "provider_unavailable",
          nliValidation: {
            status: "unavailable",
            label: null,
            scores: null,
            bestClauseId: null,
            clauseEvaluations: null,
            compositeEvaluation: null,
            reason: "answer_generation_failed"
          },
          documentLabel
        }
      });
    }

    const data = providerResult.data || {};
    const grounded = Boolean(data.grounded);
    const confidence = typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : (grounded ? 0.8 : 0.0);

    // Map relevantClauseIds to the retrieved evidence
    // Phase 7G-B.4: Strict Evidence Selection & Validation for Grounding and NLI
    const retrievedClauseMap = new Map();
    const validRetrievedEvidence = (Array.isArray(retrievedEvidence) ? retrievedEvidence : [])
      .filter((c) => c && typeof c === "object" && typeof c.text === "string" && c.text.trim().length > 0)
      .map((c, idx) => {
        const sim = normalizeSimilarityScore(c);
        const item = {
          clauseId: String(c.clauseId || c.clause_id || `clause_${idx + 1}`).trim(),
          text: c.text.trim(),
          section: String(c.section || c.title || "").trim(),
          similarityScore: sim !== null ? sim : null
        };
        if (sim !== null) {
          item.similarity = sim;
          item.similarity_score = sim;
        } else {
          item.similarity = null;
          item.similarity_score = null;
        }
        if (!retrievedClauseMap.has(item.clauseId)) {
          retrievedClauseMap.set(item.clauseId, item);
        }
        return item;
      });

    // Validate Gemini-selected supporting clause references against actual retrieved clauses
    const validatedMappedClauses = [];
    const seenClauseIds = new Set();

    if (grounded && Array.isArray(data.relevantClauseIds)) {
      for (const rawId of data.relevantClauseIds) {
        const cleanId = (typeof rawId === "string" || typeof rawId === "number")
          ? String(rawId).trim()
          : "";
        if (cleanId && !seenClauseIds.has(cleanId) && retrievedClauseMap.has(cleanId)) {
          seenClauseIds.add(cleanId);
          validatedMappedClauses.push(retrievedClauseMap.get(cleanId));
        }
      }
    }

    let mappedEvidence = [];
    if (validatedMappedClauses.length > 0) {
      mappedEvidence = validatedMappedClauses;
    } else if (grounded && validRetrievedEvidence.length > 0) {
      mappedEvidence = validRetrievedEvidence;
    } else {
      mappedEvidence = [];
    }

    // Select Evidence for Independent NLI Validation:
    // - Prefer mappedEvidence when it contains valid, non-empty supporting clauses.
    // - Reject invalid or fabricated clause references.
    // - Fall back to retrievedEvidence when no valid mappedEvidence is available.
    // - Do not pass an empty evidence array to NLI.
    let evidenceToValidate = [];
    if (validatedMappedClauses.length > 0) {
      evidenceToValidate = validatedMappedClauses;
    } else if (validRetrievedEvidence.length > 0) {
      evidenceToValidate = validRetrievedEvidence;
    }

    const answerText = String(data.answer || "No answer provided.").trim();

    // Step 2: NLI Validation against validated supporting evidence
    let nliValidation = {
      status: "unavailable",
      label: null,
      scores: null,
      bestClauseId: null,
      clauseEvaluations: null,
      compositeEvaluation: null,
      reason: null
    };

    if (!grounded) {
      // Phase 7G-D.6: When Gemini returns grounded: false because evidence is insufficient,
      // skip factual NLI validation on the refusal sentence to prevent misleading contradiction classifications.
      nliValidation = {
        status: "uncertain",
        label: "neutral",
        scores: null,
        bestClauseId: null,
        clauseEvaluations: null,
        compositeEvaluation: null,
        reason: "insufficient_evidence_unanswered"
      };
    } else if (Array.isArray(evidenceToValidate) && evidenceToValidate.length > 0 && answerText) {
      try {
        if (typeof client?.validateNli === "function") {
          const nliRes = await client.validateNli(answerText, evidenceToValidate);
          if (nliRes?.success && nliRes?.available) {
            nliValidation = {
              status: nliRes.status || (nliRes.isSupported ? "supported" : "uncertain"),
              label: nliRes.label || null,
              scores: nliRes.scores || null,
              bestClauseId: nliRes.bestClauseId || null,
              clauseEvaluations: nliRes.clauseEvaluations || null,
              compositeEvaluation: nliRes.compositeEvaluation || null,
              reason: nliRes.reason || null
            };
          } else {
            nliValidation = {
              status: "unavailable",
              label: null,
              scores: null,
              bestClauseId: null,
              clauseEvaluations: null,
              compositeEvaluation: null,
              reason: nliRes?.error || "nli_service_unavailable"
            };
          }
        } else {
          nliValidation = {
            status: "unavailable",
            label: null,
            scores: null,
            bestClauseId: null,
            clauseEvaluations: null,
            compositeEvaluation: null,
            reason: "nli_client_unavailable"
          };
        }
      } catch (nliErr) {
        nliValidation = {
          status: "unavailable",
          label: null,
          scores: null,
          bestClauseId: null,
          clauseEvaluations: null,
          compositeEvaluation: null,
          reason: nliErr?.message || "nli_validation_failed"
        };
      }
    } else if (!evidenceToValidate || evidenceToValidate.length === 0) {
      nliValidation = {
        status: "unavailable",
        label: null,
        scores: null,
        bestClauseId: null,
        clauseEvaluations: null,
        compositeEvaluation: null,
        reason: "no_evidence_supplied"
      };
    }

    logAudit("qa_analyzed", {
      requestId,
      questionLength: question.length,
      grounded,
      evidenceCount: mappedEvidence.length,
      available: true,
      nliStatus: nliValidation.status
    });

    return res.status(200).json({
      success: true,
      qa: {
        question,
        answer: answerText,
        evidence: mappedEvidence,
        grounded,
        confidence,
        available: true,
        reason: null,
        nliValidation,
        documentLabel
      }
    });
  } catch (error) {
    next(error);
  }
}

