# TOS Red Flag Scanner — Pre-Flight Release Checklist

**Authoritative Release Verification Protocol**  
**Version:** 2.0 (Phase 7G-E Release)  
**Target Release Stage:** Stage A (Local Developer & Personal Use)  

---

## 1. Automated Test Suite Execution

All automated tests must pass with 100% success (zero failures, zero skips) before any release build or package distribution:

| Automated Verification Check | Execution Command | Required Result | Verified Result | Status |
| :--- | :--- | :--- | :---: | :---: |
| **Node.js Master Test Suite** | `node scripts/test-all.js` | 449 tests passing | **449 / 449 passed** | ✅ **PASS** |
| **Python AI Pytest Suite** | `cd ai-service; ..\.venv\Scripts\python -m pytest tests/ -v` | 61 tests passing | **61 / 61 passed** | ✅ **PASS** |
| **Extension Foundation Suite** | `node --test backend/tests/extension-foundation.test.js` | 17 tests passing | **17 / 17 passed** | ✅ **PASS** |
| **Scan Integration Suite** | `node --test backend/tests/scan-integration.test.js` | 56 tests passing | **56 / 56 passed** | ✅ **PASS** |
| **Multi-Terms Isolation Suite** | `node --test backend/tests/multi-terms-isolation.test.js` | All tests passing | **Passed** | ✅ **PASS** |
| **Vector Store & Indexing Suite** | `node --test backend/tests/qa-api.test.js` | 46 tests passing | **46 / 46 passed** | ✅ **PASS** |

---

## 2. Environment & Secret Hygiene Verification

| Verification Item | Audit Procedure | Pass Criteria | Status |
| :--- | :--- | :--- | :---: |
| **No API Keys in Repository Files** | Grep codebase for `AIzaSy`, `nvapi-`, `sk-`. | Zero real API keys found. | ✅ **PASS** |
| **`.env.example` Hygiene** | Inspect root `.env.example` and `backend/.env.example`. | Placeholders only (`your_actual_key_here`). | ✅ **PASS** |
| **`.env` Excluded from Git** | Check `.gitignore` for `.env`. | `.env` explicitly ignored. | ✅ **PASS** |
| **Extension Cleanliness** | Inspect `extension/` for accidental `.env` or credentials. | Zero credentials or secret files inside `extension/`. | ✅ **PASS** |
| **Audit Log Privacy** | Review `backend/src/utils/logger.js`. | Zero raw contract text or questions logged. | ✅ **PASS** |

---

## 3. Manual Chrome Extension Verification (Local Browser)

Perform these interactive tests in Google Chrome with the unpacked extension loaded from `D:\TOS red flag scanner\extension`:

### 3.1 Startup & Connectivity
- [ ] Run `npm start` in PowerShell. Confirm both `[BACKEND]` and `[PYTHON AI]` start without errors.
- [ ] Open Chrome and click the extension toolbar icon.
- [ ] Verify that the header shows your active website domain.
- [ ] Verify that the status indicator dot turns **Green** with the label **"Backend Connected"**.
- [ ] Click **Check Connection**; verify timestamp updates.

### 3.2 Document Detection & Hub Discovery
- [ ] Navigate to `https://www.spotify.com/us/legal/`.
- [ ] Click **Find Legal Documents**.
- [ ] Confirm detection of:
  - [ ] **Terms of Use** (under Terms of Service).
  - [ ] **Paid Subscription Terms** (with distinctive category badge).
  - [ ] **Privacy Policy** (under Privacy Policy).
  - [ ] **Other Privacy / Regional Links** (e.g. California Privacy Notice).
  - [ ] **Legal Documents Hub** (with **"Open Legal Hub ↗"** button).
- [ ] Click **Open Legal Hub ↗**; verify it opens Spotify's central legal portal in a new tab.

### 3.3 Text Extraction & Preview
- [ ] Select **Privacy Policy** and click **Extract Selected Document**.
- [ ] Confirm substantive word count, character count, and heading count appear in the Preview tab.
- [ ] Verify the scrollable contract text preview accurately reflects the document.
- [ ] Confirm that no background temporary tab is left open.

### 3.4 Confirmation Gate & Risk Analysis
- [ ] Click **Confirm Document**. Verify confirmation banner shows confirmed word count.
- [ ] Verify **Analyze Document** button is unlocked.
- [ ] Click **Analyze Document**.
- [ ] Confirm Risk Dashboard renders:
  - [ ] Overall Risk Meter (0–100 score).
  - [ ] Severity summary counts (High, Medium, Low).
  - [ ] Readability Index (Flesch Reading Ease and Grade Level).
  - [ ] Interactive clause cards with severity badges, category labels, and plain-English translations.

### 3.5 Oversized Document Safeguard (>100,000 Characters)
- [ ] Extract an agreement exceeding 100,000 characters.
- [ ] Confirm explicit modal appears: *"Document exceeds 100,000 characters... proceed with partial analysis?"*.
- [ ] Confirm clicking **Cancel** cleanly aborts without scanning.
- [ ] Confirm clicking **Proceed** displays persistent **"Partial Analysis"** warning banner.

---

## 4. Spotify Regression Verification Matrix

| Regression Test Scenario | Step-by-Step Test Actions | Expected Behavioral Contract | Verified |
| :--- | :--- | :--- | :---: |
| **Scenario 1: Spotify Paid Subscription Terms (Cancellation)** | 1. Select Spotify Paid Subscription Terms.<br>2. Extract & Confirm.<br>3. Ask: *"Can I cancel my subscription?"* | Semantic retrieval surfaces cancellation clause (`clause_55`/`clause_77`). Gemini answers affirmative cancellation instructions. DeBERTa verifies entailment (`status: supported`, badge: `SUPPORTED`). Similarity displays genuine score (`Similarity: 72%`). | [ ] |
| **Scenario 2: Spotify Privacy Policy (Section 5 Third-Party Sharing)** | 1. Select Spotify Privacy Policy (642 clauses).<br>2. Extract & Confirm.<br>3. Ask: *"Does Spotify share my personal data with advertising partners?"* | Document indexes all 642 clauses across sequential batches. Section 5 clauses (506–642) are successfully retrieved. Gemini answers grounded in policy evidence. DeBERTa verifies entailment (`SUPPORTED`). | [ ] |
| **Scenario 3: Unanswerable / Out-of-Scope Refusal** | 1. On any agreement, ask an out-of-scope question (e.g. *"What is the refund policy on hardware accessories?"*). | Gemini returns `grounded: false` and standard refusal. DeBERTa skips refusal evaluation. Result: `status: uncertain`, badge: `UNCERTAIN`. No false contradiction. | [ ] |
| **Scenario 4: Multi-Document State Isolation** | 1. Ask a question on Terms of Service.<br>2. Switch to Privacy Policy without asking a question.<br>3. Verify Privacy Q&A history is empty.<br>4. Switch back to Terms of Service. | Terms Q&A history re-appears intact. Privacy Policy history remains clean. Zero history or clause bleeding. | [ ] |
| **Scenario 5: 1,000-Clause Scalability & Rejection** | 1. Submit documents with 600–1,000 clauses.<br>2. Submit synthetic document with >1,000 clauses. | Documents $\le 1,000$ clauses index smoothly in 400-clause chunks. Documents $> 1,000$ clauses rejected with clear error. | [ ] |

---

## 5. Security & Boundary Verification

- [ ] **SEC-EXT-1 Sender Validation:** Verify that web pages cannot trigger service worker actions via `chrome.runtime.sendMessage`.
- [ ] **CORS Enforcement:** Verify that unauthorized web browsers cannot access `POST /api/scan` (returns HTTP 403).
- [ ] **SSRF URL Blocking:** Verify that entering internal URLs (`http://localhost:8080` or `http://192.168.1.1`) into the URL scanner returns HTTP 400 "Private/internal network URLs are blocked".
- [ ] **Zero Lingering Vectors:** Check ChromaDB client after Q&A query; verify collection is deleted unconditionally.
- [ ] **Session Storage Purge:** Close Chrome completely; reopen and confirm `chrome.storage.session` Q&A histories are purged.

---

## 6. Release Decision Gate

| Deployment Target | Pre-Flight Status | Release Decision |
| :--- | :---: | :--- |
| **Stage A: Local Developer / Personal Use** | 100% Verified | **APPROVED FOR IMMEDIATE RELEASE** |
| **Stage B: Limited Tester Sharing (Localhost)** | 100% Verified | **APPROVED (Testers must run backend locally)** |
| **Stage C: Chrome Web Store Submission** | Blocked | **DEFERRED (Requires HTTPS backend & store assets)** |
| **Stage D: Public Remote Cloud Deployment** | Blocked | **STRICTLY NOT APPROVED (Requires SEC-BACK-1 API Auth)** |
