# PrismClause (ToS Red Flag Scanner) — Developer & Operations Guide

**Project:** PrismClause / ToS Red Flag Scanner
**Document Version:** 3.0 (Consolidated Master Development Guide)
**Status:** Authoritative Development, Testing & Operations Manual
**Target Platform:** Windows 10/11 (macOS / Linux compatible)

---

## 1. System Requirements & Prerequisites

Before provisioning the project, verify that your environment satisfies these prerequisites:

| Requirement | Supported Versions | Verification Command | Notes |
| :--- | :---: | :--- | :--- |
| **Node.js** | `>= 20.0.0` (v22 LTS recommended) | `node -v` | Pure JavaScript dependencies; no C++ `node-gyp` compiler required. |
| **Python** | `3.10` to `3.13` (3.13 tested) | `python --version` | Ensure "Add python.exe to PATH" was enabled during installation. |
| **Browser** | Google Chrome or Microsoft Edge | `chrome://version` | Required for loading the Manifest V3 extension. |
| **Google Gemini API Key** | v1beta Gemini API | Free / Tier 1 key | Required for generative summaries and grounded Q&A. |
| **Shell Environment** | Windows PowerShell 5.1+ / PS 7 | `$PSVersionTable` | PowerShell is the standard shell for Windows development scripts. |

---

## 2. Step-by-Step Local Setup

### 2.1 Clone and Install Node.js Dependencies
Navigate to the project root directory and install npm packages:
```powershell
cd "D:\TOS red flag scanner"
npm install
```
*Note:* The root `package.json` configures `"workspaces": ["backend"]`. Running `npm install` at the root automatically installs dependencies for both the root scripts and the backend API Gateway.

### 2.2 Provision Python Virtual Environment
Initialize a local Python virtual environment in `.venv`:
```powershell
# 1. Create the virtual environment
python -m venv .venv

# 2. Activate the environment in PowerShell
.\.venv\Scripts\Activate.ps1

# 3. Upgrade pip and install AI dependencies
python -m pip install --upgrade pip
pip install -r ai-service/requirements.txt
```

> [!TIP]
> **PowerShell Execution Policy:** If script activation produces `PSSecurityException: running scripts is disabled on this system`, run PowerShell as Administrator (or CurrentUser) and execute:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Alternatively, the unified process manager (`scripts/start.js`) directly detects and executes `.venv/Scripts/python.exe` without requiring manual shell activation.

### 2.3 Download & Cache AI Models (Pre-Warming)
The Python microservice utilizes two models from Hugging Face:
- Dense Embeddings: `sentence-transformers/all-MiniLM-L6-v2` (~90 MB)
- NLI Cross-Encoder: `cross-encoder/nli-deberta-v3-base` (~500 MB)

On the very first run, PyTorch automatically downloads these models to the local Hugging Face cache (`~/.cache/huggingface/hub/`). Ensure your machine has active internet access during initial startup. Subsequent runs load directly from disk in $< 2\text{ seconds}$.

---

## 3. Environment Variable Configuration

Create your local `.env` configuration file by copying `.env.example`:
```powershell
Copy-Item .env.example .env
```

### Complete `.env` Configuration Reference

| Environment Variable | Default Value | Purpose & Constraints |
| :--- | :---: | :--- |
| `PORT` | `3000` | Port for the Node.js Express API Gateway and Web Application. |
| `HOST` | `127.0.0.1` | Network binding interface. Defaults strictly to IPv4 loopback. |
| `AI_SERVICE_URL` | `http://127.0.0.1:8000` | URL where Express reaches the Python FastAPI microservice. |
| `AI_SERVICE_PORT` | `8000` | Port for the Python Uvicorn server. |
| `GEMINI_API_KEY` | `""` | Google Gemini API Key from Google AI Studio. |
| `GEMINI_MODEL` | `gemini-2.5-pro` | Primary LLM model used for structured Q&A explanations. |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Failover model candidate if primary model encounters quotas. |
| `ENABLE_LANGGRAPH_QA` | `false` | Feature flag to switch Q&A engine from Procedural to LangGraph DAG. |
| `ENABLE_API_AUTH` | `false` | Enables Bearer token authentication on `/api/*` routes. |
| `API_BEARER_TOKEN` | `""` | Secret token expected in `Authorization: Bearer <token>` header. |
| `INTERNAL_AI_SERVICE_TOKEN`| `""` | Internal server-to-server token passed to Python via `X-Internal-Token`. |
| `CHROME_EXTENSION_ORIGIN` | `""` | Authorized extension origin (e.g. `chrome-extension://[a-p]{32}`). |
| `TRUST_PROXY` | `false` | When `true`, trusts reverse-proxy `X-Forwarded-For` headers for rate limits. |

---

## 4. Running the Application

### 4.1 Unified Concurrency Process Manager (`npm start`)
PrismClause features a unified concurrent launcher (`scripts/start.js`) that coordinates both the Node.js API Gateway and the Python AI microservice:

```powershell
npm start
```

### What `scripts/start.js` Does Automatically:
1. **Port Conflict Pre-Flight:** Probes ports `3000` and `8000`. If another process occupies either port, it identifies the PID and aborts safely with clear instructions.
2. **Virtual Environment Detection:** Automatically locates `.venv/Scripts/python.exe` on Windows (or `.venv/bin/python` on POSIX).
3. **Concurrent Process Spawning:** Launches Uvicorn (`127.0.0.1:8000`) and Node.js (`127.0.0.1:3000`) with coordinated prefix logging: `[PYTHON AI]` in yellow, `[BACKEND]` in cyan.
4. **Readiness Health Polling:** Polls `/health` endpoints with exponential backoff until both microservices are fully ready.
5. **Clean Process Tree Teardown:** Intercepts `SIGINT` (Ctrl+C). On Windows, it invokes `taskkill /F /T /PID <pid>` to cleanly terminate child process trees, preventing orphaned Python background processes.

---

## 5. Chrome Extension Setup & Debugging

The Manifest V3 extension allows one-click policy analysis directly from any live website.

### 5.1 Load Unpacked Extension
1. Open Google Chrome or Microsoft Edge and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click **Load unpacked** in the top-left toolbar.
4. Select the directory:
   ```text
   D:\TOS red flag scanner\extension
   ```
5. Confirm that the **TOS Red Flag Scanner** card appears with version `1.0.0` and Manifest V3 badge.

### 5.2 Extension Options & Origin Registration
1. In `chrome://extensions/`, click **Details** on the extension card, then click **Extension options** (or right-click the extension icon in the toolbar $\rightarrow$ **Options**).
2. The Options page displays your unique **Extension Origin**, formatted as:
   ```text
   chrome-extension://[32-character-alphabet-string]
   ```
3. Copy this origin string into your `.env` file under `CHROME_EXTENSION_ORIGIN`:
   ```env
   CHROME_EXTENSION_ORIGIN=chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef
   ```
4. Click **Test Connection** on the Options page. It should display a green badge: **"Backend Connected & Verified"**.

---

## 6. Automated Testing Protocols

The project maintains **669 automated tests** across Node.js and Python test suites. All tests must pass with 100% success before any code changes are approved.

### 6.1 Run Node.js Master Test Suite
The Node.js test suite runs natively via Node's built-in test runner (`node:test`) across 40 test suites:
```powershell
npm test
```
*Expected Output:*
```text
1..596
# tests 596
# pass 596
# fail 0
All tests passed successfully!
```

### 6.2 Run Python AI Service Pytest Suite
The Python test suite evaluates dense vector embedding dimensions, ChromaDB lifecycle, internal token authentication, and DeBERTa cross-encoder classifications:
```powershell
.\.venv\Scripts\python.exe -m pytest ai-service\tests -q
```
*Expected Output:*
```text
73 passed in 28.96s
```

### 6.3 Combined Single-Command Verification
To execute both test suites sequentially:
```powershell
npm test; .\.venv\Scripts\python.exe -m pytest ai-service\tests -q
```

---

## 7. Quantitative Academic Evaluation Framework

PrismClause includes an academic benchmark runner in `scripts/evaluate.js` designed for empirical performance verification:

```powershell
node scripts/evaluate.js
```

### Benchmark Metrics Evaluated:
1. **Personalized Risk Ranking Evaluator:**
   - Evaluates finding ranking precision and recall across 20 distinct consumer risk profiles.
   - Computes:
     - Mean Average Precision (MAP)
     - Precision@5
     - Recall@5
     - Normalized Discounted Cumulative Gain (nDCG@5)
2. **Longitudinal Change Detection Evaluator:**
   - Evaluates the semantic clause comparator (`clause-comparator.js`) against a ground-truth dataset of 30 annotated legal contract revision pairs.
   - Computes:
     - Accuracy
     - Micro-F1 and Macro-F1 across 5 magnitude classes (`NONE`, `MINOR`, `MODERATE`, `SIGNIFICANT`, `CRITICAL`)
     - Directional Risk Classification Accuracy (`INCREASED_RISK`, `NEUTRAL`, `DECREASED_RISK`)
