import { Router } from "express";
import documentsRoutes from "./documents.routes.js";
import analyzeRoutes from "./analyze.routes.js";
import scanRoutes from "./scan.routes.js";
import { remediationRouter } from "./remediation.routes.js";
import { negotiationRouter } from "./negotiation.routes.js";
import { complianceRouter } from "./compliance.routes.js";
import { upload } from "./upload.middleware.js";
import { ingestDocumentController } from "../controllers/ingest.controller.js";

const apiRouter = Router();

apiRouter.use("/documents", documentsRoutes);
apiRouter.use("/analyze", analyzeRoutes);
apiRouter.use("/scan", scanRoutes);
apiRouter.use("/", remediationRouter);
apiRouter.use("/", negotiationRouter);
apiRouter.use("/", complianceRouter);

// Compatibility alias for /api/pdf/ingest
apiRouter.post(
  "/pdf/ingest",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "policyFile", maxCount: 1 }
  ]),
  ingestDocumentController
);

export default apiRouter;
