/**
 * Negotiation & Benchmarking Routes for TOS Red Flag Scanner (Phase 7).
 */

import { Router } from "express";
import {
  generateAmendmentController,
  buildRiderController,
  evaluateBenchmarkController
} from "../controllers/negotiation.controller.js";

export const negotiationRouter = Router();

// POST /api/negotiation/amendment
negotiationRouter.post("/negotiation/amendment", generateAmendmentController);

// POST /api/negotiation/rider
negotiationRouter.post("/negotiation/rider", buildRiderController);

// POST /api/benchmarks/evaluate
negotiationRouter.post("/benchmarks/evaluate", evaluateBenchmarkController);
