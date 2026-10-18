import { Router } from "express";
import { upload } from "./upload.middleware.js";
import {
  analyzeDocumentController,
  getCategoriesController,
  compareClausesController,
  qaDocumentController
} from "../controllers/analyze.controller.js";

const router = Router();

// GET /api/analyze/categories - Centralized legal risk categories & default weights
router.get("/categories", getCategoriesController);

// POST /api/analyze/compare - Clause semantic & lexical comparison
router.post("/compare", compareClausesController);

// POST /api/analyze/qa - Interactive Q&A grounded in Terms of Service clauses
router.post("/qa", qaDocumentController);

// POST /api/analyze - Document legal & AI risk analysis with personalized ranking
router.post(
  "/",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "policyFile", maxCount: 1 }
  ]),
  analyzeDocumentController
);

export default router;
