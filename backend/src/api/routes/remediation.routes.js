/**
 * Remediation & Export Routes for TOS Red Flag Scanner (Phase 6).
 */

import { Router } from "express";
import {
  generateOptOutController,
  generateChecklistController,
  exportReportController
} from "../controllers/remediation.controller.js";

export const remediationRouter = Router();

// POST /api/remediation/opt-out
remediationRouter.post("/remediation/opt-out", generateOptOutController);

// POST /api/remediation/checklist
remediationRouter.post("/remediation/checklist", generateChecklistController);

// POST /api/export/report
remediationRouter.post("/export/report", exportReportController);
