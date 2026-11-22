# TOS Red Flag Scanner — User Guide & Operations Manual

**Comprehensive Guide to Installation, Legal Document Analysis, Risk Scoring, Grounded Q&A, and Configuration**  
**Document Version:** 3.1 (Phase 9.1 Release)  

---

## 1. Overview & Core Philosophy

**TOS Red Flag Scanner (PrismClause)** empowers consumers, legal researchers, and compliance engineers to comprehend dense consumer contracts in seconds. It evaluates Terms of Service, Paid Subscription Agreements, and Privacy Policies using a high-precision multi-tier architecture:
1. **Automated Discovery & DOM Extraction:** In-situ extraction from active webpages or isolated background tabs.
2. **14-Category Deterministic Risk Scoring:** Evaluates arbitration clauses, liability caps, unilateral changes, auto-renewals, and content licensing without hallucination.
3. **Semantic Vector Search:** Bounded ChromaDB dense retrieval (up to 1,000 clauses) generating normalized cosine similarity scores.
4. **Evidence-Grounded Generative Q&A:** Synthesizes answers using Google Gemini 2.5 Pro constrained strictly to retrieved contract text.
5. **DeBERTa NLI Cross-Encoder Verification:** Validates mathematical entailment ($P \ge 0.60 \rightarrow \text{SUPPORTED}$; $P > 0.40 \rightarrow \text{CONTRADICTED}$) on CPU.
6. **Zero-Retention Privacy:** No raw policy text, user questions, or embeddings are permanently stored on disk. Ephemeral collections are immediately destroyed upon query completion.

---

## 2. Project Installation & Service Startup

### 2.1 System Prerequisites
- **Operating System:** Windows 10/11, macOS, or Linux.
- **Node.js:** v20.0.0 or higher (v22+ LTS recommended).
- **Python:** v3.10 to v3.13 (v3.13 supported).
- **Browser:** Google Chrome (v115+) or Microsoft Edge (v115+).
- **Google Gemini API Key:** Required for generative explanations and interactive Q&A.

### 2.2 Step-by-Step Installation

1. **Clone or Navigate to the Repository:**
   ```powershell
   cd "D:\TOS red flag scanner"
   ```

2. **Install Node.js Dependencies:**
   ```powershell
   npm install
   ```

3. **Set Up Python Virtual Environment:**
   ```powershell
   # Create virtual environment in .venv
   python -m venv .venv

   # Activate virtual environment (Windows PowerShell)
   .\.venv\Scripts\Activate.ps1
   # (Or on Linux/macOS: source .venv/bin/activate)

   # Install Python microservice packages
   pip install -r ai-service/requirements.txt
   ```

4. **Configure Environment Variables:**
   Copy `.env.example` to `.env` in the project root:
   ```powershell
   Copy-Item .env.example .env
   ```
   Edit `.env` and set your Google Gemini API key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ENABLE_GEMINI_PROVIDER=true
   PORT=3000
   ENABLE_PYTHON_AI_SERVICE=true
   PYTHON_AI_SERVICE_URL=http://localhost:8000
   PYTHON_AI_STARTUP_TIMEOUT_MS=60000
   ```

### 2.3 Starting Both Services

Launch both the Node.js Express server (port 3000) and Python FastAPI AI microservice (port 8000) concurrently with a single command:

```powershell
npm start
```

The unified orchestrator (`scripts/start.js`) will:
- Check for port collisions on 3000 and 8000.
- Verify the virtual environment executable.
- Pre-warm the DeBERTa NLI cross-encoder model on CPU (polling up to 60s with periodic progress updates).
- Verify genuine readiness through JSON probes (`status: "ok"`).
- Stream color-coded, prefixed logs (`[BACKEND]` and `[PYTHON AI]`).

**Access Points:**
- **Web Application Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Node.js Backend Health Probe:** [http://localhost:3000/health](http://localhost:3000/health)
- **Python AI Health Probe:** [http://localhost:8000/health](http://localhost:8000/health)

---

## 3. Installing the Extension in Chrome and Edge

The extension is built on Manifest V3 and runs on all modern Chromium browsers.

### 3.1 Google Chrome Installation
1. Open Google Chrome and enter `chrome://extensions/` in the address bar.
2. Enable **Developer mode** using the toggle switch in the upper-right corner.
3. Click the **Load unpacked** button.
4. Browse to and select the `extension` directory inside your project:
   ```text
   D:\TOS red flag scanner\extension
   ```
5. Click the puzzle-piece **Extensions** icon in Chrome's toolbar and **Pin** the TOS Red Flag Scanner icon.

### 3.2 Microsoft Edge Installation
1. Open Microsoft Edge and enter `edge://extensions/` in the address bar.
2. Turn on the **Developer mode** toggle in the left navigation sidebar.
3. If prompted, toggle on **Allow extensions from other stores**.
4. Click the **Load unpacked** button in the top menu.
5. Select the `extension` directory (`D:\TOS red flag scanner\extension`).
6. Pin the extension to the Edge toolbar for one-click access.

---

## 4. Complete User Workflow

```
[ Step 1: Open Website ] ──► [ Step 2: Open Extension ] ──► [ Step 3: Find Documents ]
                                                                       │
[ Step 6: Confirm Document ] ◄── [ Step 5: Extract & Preview ] ◄── [ Step 4: Select Document ]
         │
         ▼
[ Step 7: Risk Dashboard ] ──► [ Step 8: Ask Questions ] ──► [ Step 9: Review Evidence & NLI ]
                                                                       │
                                                       [ Step 10: Multi-Document Switch ]
```

### Step 1: Open Target Website
Navigate in your browser to any website hosting consumer legal agreements (e.g. `https://www.spotify.com`, `https://discord.com`, `https://github.com`).
> [!NOTE]
> Internal browser pages (`chrome://`, `edge://`, `about:`) and browser extension webstores cannot be scanned due to browser sandbox restrictions.

### Step 2: Open the Extension Popup
Click the **TOS Red Flag Scanner** icon in your toolbar.
- The header displays the active domain (e.g. `spotify.com`).
- The connection indicator displays a green dot with **"Backend Connected"** when your local backend is running.

### Step 3: Find Legal Documents
Click **Find Legal Documents**.
- The extension scans the page DOM, examining navigation links, footer containers, and legal hubs.
- Candidates are grouped by category:
  - **Terms of Service:** General user agreements, terms of use.
  - **Paid Subscription Terms:** Recurring billing, auto-renewal policies.
  - **Privacy Policies:** Global privacy notices, customer data policies.
  - **Other Privacy / Regional Links:** "Do Not Sell My Info", Cookie Policies.
  - **Legal Hubs:** Central legal landing portals (e.g. `/legal`).

### Step 4: Select the Desired Document
Review detected candidates and click **Select** on the document you want to analyze.
- The document is marked **"Selected ✓"** and the Selection Banner displays candidate metadata.

### Step 5: Extract and Preview Text
Click **Extract Selected Document**.
- If the agreement is on the current page, it extracts immediately.
- If hosted on a separate URL or domain, the extension requests host permission if needed, opens an isolated background tab, extracts the text, and closes the tab automatically.
- The **Preview** tab renders word count, character count, heading count, and a scrollable text preview.

### Step 6: Confirm Analysis
Click **Confirm Document** to enable scanning. This prevents accidental scanning of irrelevant pages and unlocks the **Analyze Document** button.

### Step 7: Review the Risk Dashboard
Click **Analyze Document**. The backend analyzes the document against 14 risk categories:
- **Overall Risk Meter:** 0 to 100 risk score with visual color tiering.
- **Severity Counts:** Total High, Medium, and Low risk clauses detected.
- **Readability Index:** Flesch Reading Ease score and school grade level.
- **Interactive Risk Cards:** Expandable cards displaying category, severity badge, plain-English summary, "Why It Matters" consumer impact, and verbatim quote.

### Step 8: Ask Document Questions (Document Q&A)
Scroll to the **Document Q&A** section:
- Enter your question in plain English (e.g. *"Can I cancel my subscription anytime?"*, *"Does this company sell my data?"*).
- Or click any pre-configured question chip for common consumer concerns.
- Click **Ask Question**.

### Step 9: Review Grounded Answers & DeBERTa NLI Verification
The Q&A result presents three layers of verification:
1. **AI Answer:** Plain-English synthesis generated by Google Gemini 2.5 Pro.
2. **NLI Verification Badge:**
   - 🟢 `SUPPORTED` (Entailment $\ge 0.60$): The answer is directly proven by cited clauses.
   - 🔴 `CONTRADICTED` (Contradiction $> 0.40$): The generated answer conflicts with contract facts.
   - 🟡 `UNCERTAIN` (Neutral / Insufficient Evidence): The contract is silent or ambiguous.
3. **Supporting Evidence Clauses:**
   - Verbatim contract clauses cited by the model.
   - Genuine cosine similarity percentages (e.g. `Similarity: 78%` or `Similarity unavailable` for contextual exception clauses).

### Step 10: Multi-Document Switching
If you switch to another detected candidate (e.g. from *Terms of Service* to *Privacy Policy*):
- The dashboard, preview text, and Q&A history swap instantly to the newly active candidate.
- Your previous questions and answers remain preserved in session memory (`chrome.storage.session`).
- Different agreements on the same domain never cross-contaminate each other.

---

## 5. Oversized Documents & The 100,000-Character Boundary

Certain comprehensive corporate agreements exceed 100,000 characters.

### Why the Boundary Exists:
To prevent silent truncation—where an AI model quietly drops the last 20 pages of a contract without notifying the user—TOS Red Flag Scanner enforces an explicit 100,000-character boundary.

### How the Consent Modal Works:
If an extracted document exceeds 100,000 characters:
1. An alert displays the exact character count (e.g. *142,500 characters*).
2. The extension displays an explicit warning modal:
   > *"This document exceeds the 100,000-character limit. Scanning will analyze the first 100,000 characters, but later clauses will be omitted. Do you want to proceed with partial analysis?"*
3. Clicking **Proceed with Partial Analysis** marks the document as partial, displaying a persistent **"Partial Analysis"** warning banner across the Dashboard and Q&A history.
4. Clicking **Cancel** aborts analysis; no data is sent to the backend.

---

## 6. Understanding DeBERTa NLI Classifications

| Status Badge | DeBERTa Label | Meaning for the User | Recommended Action |
| :---: | :---: | :--- | :--- |
| **SUPPORTED** | Entailment ($\ge 0.60$) | The answer is directly proven by the cited contract clauses. | Trust the answer; verify the cited clause quote. |
| **CONTRADICTED** | Contradiction ($> 0.40$) | The generated answer conflicts with the cited clause facts. | Treat answer as unreliable; read original clause. |
| **UNCERTAIN** | Neutral / Refusal | The contract does not contain enough information to give a definite answer. | Consult customer support or legal counsel. |
| **UNAVAILABLE** | Service Offline | Python NLI service was offline or timed out; answer is unverified. | Ensure Python microservice is running. |

---

## 7. Configuring Backend Settings (Extension Options Page — Phase 8C.3D)

The extension includes an **Options Page** allowing full control over backend connectivity:

### Accessing Options:
1. In the popup, click the **⚙ Settings** button in the header.
2. Alternatively, right-click the extension icon in Chrome or Edge and select **Options**.

### Configurable Fields:
1. **Backend Server URL:**
   - **Default:** `http://localhost:3000`
   - **Remote Server:** Supports secure HTTPS endpoints (e.g. `https://api.my-tos-scanner.org`). Plain HTTP is rejected for remote hosts to prevent plaintext credential exposure.
2. **API Bearer Token:**
   - **Optional for Localhost:** Leave blank when developing locally with `ENABLE_API_AUTH=false`.
   - **Authentication-Enabled Server:** Enter the secret token when `ENABLE_API_AUTH=true`.
   - Click the 👁 icon to toggle token visibility.

### Connection Testing:
Click **Test Connection** to execute a 4-stage probe:
- 🟢 **Connection & Authentication Successful:** Server is reachable and the Bearer Token was accepted.
- 🟢 **Backend Connected (Authentication Disabled):** Server is reachable; authentication is not enforced on this instance.
- 🟡 **Authentication Required (HTTP 401):** Server is online, but requires a valid Bearer Token.
- 🔴 **Authentication Failed (HTTP 401):** The entered token was rejected by the server.
- 🔴 **CORS Origin Not Allowed (HTTP 403):** The backend does not recognize this extension ID. Add the extension origin to `CHROME_EXTENSION_ORIGIN` in `.env`.
- 🔴 **Connection Failed:** Server is offline or network unreachable.

---

## 7. Web Application Dashboard & SaaS Views (Phase 9.3)

The web dashboard (`http://localhost:3000`) provides a centralized, client-side SaaS workspace with 4 primary views accessible via the top navigation bar:

```
[ Top Navigation Bar ]
  ├── [ Analyze ]     — Single-document intake, 14-category risk flags, and grounded Q&A
  ├── [ Portfolio ]   — Multi-vendor organizational stack exposure and head-to-head comparison
  ├── [ Sentinel ]    — Historical policy drift, revision tracking, and word-level redline diffs
  ├── [ Compliance ]  — Statutory LexCheck audit against regional consumer protection laws
  └── [ ⚙ Settings ]  — Backend URL and API Bearer Token configuration
```

### 7.1 Analyze View (Document Intake & Grounded Q&A)
- **Document Ingestion:** Paste policy URLs, upload searchable/scanned PDFs (with OCR detection), or paste raw agreement text directly.
- **Customized Risk Priorities:** Adjust priority multipliers (1 to 5) for Arbitration, Data Sharing, Subscription Billing, and Content Licensing.
- **14-Category Finding Cards:** Review classified risk flags with plain-English translations, "Why It Matters" real-world impacts, and exact contract quotes.
- **Remediation & Action Tools:** Generate formal arbitration opt-out letters, preview balanced counter-proposal contract amendments, and export unified Markdown amendment riders.
- **Evidence-Grounded Q&A:** Ask natural language questions grounded strictly in the analyzed document text, verified by the DeBERTa NLI cross-encoder.

### 7.2 Portfolio View (Stack Risk & Vendor Comparison)
- **Active Vendor Stack:** Analyzed documents from your session are automatically tracked in ephemeral browser memory. You can also add custom vendors manually with excerpted clauses.
- **Evaluate Stack Exposure:** Aggregates risk across all vendors in your software footprint, computing:
  - **Aggregate Stack Score (0–100):** Visual circular score gauge with health standing badge (`FAVORABLE`, `CONTROLLED_RISK`, `MODERATE_RISK`, `CRITICAL_EXPOSURE`).
  - **Systemic Risk Concentrations:** Alerts when specific vulnerabilities (e.g., Mandatory Arbitration, Broad IP Assignment, or Third-Party Monetization) appear across $>40\%$ of your vendor stack.
  - **Vendor Rankings Grid:** Ranked list of all stack vendors with individual restrictiveness scores and health ratings.
- **Head-to-Head Comparison Matrix:**
  - Select between 2 and 5 vendors from your stack for side-by-side analysis.
  - **Procurement Recommendation:** Highlights the most favorable contract posture with explicit score differentials and rationale.
  - **Category Alignment Matrix:** Side-by-side comparison across all risk categories highlighting flagged severities vs undetected provisions.

### 7.3 Sentinel View (Policy Drift & Revision Monitor)
- **Chronological Revision Analysis:** Compares a baseline policy version (A) against an updated current version (B).
- **Session Snapshot Integration:** Save any analyzed policy as an in-memory version snapshot (`POST /api/sentinel/snapshot`) and instantly reload it into comparison slots.
- **Drift Metrics:**
  - **Drift Direction Badge:** `MORE_RESTRICTIVE` (red shift), `MORE_FAVORABLE` (green relaxation), or `NEUTRAL` (structural update).
  - **Magnitude Score Meter:** Quantifies the severity of contractual revision (0–100).
- **Detailed Revision Changelog:**
  - **Newly Introduced Restrictions:** Red panel listing stealth additions and their severity.
  - **Removed / Relaxed Terms:** Green panel listing rights reclaimed or restrictions deleted.
  - **Word-Level Redline Transitions:** Visual diffs displaying deleted text in strikethrough red (`<del>`) and inserted terms in emerald green (`<ins>`).

### 7.4 Compliance View (LexCheck Statutory Audit)
- **Supported Regulatory Frameworks:**
  - `US_FEDERAL`: United States Federal Law (FTC Act Section 5, FAA, Negative Option Rule).
  - `US_CALIFORNIA`: California Consumer Privacy (CCPA/CPRA, Auto-Renewal Law, UCL § 17200).
  - `EU_GDPR`: European Union (GDPR, Unfair Contract Terms Directive 93/13/EEC, Digital Services Act).
  - `UK_CRA`: United Kingdom (Consumer Rights Act 2015 Part 2, Consumer Protection Regulations).
  - `IN_CONSUMER`: India (Consumer Protection Act 2019, Unfair Contract Terms doctrine).
- **Audit Target Flexibility:** Audit the last analyzed document from your active session or paste arbitrary contract excerpts.
- **Compliance Results:**
  - **Standing Badge:** `FAVORABLE`, `CAUTION`, or `CRITICAL`.
  - **Statutory Metrics:** Total statutory alerts, potentially unenforceable clauses count, and applicability notice.
  - **Statutory Alert Cards:** Formal citations (e.g. `15 U.S.C. § 45`, `GDPR Art. 6`, `Cal. Civ. Code § 1798.100`), classification badges (`⚠️ Unenforceable Risk`, `🛑 Statutory Violation`, `📋 Statutory Standard`), concise conflict summary, and practical dispute guidance.

---

## 8. Extension Configuration & Options Page (Phase 8C.3D)

The web dashboard (`frontend/public/`) includes an integrated **Backend Settings Modal**:

### Accessing Settings:
1. Click the **⚙ Settings** button in the top navigation bar.
2. The modal displays active backend configuration, authentication status, and storage notices.

### Configurable Fields:
1. **Backend Server URL:**
   - **Default:** `http://localhost:3000` (or empty for relative same-origin paths).
   - **Remote HTTPS:** Enter `https://api.my-tos-scanner.org` (remote cleartext HTTP is blocked).
2. **API Bearer Token:**
   - Leave empty for local development with `ENABLE_API_AUTH=false`.
   - Enter your token when connecting to an authenticated instance (`ENABLE_API_AUTH=true`).

### Automatic 401 Authentication Alert Banner:
If an API call fails with HTTP 401, a top-level alert banner appears: *"Authentication required or token expired. Please configure your Bearer Token."* Clicking **Configure Token** opens the Settings Modal immediately.

---

## 9. Troubleshooting & Common Errors

### 1. "Python AI health check did not respond in time"
- **Cause:** On CPU-constrained machines, loading PyTorch and pre-warming the DeBERTa model can take 30–35 seconds.
- **Solution:** `scripts/start.js` allows up to 60 seconds by default. If your CPU requires additional time, increase `PYTHON_AI_STARTUP_TIMEOUT_MS=90000` in `.env`.

### 2. "CORS origin not allowed (HTTP 403)"
- **Cause:** When the Chrome/Edge extension is loaded unpacked, the browser assigns a 32-character extension ID. If the backend CORS whitelist does not recognize this ID, requests are rejected.
- **Solution:** Look at the extension Options page or popup error notice to find your extension ID (e.g. `chrome-extension://bnajpccjdeiegdlnadkbnpplcpahagoi`). Add it to `.env`:
  ```env
  CHROME_EXTENSION_ORIGIN=chrome-extension://bnajpccjdeiegdlnadkbnpplcpahagoi
  ```
  Restart the backend with `npm start`.

### 3. "Authentication required or token expired (HTTP 401)"
- **Cause:** `ENABLE_API_AUTH=true` is enabled on the server, but no Bearer token was provided or the token was incorrect.
- **Solution:** Open the extension **Options** page or web app **Settings** modal and paste the valid `API_BEARER_TOKEN` configured in the backend `.env`.

### 4. "AI Provider Unavailable / NullProvider Active"
- **Cause:** `GEMINI_API_KEY` is empty or `ENABLE_GEMINI_PROVIDER=false` in `.env`.
- **Solution:** Ensure a valid Gemini API key is configured in `.env` and `ENABLE_GEMINI_PROVIDER=true`.

### 5. Port Collisions (Port 3000 or 8000 already in use)
- **Cause:** An orphaned Node or Python process from an earlier session is still listening on the port.
- **Solution:** Close the conflicting terminal or process. On Windows, locate the process using `netstat -ano | findstr :3000` and terminate it, then run `npm start`.
