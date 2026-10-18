import axios from "axios";
import { AppError } from "../../security/security.js";
import { normalizeText, countWords, countCharacters } from "../../processing/normalization/text-normalizer.js";
import { segmentDocumentPages } from "../../processing/segmentation/clause-segmenter.js";
import { analyzeDocument } from "../../architecture/pipeline/analysis-pipeline.js";
import { normalizeCategoryId } from "../risk-categories.js";

const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
const stream = false;

export async function scanPolicyForRedFlags(policyText, sourceUrl, options = {}) {
  const mode = normalizeScanMode(options.mode);
  const apiKey = process.env.NVIDIA_API_KEY;

  // When no API key is provided, use the local deterministic Phase 3/5 Rule Engine
  if (!apiKey) {
    return scanPolicyWithRuleEngine(policyText, sourceUrl, mode, options);
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: stream ? "text/event-stream" : "application/json"
  };

  const payload = {
    model: "meta/llama-4-maverick-17b-128e-instruct",
    messages: [
      {
        role: "system",
        content:
          "You are a contract risk analyst. Return strict JSON only and never include markdown fences."
      },
      {
        role: "user",
        content: createPrompt(policyText, sourceUrl, mode)
      }
    ],
    max_tokens: 850,
    temperature: mode === "strict" ? 0.1 : 0.4,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    stream
  };

  let response;
  try {
    response = await axios.post(invokeUrl, payload, {
      headers,
      responseType: stream ? "stream" : "json",
      timeout: 30_000
    });
  } catch {
    // If the external LLM service fails or rate limits, fallback to the local Rule Engine
    return scanPolicyWithRuleEngine(policyText, sourceUrl, mode);
  }

  const rawContent = response?.data?.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    return scanPolicyWithRuleEngine(policyText, sourceUrl, mode);
  }

  const parsed = safeJsonParse(rawContent);
  if (!parsed || !Array.isArray(parsed.flags)) {
    return scanPolicyWithRuleEngine(policyText, sourceUrl, mode);
  }

  const normalizedFlags = parsed.flags
    .slice(0, 5)
    .map((item) => {
      const catId = normalizeCategoryId(item?.categoryId || item?.category || item?.clauseType);
      return {
        title: cleanText(item?.title),
        severity: normalizeSeverity(item?.severity),
        whyItMatters: cleanText(item?.whyItMatters),
        plainEnglish: cleanText(item?.plainEnglish),
        quote: cleanText(item?.quote),
        clauseType: cleanText(item?.clauseType) || catId,
        categoryId: catId,
        category: catId
      };
    })
    .filter((item) => item.title && item.whyItMatters && item.plainEnglish);

  if (!normalizedFlags.length) {
    return scanPolicyWithRuleEngine(policyText, sourceUrl, mode);
  }

  return {
    sourceUrl,
    scanMode: mode,
    overallRisk: normalizeSeverity(parsed.overallRisk),
    flags: normalizedFlags
  };
}

/**
 * Deterministic local fallback scanner using Phase 3 Rule Engine.
 * Operates 100% locally and offline without external API keys.
 */
async function scanPolicyWithRuleEngine(policyText, sourceUrl, mode, options = {}) {
  const normalized = normalizeText(policyText);
  const pages = [{ pageNumber: 1, rawText: policyText, normalizedText: normalized }];
  const segments = segmentDocumentPages(pages);

  const doc = {
    metadata: {
      filename: sourceUrl || "policy-document",
      pageCount: 1,
      wordCount: countWords(normalized),
      characterCount: countCharacters(normalized)
    },
    pages,
    segments,
    normalizedText: normalized,
    rawText: policyText
  };

  const analysis = await analyzeDocument(doc, { userPreferences: options.userPreferences });
  const findings = analysis.rankedFindings || analysis.findings || [];

  // Filter for strict mode if requested (only HIGH severity)
  const filteredFindings = mode === "strict"
    ? findings.filter((f) => f.severity === "HIGH")
    : findings;

  const topFindings = (filteredFindings.length ? filteredFindings : findings).slice(0, 5);

  let overallRisk = "medium";
  if (topFindings.some((f) => f.severity === "HIGH")) {
    overallRisk = "high";
  } else if (topFindings.length === 0) {
    overallRisk = "low";
  }

  const flags = topFindings.map((f) => {
    const catId = normalizeCategoryId(f.categoryId || f.category || f.clauseType || f.categoryDisplayName);
    return {
      title: f.title,
      severity: f.severity.toLowerCase(),
      whyItMatters: f.explanation,
      plainEnglish: f.explanation,
      quote: f.evidence || "Extracted clause from policy text.",
      clauseType: f.categoryDisplayName || f.category || catId,
      categoryId: catId,
      category: f.category || catId,
      categoryDisplayName: f.categoryDisplayName,
      rank: f.rank,
      impactMagnitude: f.impactMagnitude,
      rankingReason: f.rankingReason,
      personalizedScore: f.personalizedScore
    };
  });

  // If no flags detected, provide a baseline observation
  if (flags.length === 0) {
    flags.push({
      title: "Standard Terms Phrasing",
      severity: "low",
      whyItMatters: "No high-risk clauses or critical red flags were triggered by deterministic rule analysis.",
      plainEnglish: "This document does not contain common aggressive legal clauses like mandatory binding arbitration or class-action waivers.",
      quote: policyText.slice(0, 180),
      clauseType: "General Assessment",
      categoryId: "GENERAL_RISK",
      category: "GENERAL_RISK"
    });
  }

  return {
    sourceUrl,
    scanMode: mode,
    overallRisk,
    flags,
    segments
  };
}

function createPrompt(policyText, sourceUrl, mode) {
  const modeRules =
    mode === "strict"
      ? [
          "- STRICT MODE: Include only high-confidence, concretely risky clauses.",
          "- Exclude speculative or weak concerns.",
          "- Prioritize clauses likely to impact money, legal rights, or privacy."
        ].join("\n")
      : [
          "- BROAD MODE: Include both concrete high-risk and plausible medium-risk concerns.",
          "- Surface suspicious wording patterns that may become user-harmful."
        ].join("\n");

  return `
Analyze this Terms of Service or Privacy Policy and extract exactly five concerning clauses.

Source URL: ${sourceUrl}

Return strict JSON with this shape:
{
  "overallRisk": "low|medium|high|critical",
  "flags": [
    {
      "title": "short name",
      "severity": "low|medium|high|critical",
      "clauseType": "e.g. forced arbitration, auto-renewal, data sharing",
      "quote": "exact short quote from policy",
      "plainEnglish": "what this means for a normal person",
      "whyItMatters": "1-2 sentence risk impact"
    }
  ]
}

Rules:
- Exactly 5 flags.
- Prefer highest risk clauses over common boilerplate.
- Use plain, non-legal language.
- If uncertain, say what is uncertain.
- Output JSON only, no markdown.
${modeRules}

Policy text:
${policyText}
`;
}

function safeJsonParse(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase().trim();
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function normalizeScanMode(value) {
  return value === "strict" ? "strict" : "broad";
}
