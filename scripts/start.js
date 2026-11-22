/**
 * Unified Process Manager for TOS Red Flag Scanner.
 *
 * Concurrently manages and coordinates:
 * 1. Node.js Express Backend (Port 3000)
 * 2. Python FastAPI / DeBERTa NLI AI Microservice (Port 8000)
 *
 * Capabilities:
 * - Single-command startup (`npm start`).
 * - Real-time stream prefixing: [BACKEND] and [PYTHON AI].
 * - Pre-flight collision prevention (checks if ports 3000 / 8000 are already in use).
 * - Python virtual environment verification with actionable recovery instructions.
 * - Windows-compatible tree termination (taskkill /T /F) to prevent orphaned processes.
 * - Graceful signal trapping (SIGINT / SIGTERM / SIGHUP) for clean teardown.
 * - Automatic readiness polling and banner confirmation.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const backendServerPath = path.resolve(projectRoot, "backend/server.js");
const aiServiceDir = path.resolve(projectRoot, "ai-service");

// Load environment configuration from root .env if present
const rootEnvPath = path.resolve(projectRoot, ".env");
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: false });
}

// ANSI color codes for readable prefixes
const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m"
};

const PREFIX_BACKEND = `${COLORS.cyan}[BACKEND]${COLORS.reset}`;
const PREFIX_PYTHON = `${COLORS.magenta}[PYTHON AI]${COLORS.reset}`;
const PREFIX_LAUNCHER = `${COLORS.green}[LAUNCHER]${COLORS.reset}`;
const PREFIX_ERROR = `${COLORS.red}[ERROR]${COLORS.reset}`;

let isShuttingDown = false;
let backendChild = null;
let pythonChild = null;

/**
 * Checks if a TCP port is currently in use.
 *
 * @param {number} port
 * @param {string} [host="127.0.0.1"]
 * @param {number} [timeoutMs=400]
 * @returns {Promise<boolean>}
 */
function isPortInUse(port, host = "127.0.0.1", timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Discovers the Python or Uvicorn executable within the project virtual environment.
 *
 * @returns {{ type: string, executable: string, args: string[] } | null}
 */
function findPythonExecutable() {
  const isWindows = process.platform === "win32";

  // Priority 1: Check for uvicorn executable in root or subfolder venv
  const candidateUvicornPaths = isWindows
    ? [
        path.resolve(projectRoot, ".venv/Scripts/uvicorn.exe"),
        path.resolve(projectRoot, ".venv/Scripts/uvicorn.bat"),
        path.resolve(projectRoot, "ai-service/.venv/Scripts/uvicorn.exe"),
        path.resolve(projectRoot, "ai-service/venv/Scripts/uvicorn.exe")
      ]
    : [
        path.resolve(projectRoot, ".venv/bin/uvicorn"),
        path.resolve(projectRoot, "ai-service/.venv/bin/uvicorn"),
        path.resolve(projectRoot, "ai-service/venv/bin/uvicorn")
      ];

  for (const candidate of candidateUvicornPaths) {
    if (fs.existsSync(candidate)) {
      return {
        type: "uvicorn",
        executable: candidate,
        args: ["app.main:app", "--host", "127.0.0.1", "--port", "8000"]
      };
    }
  }

  // Priority 2: Check for python executable to run `python -m uvicorn`
  const candidatePythonPaths = isWindows
    ? [
        path.resolve(projectRoot, ".venv/Scripts/python.exe"),
        path.resolve(projectRoot, "ai-service/.venv/Scripts/python.exe"),
        path.resolve(projectRoot, "ai-service/venv/Scripts/python.exe")
      ]
    : [
        path.resolve(projectRoot, ".venv/bin/python"),
        path.resolve(projectRoot, "ai-service/.venv/bin/python"),
        path.resolve(projectRoot, "ai-service/venv/bin/python")
      ];

  for (const candidate of candidatePythonPaths) {
    if (fs.existsSync(candidate)) {
      return {
        type: "python",
        executable: candidate,
        args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]
      };
    }
  }

  return null;
}

/**
 * Streams child process output line-by-line with a designated prefix.
 *
 * @param {import("node:stream").Readable} sourceStream
 * @param {string} prefix
 * @param {import("node:stream").Writable} targetStream
 */
function attachPrefixedStream(sourceStream, prefix, targetStream) {
  if (!sourceStream) return;
  let lineBuffer = "";

  sourceStream.on("data", (chunk) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        targetStream.write(`${prefix} ${line}\n`);
      }
    }
  });

  sourceStream.on("end", () => {
    if (lineBuffer.trim().length > 0) {
      targetStream.write(`${prefix} ${lineBuffer}\n`);
    }
  });
}

/**
 * Terminates a process and all its descendants cleanly across platforms.
 * Uses taskkill /T /F on Windows to prevent orphaned worker processes.
 *
 * @param {number} pid
 * @returns {Promise<void>}
 */
function killProcessTree(pid) {
  if (!pid) return Promise.resolve();

  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore"
      });
      killer.on("close", () => resolve());
      killer.on("error", () => {
        try {
          process.kill(pid);
        } catch {}
        resolve();
      });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      resolve();
    }
  });
}

/**
 * Graceful unified shutdown handler.
 *
 * @param {string} trigger
 * @param {number} exitCode
 */
async function shutdown(trigger = "signal", exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${PREFIX_LAUNCHER} Gracefully terminating all services (${trigger})...`);

  const terminations = [];
  if (backendChild && !backendChild.killed) {
    terminations.push(killProcessTree(backendChild.pid));
  }
  if (pythonChild && !pythonChild.killed) {
    terminations.push(killProcessTree(pythonChild.pid));
  }

  await Promise.allSettled(terminations);
  console.log(`${PREFIX_LAUNCHER} All services stopped.`);
  process.exit(exitCode);
}

/**
 * Validates and parses positive integers with a safe fallback.
 *
 * @param {any} val
 * @param {number} defaultVal
 * @param {number} [min=1]
 * @param {number} [max=300000]
 * @returns {number}
 */
function parsePositiveInt(val, defaultVal, min = 1, max = 300000) {
  if (val === undefined || val === null || String(val).trim() === "") {
    return defaultVal;
  }
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return defaultVal;
  }
  return n;
}

/**
 * Polls a health URL until it responds with HTTP 200 (and optional validator check) or timeout is reached.
 * Supports both options object configuration and legacy (maxAttempts, intervalMs) positional parameters.
 *
 * @param {string} url
 * @param {number|Object} [maxAttemptsOrOptions=60]
 * @param {number} [intervalMsParam=500]
 * @returns {Promise<{ ready: boolean, data?: any, elapsedMs: number, error?: string }>}
 */
async function waitForReadiness(url, maxAttemptsOrOptions = 60, intervalMsParam = 500) {
  let timeoutMs = 30000;
  let intervalMs = 500;
  let probeTimeoutMs = 1500;
  let serviceName = "Service";
  let validateResponse = null;
  let onProgress = null;
  let progressIntervalMs = 10000;

  if (typeof maxAttemptsOrOptions === "object" && maxAttemptsOrOptions !== null) {
    timeoutMs = Number(maxAttemptsOrOptions.timeoutMs) > 0 ? Number(maxAttemptsOrOptions.timeoutMs) : 30000;
    intervalMs = Number(maxAttemptsOrOptions.intervalMs) > 0 ? Number(maxAttemptsOrOptions.intervalMs) : 500;
    probeTimeoutMs = Number(maxAttemptsOrOptions.probeTimeoutMs) > 0 ? Number(maxAttemptsOrOptions.probeTimeoutMs) : 1500;
    serviceName = maxAttemptsOrOptions.serviceName || "Service";
    validateResponse = typeof maxAttemptsOrOptions.validateResponse === "function" ? maxAttemptsOrOptions.validateResponse : null;
    onProgress = typeof maxAttemptsOrOptions.onProgress === "function" ? maxAttemptsOrOptions.onProgress : null;
    if (Number(maxAttemptsOrOptions.progressIntervalMs) > 0) {
      progressIntervalMs = Number(maxAttemptsOrOptions.progressIntervalMs);
    }
  } else {
    const attempts = Number(maxAttemptsOrOptions) > 0 ? Number(maxAttemptsOrOptions) : 60;
    intervalMs = Number(intervalMsParam) > 0 ? Number(intervalMsParam) : 500;
    timeoutMs = attempts * intervalMs;
  }

  const startTime = Date.now();
  let lastProgressReport = 0;
  let lastError = null;

  while (Date.now() - startTime < timeoutMs) {
    if (isShuttingDown) {
      return { ready: false, data: null, elapsedMs: Date.now() - startTime, error: "shutdown" };
    }

    const elapsed = Date.now() - startTime;
    if (onProgress && elapsed - lastProgressReport >= progressIntervalMs && elapsed >= 4000) {
      lastProgressReport = elapsed;
      onProgress(elapsed, timeoutMs);
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(probeTimeoutMs) });
      if (res.ok) {
        let data = null;
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            data = await res.json();
          } catch {
            data = null;
          }
        } else {
          data = await res.text();
        }

        const isValid = validateResponse ? validateResponse(data) : true;
        if (isValid) {
          return { ready: true, data, elapsedMs: Date.now() - startTime };
        }
      }
    } catch (err) {
      lastError = err?.message || "connection_failed";
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    ready: false,
    data: null,
    elapsedMs: Date.now() - startTime,
    error: lastError || "timeout"
  };
}

/**
 * Main startup orchestrator.
 */
async function startUnified() {
  console.log(`${COLORS.bold}====================================================${COLORS.reset}`);
  console.log(`${COLORS.bold}  TOS Red Flag Scanner — Unified Startup Launcher    ${COLORS.reset}`);
  console.log(`${COLORS.bold}====================================================${COLORS.reset}`);

  // 1. Pre-flight verification: Python environment
  const pythonConfig = findPythonExecutable();
  if (!pythonConfig) {
    console.error(`\n${PREFIX_ERROR} Python virtual environment not found.`);
    console.error(`${PREFIX_LAUNCHER} Expected Python / Uvicorn executable at:`);
    console.error(`  - .venv/Scripts/uvicorn.exe (Windows) or .venv/bin/uvicorn (POSIX)`);
    console.error(`\n${PREFIX_LAUNCHER} Setup instructions:`);
    console.error(`  1. Create virtual environment:  python -m venv .venv`);
    console.error(`  2. Install dependencies:       .\\.venv\\Scripts\\pip install -r ai-service/requirements.txt`);
    console.error(`  3. Run 'npm start' again.\n`);
    process.exit(1);
  }

  // 2. Pre-flight verification: Port collision / duplicate process detection
  const backendPort = parsePositiveInt(process.env.PORT, 3000, 1, 65535);
  const pythonPort = 8000;

  const [portBackendBusy, portPythonBusy] = await Promise.all([
    isPortInUse(backendPort),
    isPortInUse(pythonPort)
  ]);

  if (portBackendBusy || portPythonBusy) {
    console.error(`\n${PREFIX_ERROR} Cannot start: required port is already in use.`);
    if (portBackendBusy) {
      console.error(`  • Port ${backendPort} is occupied by an active process (Node backend).`);
    }
    if (portPythonBusy) {
      console.error(`  • Port ${pythonPort} is occupied by an active process (Python AI service).`);
    }
    console.error(`\n${PREFIX_LAUNCHER} To avoid duplicate processes:`);
    console.error(`  - If an earlier instance is running in another terminal, press Ctrl+C there.`);
    console.error(`  - On Windows, you can terminate lingering instances with:`);
    console.error(`      taskkill /F /IM node.exe /IM uvicorn.exe /IM python.exe\n`);
    process.exit(1);
  }

  // 3. Register lifecycle termination signals
  process.on("SIGINT", () => shutdown("SIGINT (Ctrl+C)", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGHUP", () => shutdown("SIGHUP", 0));

  // Windows readline fix to ensure Ctrl+C is dispatched reliably
  if (process.platform === "win32") {
    import("node:readline")
      .then((readline) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.on("SIGINT", () => {
          process.emit("SIGINT");
        });
      })
      .catch(() => {});
  }

  // Synchronous exit hook as ultimate fallback against orphaned processes on Windows
  process.on("exit", () => {
    if (process.platform === "win32") {
      if (backendChild && !backendChild.killed) {
        try {
          spawnSync("taskkill", ["/pid", String(backendChild.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {}
      }
      if (pythonChild && !pythonChild.killed) {
        try {
          spawnSync("taskkill", ["/pid", String(pythonChild.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {}
      }
    }
  });

  // 4. Launch Node.js Backend on Port
  console.log(`${PREFIX_LAUNCHER} Starting Node.js Backend (Port ${backendPort})...`);
  backendChild = spawn(process.execPath, [backendServerPath], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(backendPort) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  attachPrefixedStream(backendChild.stdout, PREFIX_BACKEND, process.stdout);
  attachPrefixedStream(backendChild.stderr, PREFIX_BACKEND, process.stderr);

  backendChild.on("error", (err) => {
    console.error(`${PREFIX_ERROR} Backend process failure: ${err.message}`);
    shutdown("backend_error", 1);
  });

  backendChild.on("exit", (code, signal) => {
    if (!isShuttingDown) {
      console.error(`${PREFIX_ERROR} Backend process exited unexpectedly (code: ${code ?? signal}).`);
      shutdown("backend_exit", code || 1);
    }
  });

  // 5. Launch Python FastAPI Service on Port 8000
  console.log(`${PREFIX_LAUNCHER} Starting Python AI Service (Port ${pythonPort})...`);
  pythonChild = spawn(pythonConfig.executable, pythonConfig.args, {
    cwd: aiServiceDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONPATH: aiServiceDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  attachPrefixedStream(pythonChild.stdout, PREFIX_PYTHON, process.stdout);
  attachPrefixedStream(pythonChild.stderr, PREFIX_PYTHON, process.stderr);

  pythonChild.on("error", (err) => {
    console.error(`${PREFIX_ERROR} Python AI service failure: ${err.message}`);
    shutdown("python_error", 1);
  });

  pythonChild.on("exit", (code, signal) => {
    if (!isShuttingDown) {
      console.error(`${PREFIX_ERROR} Python AI service exited unexpectedly (code: ${code ?? signal}).`);
      shutdown("python_exit", code || 1);
    }
  });

  // 6. Monitor readiness of both services concurrently
  const backendStartupTimeoutMs = parsePositiveInt(
    process.env.BACKEND_STARTUP_TIMEOUT_MS,
    30000,
    1000,
    300000
  );
  const pythonStartupTimeoutMs = parsePositiveInt(
    process.env.PYTHON_AI_STARTUP_TIMEOUT_MS || process.env.PYTHON_STARTUP_TIMEOUT_MS,
    60000,
    5000,
    300000
  );

  const [backendResult, pythonResult] = await Promise.all([
    waitForReadiness(`http://127.0.0.1:${backendPort}/health`, {
      timeoutMs: backendStartupTimeoutMs,
      intervalMs: 500,
      probeTimeoutMs: 1500,
      serviceName: "Backend",
      validateResponse: (data) => data?.status === "ok",
      onProgress: (elapsedMs, totalMs) => {
        const sec = Math.round(elapsedMs / 1000);
        const total = Math.round(totalMs / 1000);
        console.log(`${PREFIX_LAUNCHER} Waiting for Node.js Backend (${sec}s/${total}s)...`);
      }
    }),
    waitForReadiness(`http://127.0.0.1:${pythonPort}/health`, {
      timeoutMs: pythonStartupTimeoutMs,
      intervalMs: 500,
      probeTimeoutMs: 1500,
      serviceName: "Python AI",
      validateResponse: (data) => data?.status === "ok",
      onProgress: (elapsedMs, totalMs) => {
        const sec = Math.round(elapsedMs / 1000);
        const total = Math.round(totalMs / 1000);
        console.log(`${PREFIX_LAUNCHER} Waiting for Python AI service (loading models & pre-warming DeBERTa... ${sec}s/${total}s)`);
      }
    })
  ]);

  if (!isShuttingDown && backendResult.ready && pythonResult.ready) {
    const pyData = pythonResult.data;
    let nliNote = "";
    if (pyData?.model_loaded) {
      nliNote = " (NLI DeBERTa: Pre-warmed & Ready)";
    } else if (pyData?.nli_status) {
      nliNote = ` (NLI DeBERTa: ${pyData.nli_status})`;
    }

    const bSec = (backendResult.elapsedMs / 1000).toFixed(1);
    const pSec = (pythonResult.elapsedMs / 1000).toFixed(1);

    console.log(`\n${COLORS.green}${COLORS.bold}====================================================`);
    console.log(`  TOS Red Flag Scanner services are online!`);
    console.log(`  • Web App / API:   http://localhost:${backendPort} (ready in ${bSec}s)`);
    console.log(`  • Python AI API:   http://127.0.0.1:${pythonPort}${nliNote} (ready in ${pSec}s)`);
    console.log(`  • Press Ctrl+C in this terminal to stop both.`);
    console.log(`====================================================${COLORS.reset}\n`);
  } else if (!isShuttingDown) {
    if (!backendResult.ready) {
      console.error(`${PREFIX_ERROR} Backend health check did not respond within ${Math.round(backendStartupTimeoutMs / 1000)}s.`);
    }
    if (!pythonResult.ready) {
      console.error(`${PREFIX_ERROR} Python AI health check did not respond within ${Math.round(pythonStartupTimeoutMs / 1000)}s.`);
      console.error(`${PREFIX_LAUNCHER} Note: Model loading may require more time on first run or busy CPUs.`);
      console.error(`${PREFIX_LAUNCHER} You can increase this timeout by setting PYTHON_AI_STARTUP_TIMEOUT_MS in .env (e.g. 90000).\n`);
    }
  }
}

const isDirectRun = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)
);

if (isDirectRun) {
  startUnified();
}

export {
  isPortInUse,
  findPythonExecutable,
  attachPrefixedStream,
  killProcessTree,
  waitForReadiness,
  parsePositiveInt,
  startUnified
};
