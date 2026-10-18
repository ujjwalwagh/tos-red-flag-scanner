/**
 * Regulatory Compliance & Enforceability Routes for TOS Red Flag Scanner (Phase 8).
 */

import { Router } from "express";
import {
  auditComplianceController,
  getJurisdictionsController
} from "../controllers/compliance.controller.js";

export const complianceRouter = Router();

// POST /api/compliance/audit
complianceRouter.post("/compliance/audit", auditComplianceController);

// GET /api/compliance/jurisdictions
complianceRouter.get("/compliance/jurisdictions", getJurisdictionsController);
