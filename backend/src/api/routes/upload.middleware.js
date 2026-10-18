import multer from "multer";
import { AppError } from "../../security/security.js";
import { config } from "../../config/env.js";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPdfBytes },
  fileFilter: (_req, file, callback) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const name = String(file.originalname || "").toLowerCase();
    const hasPdfMime = mime === "application/pdf" || mime === "application/x-pdf" || mime === "application/octet-stream";
    const hasPdfName = name.endsWith(".pdf");

    if (!hasPdfMime && !hasPdfName) {
      callback(new AppError(400, "Only PDF uploads are allowed. Please upload a file with .pdf extension."));
      return;
    }
    callback(null, true);
  }
});
