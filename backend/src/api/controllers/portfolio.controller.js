/**
 * Portfolio & Vendor Comparison API Controllers for TOS Red Flag Scanner (Phase 8).
 */

import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { evaluatePortfolioRisk } from "../../portfolio/portfolio-engine.js";
import { compareVendors } from "../../portfolio/vendor-comparator.js";
import { logAudit } from "../../utils/logger.js";

/**
 * Aggregates multiple vendor analyses into a unified corporate portfolio risk summary.
 * POST /api/portfolio/evaluate
 */
export async function evaluatePortfolioController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { portfolioName, vendors: rawVendors, stack } = req.body || {};
    const vendors = Array.isArray(rawVendors) ? rawVendors : stack;

    if (!Array.isArray(vendors) || vendors.length === 0) {
      throw new AppError(400, "A non-empty 'vendors' array is required to evaluate a portfolio.");
    }

    const portfolio = evaluatePortfolioRisk({
      portfolioName,
      vendors
    });

    logAudit("portfolio_evaluated", {
      requestId,
      portfolioName: portfolio.portfolioName,
      totalVendors: portfolio.totalVendors,
      aggregateStackScore: portfolio.aggregateStackScore
    });

    return res.status(200).json({
      success: true,
      portfolio
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
      error: error.message || "Failed to evaluate portfolio."
    });
  }
}

/**
 * Compiles a comparative matrix and procurement scorecard across 2 to 5 competing vendors.
 * POST /api/portfolio/compare
 */
export async function compareVendorsController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { vendorAnalyses, vendors } = req.body || {};
    const inputVendors = Array.isArray(vendorAnalyses) ? vendorAnalyses : (Array.isArray(vendors) ? vendors : []);

    if (inputVendors.length < 2) {
      throw new AppError(400, "At least two vendors are required for head-to-head comparison.");
    }

    const comparison = compareVendors(inputVendors);

    logAudit("vendors_compared", {
      requestId,
      totalCompared: comparison.vendors.length,
      recommendedVendor: comparison.recommendedVendor
    });

    return res.status(200).json({
      success: true,
      comparison,
      matrix: comparison
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
      error: error.message || "Failed to compare vendors."
    });
  }
}
