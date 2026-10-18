import { Router } from "express";
import { upload } from "./upload.middleware.js";
import { scanPolicyController } from "../controllers/scan.controller.js";

const router = Router();

router.post("/", upload.single("policyFile"), scanPolicyController);

export default router;
