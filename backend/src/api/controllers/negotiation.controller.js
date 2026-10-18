/**
 * Negotiation & Benchmarking API Controllers for TOS Red Flag Scanner (Phase 7).
 */

import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { generateAmendmentProposal, buildContractRider } from "../../negotiation/amendment-generator.js";
import { evaluateDocumentBenchmark } from "../../benchmarks/benchmark-engine.js";
import { logAudit } from "../../utils/logger.js";

/**
 * Generates an attorney-vetted counter-proposal amendment with word-level redline diff.
 * POST /api/negotiation/amendment
 */
export async function generateAmendmentController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { categoryId, clauseText, posture, companyName, context } = req.body || {};

    if (!categoryId && !clauseText) {
      throw new AppError(400, "Either 'categoryId' or 'clauseText' must be provided to generate an amendment.");
    }

    const amendment = generateAmendmentProposal({
      categoryId,
      clauseText: clauseText || "",
      posture: posture || "BALANCED",
      companyName: companyName || "Service Provider",
      context: context || ""
    });

    logAudit("amendment_proposal_generated", {
      requestId,
      categoryId: amendment.categoryId,
      posture: amendment.posture,
      companyName: companyName || "Service Provider"
    });

    return res.status(200).json({
      success: true,
      amendment
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logAudit("request_error", {
      requestId,
      statusCode,
      errorName: error.name,
      errorMessage: error.message
    });

    return res.status(statusCode).json({
      error: error.message || "Failed to generate amendment proposal."
    });
  }
}

/**
 * Compiles selected amendments into a formal, unified Contract Amendment Rider.
 * POST /api/negotiation/rider
 */
export async function buildRiderController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { amendments, companyName, counterpartyName, agreementTitle, effectiveDate } = req.body || {};

    if (!Array.isArray(amendments) || amendments.length === 0) {
      throw new AppError(400, "A non-empty 'amendments' array is required to compile a Contract Amendment Rider.");
    }

    const rider = buildContractRider(amendments, {
      companyName,
      counterpartyName,
      agreementTitle,
      effectiveDate
    });

    logAudit("contract_rider_compiled", {
      requestId,
      clauseCount: rider.clauseCount,
      agreementTitle: rider.agreementTitle
    });

    return res.status(200).json({
      success: true,
      rider
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logAudit("request_error", {
      requestId,
      statusCode,
      errorName: error.name,
      errorMessage: error.message
    });

    return res.status(statusCode).json({
      error: error.message || "Failed to compile contract rider."
    });
  }
}

/**
 * Evaluates vendor restrictiveness against empirical sector baseline benchmarks.
 * POST /api/benchmarks/evaluate
 */
export async function evaluateBenchmarkController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { findings, rankedFindings, clauses, sector } = req.body || {};
    const inputFindings = Array.isArray(findings) 
      ? findings 
      : (Array.isArray(rankedFindings) ? rankedFindings : []);

    const benchmarks = evaluateDocumentBenchmark({
      findings: inputFindings,
      clauses: Array.isArray(clauses) ? clauses : [],
      sector: sector || "GENERAL"
    });

    logAudit("benchmark_evaluated", {
      requestId,
      sector: benchmarks.sector,
      restrictivenessScore: benchmarks.restrictivenessScore,
      percentileRank: benchmarks.percentileRank
    });

    return res.status(200).json({
      success: true,
      benchmarks
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    logAudit("request_error", {
      requestId,
      statusCode,
      errorName: error.name,
      errorMessage: error.message
    });

    return res.status(statusCode).json({
      error: error.message || "Failed to evaluate benchmark."
    });
  }
}
