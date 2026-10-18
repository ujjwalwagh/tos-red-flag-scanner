import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import apiRouter from "./src/api/routes/index.js";
import { AppError } from "./src/security/security.js";
import { config } from "./src/config/env.js";
import { logAudit } from "./src/utils/logger.js";

const app = express();
const port = config.port;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate frontend public directory
const candidatePublicDirs = [
  path.resolve(__dirname, "../frontend/public"),
  path.resolve(__dirname, "public"),
  path.resolve(__dirname, "../public")
];
const staticDir = candidatePublicDirs.find((dir) => fs.existsSync(dir)) || path.resolve(__dirname, "../frontend/public");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "https:", "data:"]
      }
    }
  })
);

app.use(express.json({ limit: "250kb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api", apiRouter);

// Static frontend delivery
app.use(
  express.static(staticDir, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    }
  })
);

// Catch-all route to serve frontend index.html
app.get(/.*/, (_req, res) => {
  const indexPath = path.join(staticDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send("TOS Red Flag Scanner API Server");
  }
});

// Centralized error handling
app.use((error, req, res, next) => {
  if (!error) {
    next();
    return;
  }

  logAudit("request_error", {
    requestId: crypto.randomUUID(),
    statusCode: Number(error?.statusCode || 400),
    sourceType: req.file ? "pdf" : req.body?.url ? "url" : req.body?.policyText ? "text" : "unknown",
    errorName: error?.name || "UnknownError",
    errorMessage: String(error?.message || "Unknown error").slice(0, 220)
  });

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "PDF exceeds the 10MB size limit." });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  const status = Number(error?.statusCode || 500);
  res.status(status).json({
    error: status >= 500 ? "Internal server error occurred." : error?.message || "Invalid request."
  });
});

// Only start listening if executed directly (enables test suite imports)
let serverInstance = null;
const isDirectRun = Boolean(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename));
if (isDirectRun) {
  serverInstance = app.listen(port, () => {
    console.log(`ToS scanner running at http://localhost:${port}`);
  });
}

export { app, serverInstance };
