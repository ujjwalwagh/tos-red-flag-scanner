/**
 * Portfolio & Vendor Comparison Routes for TOS Red Flag Scanner (Phase 8).
 */

import { Router } from "express";
import {
  evaluatePortfolioController,
  compareVendorsController
} from "../controllers/portfolio.controller.js";

export const portfolioRouter = Router();

// POST /api/portfolio/evaluate
portfolioRouter.post("/portfolio/evaluate", evaluatePortfolioController);

// POST /api/portfolio/compare
portfolioRouter.post("/portfolio/compare", compareVendorsController);
