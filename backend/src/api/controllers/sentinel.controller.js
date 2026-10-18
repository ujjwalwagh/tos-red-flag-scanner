/**
 * Policy Drift & Version History API Controllers for TOS Red Flag Scanner (Phase 8).
 */

import crypto from "node:crypto";
import { AppError } from "../../security/security.js";
import { calculatePolicyDrift } from "../../sentinel/drift-engine.js";
import { snapshotStore } from "../../sentinel/snapshot-store.js";
import { logAudit } from "../../utils/logger.js";

/**
 * Calculates policy drift between two historical policy versions.
 * POST /api/sentinel/drift
 */
export async function calculateDriftController(req, res) {
  const requestId = crypto.randomUUID();
  try {
    const { vendorName, baseVersion: rawBase, currentVersion: rawCurrent, previousPolicy, currentPolicy } = req.body || {};
    const baseVersion = rawBase || previousPolicy;
    const currentVersion = rawCurrent || currentPolicy;

    if (!baseVersion || !currentVersion) {
      throw new AppError(400, "Both 'baseVersion' and 'currentVersion' objects are required.");
    }

    const drift = await calculatePolicyDrift({
      vendorName,
      baseVersion,
      currentVersion
    });

    logAudit("policy_drift_calculated", {
      requestId,
      vendorName: drift.vendorName,
      driftDirection: drift.driftDirection,
      driftMagnitude: drift.driftMagnitude
    });

    return res.status(200).json({
      success: true,
      drift
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
      error: error.message || "Failed to calculate policy drift."
    });
  }
}

/**
 * Saves a version snapshot for a given vendor into the session registry.
 * POST /api/sentinel/snapshot
 */
export async function saveSnapshotController(req, res) {
  try {
    const { vendorName, versionLabel, policyText, analysis } = req.body || {};

    if (!vendorName || !policyText) {
      throw new AppError(400, "Both 'vendorName' and 'policyText' are required to save a snapshot.");
    }

    const snapshot = snapshotStore.saveSnapshot(vendorName, {
      versionLabel,
      policyText,
      analysis
    });

    return res.status(200).json({
      success: true,
      snapshot
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || "Failed to save snapshot."
    });
  }
}

/**
 * Retrieves all cached snapshots for a vendor.
 * GET /api/sentinel/snapshots/:vendorName
 */
export async function getSnapshotsController(req, res) {
  try {
    const { vendorName } = req.params;
    const snapshots = snapshotStore.getSnapshots(vendorName);

    return res.status(200).json({
      success: true,
      vendorName,
      snapshots
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || "Failed to retrieve snapshots."
    });
  }
}
