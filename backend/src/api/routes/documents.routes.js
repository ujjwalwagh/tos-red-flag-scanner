import { Router } from "express";
import { upload } from "./upload.middleware.js";
import { ingestDocumentController } from "../controllers/ingest.controller.js";

const router = Router();

router.post(
  "/ingest",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "policyFile", maxCount: 1 }
  ]),
  ingestDocumentController
);

export default router;
