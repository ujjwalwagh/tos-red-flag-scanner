/**
 * Policy Drift & Version History Routes for TOS Red Flag Scanner (Phase 8).
 */

import { Router } from "express";
import {
  calculateDriftController,
  saveSnapshotController,
  getSnapshotsController
} from "../controllers/sentinel.controller.js";

export const sentinelRouter = Router();

// POST /api/sentinel/drift
sentinelRouter.post("/sentinel/drift", calculateDriftController);

// POST /api/sentinel/snapshot
sentinelRouter.post("/sentinel/snapshot", saveSnapshotController);

// GET /api/sentinel/snapshots/:vendorName
sentinelRouter.get("/sentinel/snapshots/:vendorName", getSnapshotsController);
