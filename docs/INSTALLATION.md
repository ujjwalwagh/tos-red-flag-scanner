# TOS Red Flag Scanner — Windows Installation & Setup Guide

**Beginner-Friendly, Step-by-Step Guide for Windows 10 & 11**  
**Version:** 2.0 (Phase 7G-E Release)  

---

## 1. Prerequisites & Required Software

Before setting up the project, ensure you have the following installed on your Windows machine:

1. **Google Chrome:** Version 115 or higher.
   - Download from: [https://www.google.com/chrome/](https://www.google.com/chrome/)
2. **Node.js (LTS):** Version 20.x or 22.x (v22.x recommended).
   - Verify in PowerShell:
     ```powershell
     node --version
     npm --version
     ```
   - Download from: [https://nodejs.org/](https://nodejs.org/)
3. **Python:** Version 3.10, 3.11, 3.12, or 3.13 (Python 3.13 recommended).
   - **Important:** During installation, ensure you check the box **"Add Python to PATH"**.
   - Verify in PowerShell:
     ```powershell
     python --version
     ```
4. **Google Gemini API Key:**
   - Create a free Gemini API key from Google AI Studio: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   - Keep this key private. **Never commit your API key to GitHub.**

---

## 2. Setting Up the Project

### Step 1: Open PowerShell as Administrator
Open Windows Terminal or PowerShell and navigate to the project directory:
```powershell
cd "D:\TOS red flag scanner"
```

### Step 2: Install Node.js Dependencies
Install all required Node.js backend and monorepo packages:
```powershell
npm install
```

### Step 3: Set Up Python Virtual Environment
Create an isolated Python virtual environment named `.venv` in the project root:
```powershell
python -m venv .venv
```

Activate the virtual environment:
```powershell
.\.venv\Scripts\Activate.ps1
```

> [!NOTE]
> If you see an execution policy error like `running scripts is disabled on this system`, run this command in PowerShell once to allow local script execution:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

With the virtual environment activated (you will see `(.venv)` in your terminal prompt), install the Python microservice dependencies:
```powershell
pip install -r ai-service/requirements.txt
```

---

## 3. Configuring Environment Variables

### Step 1: Create Your `.env` File
Copy the example configuration file in the project root:
```powershell
Copy-Item .env.example .env
```

### Step 2: Add Your Gemini API Key
Open `.env` in Notepad or your preferred editor (VS Code):
```powershell
notepad .env
```

Find the line `GEMINI_API_KEY=` and paste your key after the equals sign without quotes:
```env
# Google Gemini API Key (Required for AI Q&A and plain-English explanations)
GEMINI_API_KEY=AIzaSyYourActualKeyHere1234567890

# Enable Gemini Provider
ENABLE_GEMINI_PROVIDER=true

# Server Port
PORT=3000

# Python AI Service Settings
ENABLE_PYTHON_AI_SERVICE=true
PYTHON_AI_SERVICE_URL=http://localhost:8000
PYTHON_AI_SERVICE_TIMEOUT_MS=5000
PYTHON_AI_NLI_TIMEOUT_MS=15000

# Optional: Set to true if running completely offline with pre-cached models
NLI_LOCAL_FILES_ONLY=false

# Chrome Extension Origin (Set after installing the extension in Step 5)
CHROME_EXTENSION_ORIGIN=chrome-extension://your-32-char-extension-id
```
Save and close the file.

---

## 4. Starting the Backend Services

Launch both the Node.js backend (Port 3000) and Python AI microservice (Port 8000) concurrently using the single unified launcher:

```powershell
npm start
```

### What Happens During Startup:
1. The launcher checks if ports 3000 and 8000 are available.
2. The launcher verifies the `.venv` Python executable.
3. The Node.js Express server starts on `http://localhost:3000`.
4. The Python FastAPI microservice starts on `http://localhost:8000` and pre-warms the DeBERTa NLI model on CPU.
5. Prefixed, color-coded logs stream into your terminal:
   - `[BACKEND]` for Express requests, analysis audits, and Gemini queries.
   - `[PYTHON AI]` for embeddings, ChromaDB indexing, and DeBERTa validation.

### Verifying Service Health:
Open your browser and verify both health endpoints:
- Node.js Backend: [http://localhost:3000/health](http://localhost:3000/health) $\rightarrow$ Returns `{"status":"ok", ...}`
- Python AI Service: [http://localhost:8000/health](http://localhost:8000/health) $\rightarrow$ Returns `{"status":"ok", "model_loaded":true, ...}`
- Web Dashboard: [http://localhost:3000](http://localhost:3000)

Keep this terminal window running while using the extension or web application.

---

## 5. Installing the Chrome Extension

1. Open Google Chrome.
2. In the URL address bar, enter:
   ```text
   chrome://extensions/
   ```
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker dialog, navigate to your project directory and select the **`extension`** folder:
   ```text
   D:\TOS red flag scanner\extension
   ```
6. Click **Select Folder**.
7. The **TOS Red Flag Scanner** extension card will appear in your extension list.
8. Locate the 32-character **ID** on the extension card (e.g., `abcdefghijklmnopqrstuvwxyzabcdef`).

### Authorizing the Extension in `.env`:
1. Open your `.env` file in the project root.
2. Update the `CHROME_EXTENSION_ORIGIN` variable with your actual extension ID:
   ```env
   CHROME_EXTENSION_ORIGIN=chrome-extension://your-32-char-extension-id
   ```
3. In your `npm start` terminal, press `Ctrl+C` to stop the server, and restart it with `npm start` to apply the updated CORS configuration.

---

## 5.1 Configuring Extension Settings (Phase 8C.3D)

The extension includes a dedicated **Options Page** allowing users to configure their backend URL and Bearer Token:

### Opening Settings:
- **Method A:** Click the **TOS Red Flag Scanner** icon in your toolbar, and click the **Settings** button in the header or connection status card.
- **Method B:** Right-click the extension icon in your Chrome toolbar and select **Options**.
- **Method C:** Navigate to `chrome://extensions/`, find **TOS Red Flag Scanner**, click **Details**, and select **Extension options**.

### Localhost Configuration (Default):
- **Backend URL:** `http://localhost:3000` (Default)
- **API Bearer Token:** Leave blank (authentication is optional/disabled by default for local development).
- Click **Test Connection** to confirm connectivity. The status card will report: `Backend Connected (Authentication Disabled)`.

### Remote HTTPS Backend Configuration:
- **Backend URL:** Enter your remote server URL (e.g., `https://api.tos-scanner.example.com`).
  - Remote servers **MUST use HTTPS**. Unencrypted HTTP is strictly forbidden for remote hosts to prevent credential leakage.
  - The URL must not contain embedded credentials (`user:pass@host`).
- **API Bearer Token:** Enter your secret Bearer Token provided by the server administrator or generated via `node scripts/generate-token.mjs`.
- Click **Test Connection**:
  1. Chrome will prompt for host permission to access the remote domain. Click **Allow**.
  2. The extension queries `/health` for reachability and CORS authorization.
  3. The extension tests `/api/analyze/categories` with the Bearer Token to verify authorization.
  4. The status card displays `Connection & Authentication Successful`.
- Click **Save Configuration** to store settings in `chrome.storage.local`.

---

## 5.3 Configuring the Web Application (Phase 8C.4B)

If you are using the main web dashboard (`frontend/public/` accessed at `http://localhost:3000` or a deployed web instance):

1. **Open Settings:** Click the **Settings** gear icon in the top-right navigation bar.
2. **Backend Server URL:**
   - **Local Default:** `http://localhost:3000` (or leave blank to use same-origin relative `/api/*` endpoints).
   - **Remote HTTPS:** If pointing to an external backend server, enter `https://api.your-domain.com`.
   - **Protocol Enforcement:** Remote servers **must use HTTPS**. Cleartext `http://` for non-loopback domains is strictly rejected to prevent credential interception.
3. **API Bearer Token:**
   - Leave blank for standard localhost setups with `ENABLE_API_AUTH=false`.
   - When connecting to a protected backend (`ENABLE_API_AUTH=true`), enter your Bearer token.
   - Click the 👁 icon to toggle masking.
4. **Test Connection:**
   - Click **Test Connection** to execute a non-destructive verification sequence against `/health` and `/api/analyze/categories`.
5. **Save & Reset:**
   - Click **Save Settings** to persist the configuration to browser `localStorage`.
   - Click **Reset to Localhost** to purge stored tokens and revert to same-origin `http://localhost:3000`.

> [!WARNING]
> **Remote Deployment Status:** Remote public deployment is **NOT production-ready** until backend Bearer Token authentication (`ENABLE_API_AUTH=true`) and internal Python service tokens (Phase 8C.3E) are fully configured and verified. Never expose an unauthenticated backend to the public internet.

---

## 6. Reloading the Extension After Changes

Whenever you update extension code (such as files in `extension/popup/` or `extension/background/`):
1. Navigate to `chrome://extensions/`.
2. Locate the **TOS Red Flag Scanner** card.
3. Click the circular **Reload** icon button in the bottom-right of the card.
4. Any active popup will automatically update on its next open.

---

## 7. Troubleshooting Common Problems

### Problem 1: Port 3000 or 8000 is Already in Use
**Error message:** `Port 3000 is already in use by another process.`  
**Cause:** A previous Node or Python process did not terminate cleanly.  
**Solution:** Find and stop the lingering processes:
```powershell
Get-NetTCPConnection -LocalPort 3000, 8000 -ErrorAction SilentlyContinue | Select-Object OwningProcess -Unique
```
Stop the owning process ID (e.g. PID 12345):
```powershell
Stop-Process -Id 12345 -Force
```
Then rerun `npm start`.

### Problem 2: Python Virtual Environment Missing
**Error message:** `Python executable not found in .venv.`  
**Solution:** Ensure you created the virtual environment in the project root:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r ai-service/requirements.txt
```

### Problem 3: CORS Not Configured (Yellow Status Dot in Extension)
**Status in Extension:** `CORS Not Configured`  
**Solution:**
1. Check your extension ID at `chrome://extensions/`.
2. Open `.env` and verify `CHROME_EXTENSION_ORIGIN=chrome-extension://<your-id>`.
3. Restart `npm start`.

### Problem 4: Backend Offline (Red Status Dot in Extension)
**Status in Extension:** `Backend Offline`  
**Solution:**
1. Check that `npm start` is running in your terminal without errors.
2. Visit [http://localhost:3000/health](http://localhost:3000/health) directly in Chrome. If the page loads, click **Check Connection** in the extension popup.

### Problem 5: Gemini AI Answers Show "Provider Unavailable"
**Cause:** Missing or invalid Gemini API key.  
**Solution:**
1. Verify that `GEMINI_API_KEY` in `.env` is populated and has no leading/trailing spaces or quotes.
2. Verify that `ENABLE_GEMINI_PROVIDER=true` in `.env`.
3. Restart `npm start`.
