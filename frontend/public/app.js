import {
  apiFetch,
  getStoredConfig,
  saveStoredConfig,
  resetStoredConfig,
  testBackendConnection
} from "./api-client.js";

const form = document.querySelector("#scan-form");
const urlInput = document.querySelector("#policy-url");
const fileInput = document.querySelector("#policy-file");
const textInput = document.querySelector("#policy-text");
const textLengthEl = document.querySelector("#text-length");
const textRecoEl = document.querySelector("#text-reco");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultsEl = document.querySelector("#results");
const scanBtn = document.querySelector("#scan-btn");
const sparkCanvas = document.querySelector("#spark-layer");
const sparkCtx = sparkCanvas.getContext("2d");
const template = document.querySelector("#flag-template");
const bgVideo = document.querySelector("#bg-video");
const brandLogo = document.querySelector(".brand-logo");

// Phase 2 PDF Ingestion elements
const pdfMetaBox = document.querySelector("#pdf-meta-box");
const pdfFileName = document.querySelector("#pdf-file-name");
const pdfFileSize = document.querySelector("#pdf-file-size");
const pdfIngestBadge = document.querySelector("#pdf-ingest-badge");
const pdfPageCount = document.querySelector("#pdf-page-count");
const pdfWordCount = document.querySelector("#pdf-word-count");
const pdfSegmentCount = document.querySelector("#pdf-segment-count");
const pdfOcrWarning = document.querySelector("#pdf-ocr-warning");

// Phase 9.4.4 Q&A UI elements & state
const qaSection = document.querySelector("#qa-section");
const qaForm = document.querySelector("#qa-form");
const qaQuestionInput = document.querySelector("#qa-question");
const qaSubmitBtn = document.querySelector("#qa-submit-btn");
const qaCharCount = document.querySelector("#qa-char-count");
const qaStatusBox = document.querySelector("#qa-status");
const qaStatusText = document.querySelector("#qa-status-text");
const qaResultsContainer = document.querySelector("#qa-results");
let qaDocumentClauses = [];
let isQaSubmitting = false;

const MIN_RECOMMENDED_CHARS = 500;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const KONAMI_KEYS = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a"
];
let konamiIndex = 0;
let logoTapCount = 0;
let logoTapResetTimer = null;

urlInput.addEventListener("input", () => {
  if (urlInput.value.trim() && fileInput.value) {
    fileInput.value = "";
    hidePdfMetaBox();
  }
  if (urlInput.value.trim() && textInput.value.trim()) {
    textInput.value = "";
    updateTextCounter();
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];

  if (!file) {
    hidePdfMetaBox();
    return;
  }

  if (urlInput.value.trim()) {
    urlInput.value = "";
  }
  if (textInput.value.trim()) {
    textInput.value = "";
    updateTextCounter();
  }

  // Display initial file selection state
  pdfMetaBox.classList.remove("hidden");
  pdfFileName.textContent = file.name;
  pdfFileSize.textContent = formatBytes(file.size);
  pdfOcrWarning.classList.add("hidden");

  // Validate filename extension
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setPdfBadge("Invalid", "is-error");
    statusEl.textContent = "Unsupported file type. Please select a valid PDF (.pdf) document.";
    return;
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    setPdfBadge("Too Large", "is-error");
    statusEl.textContent = "PDF exceeds maximum allowed size of 10MB.";
    return;
  }

  // Initiate PDF ingestion
  setPdfBadge("Extracting...", "is-loading");
  statusEl.textContent = "Extracting pages, text, and structure from PDF...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await apiFetch("/api/documents/ingest", {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Failed to extract text from PDF.");
    }

    const doc = data.document;
    window.lastIngestedDocument = doc;
    const meta = doc.metadata;

    setPdfBadge("Ingested", "is-success");
    pdfPageCount.textContent = `${meta.pageCount} ${meta.pageCount === 1 ? "page" : "pages"}`;
    pdfWordCount.textContent = `${meta.wordCount.toLocaleString()} words`;
    pdfSegmentCount.textContent = `${meta.segmentCount} clauses`;

    if (meta.requiresOcr) {
      pdfOcrWarning.classList.remove("hidden");
      statusEl.textContent = `Document ingested with warnings: ${meta.ocrNotice || "Scanned pages detected."}`;
    } else {
      pdfOcrWarning.classList.add("hidden");
      statusEl.textContent = `PDF extracted successfully: ${meta.pageCount} pages, ${meta.wordCount} words, ${meta.segmentCount} clauses identified.`;
    }
  } catch (err) {
    setPdfBadge("Failed", "is-error");
    statusEl.textContent = err.message || "Failed to process PDF.";
  }
});

textInput.addEventListener("input", () => {
  if (textInput.value.trim() && urlInput.value.trim()) {
    urlInput.value = "";
  }
  if (textInput.value.trim() && fileInput.value) {
    fileInput.value = "";
    hidePdfMetaBox();
  }
  updateTextCounter();
});

function hidePdfMetaBox() {
  if (pdfMetaBox) {
    pdfMetaBox.classList.add("hidden");
  }
}

function setPdfBadge(text, stateClass = "") {
  if (!pdfIngestBadge) return;
  pdfIngestBadge.textContent = text;
  pdfIngestBadge.className = "pdf-ingest-badge";
  if (stateClass) {
    pdfIngestBadge.classList.add(stateClass);
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Strict desktop horizontal stability lock
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(
    "scroll",
    () => {
      if (typeof window.scrollX === "number" && window.scrollX !== 0 && typeof window.scrollTo === "function") {
        window.scrollTo({ left: 0, top: window.scrollY });
      }
    },
    { passive: true }
  );
}

window.addEventListener("resize", resizeSparkCanvas);
resizeSparkCanvas();
initBackgroundVideo();

updateTextCounter();
enableDragForExistingNotes();
initEasterEggs();
initInputTabs();

function initInputTabs() {
  const tabs = document.querySelectorAll(".input-tab");
  const panes = {
    url: document.querySelector("#pane-url"),
    file: document.querySelector("#pane-file"),
    text: document.querySelector("#pane-text")
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");

      const target = tab.dataset.tab;
      Object.entries(panes).forEach(([key, pane]) => {
        if (!pane) return;
        if (key === target) {
          pane.classList.remove("hidden");
          pane.classList.add("active");
          const input = pane.querySelector("input, textarea");
          if (input) input.focus();
        } else {
          pane.classList.add("hidden");
          pane.classList.remove("active");
        }
      });
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const activeTab = document.querySelector(".input-tab.active")?.dataset?.tab || "url";
  let url = urlInput ? urlInput.value.trim() : "";
  let file = fileInput ? fileInput.files?.[0] : null;
  let policyText = textInput ? textInput.value.trim() : "";

  if (activeTab === "url") {
    file = null;
    policyText = "";
  } else if (activeTab === "file") {
    url = "";
    policyText = "";
  } else if (activeTab === "text") {
    url = "";
    file = null;
  }

  window.lastPastedPolicyText = policyText;
  const selectedCount = Number(Boolean(url)) + Number(Boolean(file)) + Number(Boolean(policyText));

  if (!selectedCount) {
    setLoading(false, "Add a URL, upload a PDF, or paste ToS text first.");
    return;
  }

  if (selectedCount > 1) {
    setLoading(false, "Choose exactly one input method: URL, PDF, or pasted text.");
    return;
  }

  setLoading(true, "Reading policy and ranking risky clauses...");
  clearResults();
  clearSummary();

  try {
    let response;
    if (file) {
      const formData = new FormData();
      formData.append("policyFile", file);
      response = await apiFetch("/api/scan", {
        method: "POST",
        body: formData
      });
    } else {
      const payload = url ? { url } : { policyText };
      response = await apiFetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Scan failed");
    }

    await renderResults(data);
    setLoading(false, `Scan finished: ${data.flags.length} red flags found.`);
  } catch (error) {
    setLoading(false, error.message || "Unexpected error");
  }
});

async function renderResults(report) {
  window.currentReport = report;
  renderSummary(report);
  addToVendorStack(report);
  prepareQaDocumentClauses(report);
  resultsEl.classList.remove("hidden");

  const header = document.createElement("header");
  header.className = "results-head";

  const left = document.createElement("div");
  left.innerHTML = `<strong>Source:</strong> ${escapeHtml(report.sourceUrl)}`;

  const risk = document.createElement("span");
  risk.className = "risk-pill";
  risk.textContent = `Overall Risk: ${report.overallRisk.toUpperCase()}`;

  header.append(left, risk);
  resultsEl.append(header);

  const board = document.createElement("div");
  board.className = "results-board";
  const line = document.createElement("div");
  line.className = "results-spine";
  board.append(line);
  resultsEl.append(board);

  const flags = report.flags || [];
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    statusEl.textContent = `Analyzing finding ${i + 1}/${flags.length}...`;

    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".flag-title").textContent = flag.title;
    card.querySelector(".clause-type").textContent = flag.clauseType || "Uncategorized";
    card.querySelector(".plain").textContent = `Plain English: ${flag.plainEnglish}`;
    card.querySelector(".impact").textContent = `Why it matters: ${flag.whyItMatters}`;
    card.querySelector(".quote").textContent = `“${flag.quote || "No direct quote provided."}”`;

    const badge = card.querySelector(".badge");
    badge.textContent = flag.severity;
    badge.classList.add(`severity-${flag.severity}`);

    // Personalized ranking & impact badges
    const cardTop = card.querySelector(".card-top");
    if (flag.rank && cardTop) {
      const rankBadge = document.createElement("span");
      rankBadge.className = "badge badge-rank";
      rankBadge.textContent = `#${flag.rank}`;
      cardTop.prepend(rankBadge);
    }
    if (flag.impactMagnitude && cardTop) {
      const impactBadge = document.createElement("span");
      impactBadge.className = `badge impact-${String(flag.impactMagnitude).toLowerCase()}`;
      impactBadge.textContent = `${flag.impactMagnitude} Impact`;
      cardTop.append(impactBadge);
    }
    if (flag.rankingReason && cardTop) {
      const reasonBox = document.createElement("div");
      reasonBox.className = "ranking-reason-box";
      reasonBox.textContent = flag.rankingReason;
      cardTop.after(reasonBox);
    }

    card.style.transform = "none";
    wireReactionButtons(card);
    enableDrag(card);

    const node = document.createElement("article");
    node.className = `timeline-node ${i % 2 === 0 ? "side-left" : "side-right"}`;

    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin-node";
    pin.setAttribute("aria-label", `Focus finding ${i + 1}`);
    pin.textContent = String(i + 1).padStart(2, "0");
    pin.addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      spark(rect.left + rect.width / 2, rect.top + rect.height / 2, 14);
    });

    node.append(pin, card);
    board.append(node);

    const pinRect = pin.getBoundingClientRect();
    spark(pinRect.left + pinRect.width / 2, pinRect.top + pinRect.height / 2, 10);
    await delay(180);
  }
}

function renderSummary(report) {
  summaryEl.classList.remove("hidden");
  const riskLevel = normalizeSeverity(report.overallRisk);
  const levelIndex = severityIndex(riskLevel);

  const severityCounts = report.flags.reduce(
    (acc, flag) => {
      const key = normalizeSeverity(flag.severity);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  const strip = document.createElement("div");
  strip.className = "summary-strip";

  const label = document.createElement("div");
  label.className = "summary-label";
  label.textContent = `Overall risk profile: ${riskLevel.toUpperCase()}`;

  const meter = document.createElement("div");
  meter.className = "meter";
  for (let i = 0; i < 4; i += 1) {
    const segment = document.createElement("span");
    segment.className = "meter-seg";
    if (i <= levelIndex) {
      segment.classList.add("active");
    }
    meter.append(segment);
  }

  strip.append(label, meter);
  summaryEl.append(strip);

  const counts = document.createElement("div");
  counts.className = "counts";
  for (const level of ["critical", "high", "medium", "low"]) {
    const pill = document.createElement("span");
    pill.className = "count-pill";
    pill.textContent = `${level}: ${severityCounts[level]}`;
    counts.append(pill);
  }
  summaryEl.append(counts);
}

function clearResults() {
  resultsEl.classList.add("hidden");
  resultsEl.innerHTML = "";
  resetQaSection();
}

function clearSummary() {
  summaryEl.classList.add("hidden");
  summaryEl.innerHTML = "";
}

function setLoading(loading, message) {
  scanBtn.disabled = loading;
  scanBtn.textContent = loading ? "Scanning..." : "Scan document";
  statusEl.textContent = message;
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase().trim();
  return ["critical", "high", "medium", "low"].includes(normalized)
    ? normalized
    : "medium";
}

function severityIndex(severity) {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "medium") return 1;
  return 0;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateTextCounter() {
  const length = textInput.value.trim().length;
  textLengthEl.textContent = `${length} characters`;

  if (length >= MIN_RECOMMENDED_CHARS) {
    textRecoEl.textContent = "Good length for a reliable scan";
    textRecoEl.classList.add("ok");
    textRecoEl.classList.remove("warn");
  } else {
    const remaining = MIN_RECOMMENDED_CHARS - length;
    textRecoEl.textContent = `Recommended: ${remaining} more characters`;
    textRecoEl.classList.add("warn");
    textRecoEl.classList.remove("ok");
  }
}

function initBackgroundVideo() {
  if (!bgVideo) {
    return;
  }

  const attemptPlay = () => {
    const playPromise = bgVideo.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => { });
    }
  };

  bgVideo.muted = true;
  bgVideo.defaultMuted = true;
  bgVideo.volume = 0;

  if (bgVideo.readyState >= 2) {
    attemptPlay();
  } else {
    bgVideo.addEventListener("canplay", attemptPlay, { once: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      attemptPlay();
    }
  });
}

function initEasterEggs() {
  setupKonamiEgg();
  setupLogoEgg();
  setupPhraseEgg();
  setupShortcutEgg();
}

function setupKonamiEgg() {
  window.addEventListener("keydown", (event) => {
    const pressed = String(event.key || "").toLowerCase();
    if (pressed === KONAMI_KEYS[konamiIndex]) {
      konamiIndex += 1;
      if (konamiIndex === KONAMI_KEYS.length) {
        document.body.classList.toggle("egg-night-vision");
        showEggToast(
          document.body.classList.contains("egg-night-vision")
            ? "Night Vision mode unlocked."
            : "Night Vision mode off."
        );
        spark(window.innerWidth / 2, window.innerHeight * 0.32, 22);
        konamiIndex = 0;
      }
      return;
    }

    konamiIndex = pressed === KONAMI_KEYS[0] ? 1 : 0;
  });
}

function setupLogoEgg() {
  // Obsolete logo easter-egg removed in brand cleanup
}

function setupPhraseEgg() {
  const triggers = [
    { phrase: "i accept everything", message: "Skeptic mode suggested. Double-check every clause." },
    { phrase: "no red flags", message: "Bold claim detected. Double-check every clause." }
  ];

  textInput.addEventListener("input", () => {
    const value = textInput.value.toLowerCase();
    for (const trigger of triggers) {
      if (!value.includes(trigger.phrase)) continue;
      if (textInput.dataset.lastEgg === trigger.phrase) continue;
      textInput.dataset.lastEgg = trigger.phrase;

      showEggToast(trigger.message);
      const rect = textInput.getBoundingClientRect();
      spark(rect.left + rect.width * 0.7, rect.top + 16, 18);
      return;
    }
  });
}

function setupShortcutEgg() {
  window.addEventListener("keydown", (event) => {
    const isPaletteShortcut =
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      String(event.key || "").toLowerCase() === "l";
    if (!isPaletteShortcut) return;
    event.preventDefault();
    document.body.classList.toggle("egg-laser-lines");
    showEggToast(
      document.body.classList.contains("egg-laser-lines")
        ? "Laser Lines enabled."
        : "Laser Lines disabled."
    );
  });
}

function showEggToast(message) {
  const toast = document.createElement("div");
  toast.className = "egg-toast";
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => {
    toast.classList.add("is-on");
  });
  setTimeout(() => {
    toast.classList.remove("is-on");
    setTimeout(() => toast.remove(), 320);
  }, 1800);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wireReactionButtons(card) {
  const buttons = card.querySelectorAll(".react-btn");
  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      buttons.forEach((item) => item.classList.remove("is-on"));
      button.classList.add("is-on");
      const rect = event.currentTarget.getBoundingClientRect();
      spark(rect.left + rect.width / 2, rect.top + rect.height / 2, 10);
    });
  });
}

function enableDragForExistingNotes() {
  // Stationary presentation layout: draggable motion disabled for cursor stability
}

function enableDrag(element) {
  // Stationary presentation layout: draggable motion disabled for cursor stability
}

function applyDragTransform(element, x, y) {
  // Stationary presentation layout: draggable motion disabled for cursor stability
}

function resizeSparkCanvas() {
  sparkCanvas.width = window.innerWidth;
  sparkCanvas.height = window.innerHeight;
}

function spark(x, y, count = 16) {
  const particles = Array.from({ length: count }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * 4,
    vy: (Math.random() - 0.5) * 4 - 1.8,
    life: 22 + Math.random() * 14,
    size: 1.8 + Math.random() * 2.4
  }));

  animateParticles(particles);
}

function animateParticles(particles) {
  function tick() {
    sparkCtx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
    let alive = 0;

    for (const p of particles) {
      if (p.life <= 0) continue;
      alive += 1;
      p.life -= 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.07;

      sparkCtx.beginPath();
      sparkCtx.fillStyle = `rgba(255, 255, 255, ${Math.max(p.life / 34, 0)})`;
      sparkCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      sparkCtx.fill();
    }

    if (alive > 0) {
      requestAnimationFrame(tick);
    } else {
      sparkCtx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
    }
  }

  requestAnimationFrame(tick);
}

// =========================================================================
// Phase 6: Actionable Remediation, Opt-Out Modal & Audit Export UI
// =========================================================================

let activeOptOutParams = null;

// List of generic legal terms to never confuse as company names
const GENERIC_LEGAL_TERMS = new Set([
  "these", "this", "the", "terms", "policy", "agreement", "privacy", "service", "services",
  "user", "users", "customer", "customers", "client", "clients", "standard", "general",
  "legal", "document", "contract", "website", "application", "platform", "provider",
  "our", "your", "yours", "all", "any", "introduction", "overview", "definitions", "effective",
  "master", "end", "commercial", "global", "online", "sample", "important", "welcome",
  "you", "we", "us", "they", "them", "conditions", "statement", "provisions", "rules", "an", "a"
]);

// Action, navigation, and document chrome terms to filter out from candidate names
const NAVIGATION_CHROME_TERMS = new Set([
  "download", "printable", "print", "pdf", "menu", "navigation", "nav",
  "jump", "content", "skip", "button", "link", "page", "tab", "header",
  "footer", "close", "sign", "in", "log", "out", "back", "home", "search"
]);

function isNavigationOrActionLine(line) {
  if (!line || typeof line !== "string") return false;
  const cleaned = line.trim().toLowerCase();
  if (!cleaned) return true;
  if (
    /^(?:download(?:\s+printable)?\s+pdf|print(?:\s+this\s+page)?|download\s+pdf|printable\s+pdf|skip\s+to\s+.*|jump\s+to\s+.*|back\s+to\s+.*|menu|sign\s+in|log\s+in|privacy\s+&\s+terms)\b/i.test(cleaned)
  ) {
    return true;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => NAVIGATION_CHROME_TERMS.has(w));
}

function isValidCandidate(str) {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  if (trimmed.length < 2) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (GENERIC_LEGAL_TERMS.has(lower) || NAVIGATION_CHROME_TERMS.has(lower)) return false;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Reject if any word is a navigation/chrome term like "download", "printable", "pdf"
  if (words.some((w) => NAVIGATION_CHROME_TERMS.has(w))) return false;

  // Reject if all words are generic terms
  if (words.every((w) => GENERIC_LEGAL_TERMS.has(w))) return false;

  // Reject phrases starting with demonstratives / pronouns followed by generic words
  if (
    ["these", "this", "our", "your", "standard", "general", "all", "any", "the", "an", "a"].includes(words[0]) &&
    words.length > 1 &&
    GENERIC_LEGAL_TERMS.has(words[1])
  ) {
    return false;
  }
  return true;
}

function cleanCandidate(str) {
  if (!str) return null;
  const cleaned = str
    .trim()
    .replace(/[,\s]+(?:inc|llc|ltd|corp|corporation|s\.a|s\.r\.l|limited|private\s+limited|plc)\.?$/i, "")
    .trim();
  return isValidCandidate(cleaned) ? cleaned.toUpperCase() : null;
}

function extractCompanyNameFromText(text) {
  if (!text || typeof text !== "string") return null;
  const rawHeader = text.trim().slice(0, 1500);

  // Split into lines and filter out empty and navigation/action lines
  const allLines = rawHeader.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const contentLines = allLines.filter((l) => !isNavigationOrActionLine(l));
  const cleanedHeader = contentLines.join("\n");

  for (const line of contentLines.slice(0, 8)) {
    // Pattern 1: Title lines like "Google Pay Terms of Service", "PayPal User Agreement", "Zoom Terms of Service"
    const titleMatch = line.match(
      /^([A-Z0-9][A-Za-z0-9&.' -]{1,35}?)[ \t]+(?:Terms\s+of\s+Service|Terms\s+of\s+Use|Privacy\s+Policy|Privacy\s+Statement|User\s+Agreement|Terms\s+and\s+Conditions|Customer\s+Agreement|Services\s+Agreement|Terms\b)/i
    );
    if (titleMatch?.[1]) {
      const candidate = cleanCandidate(titleMatch[1]);
      if (candidate) return candidate;
    }

    // Pattern 2: "User Agreement for PayPal Services", "Terms of Service for Google Pay"
    const forMatch = line.match(
      /(?:Terms\s+of\s+Service|Terms\s+of\s+Use|Privacy\s+Policy|User\s+Agreement|Terms\s+and\s+Conditions|Terms)\s+(?:for|governing)\s+([A-Z0-9][A-Za-z0-9&.' -]{1,35}?)(?:\s+Services|\s+Service|\s+Users|\s+Accounts|\b)/i
    );
    if (forMatch?.[1]) {
      const candidate = cleanCandidate(forMatch[1]);
      if (candidate) return candidate;
    }
  }

  // Pattern 3: Intro greetings like "Welcome to Stripe!", "Welcome to PayPal!", "Thank you for using Google Pay."
  const welcomeMatch = cleanedHeader.match(
    /(?:Welcome\s+to|Thanks\s+for\s+using|Thank\s+you\s+for\s+using)\s+([A-Z0-9][A-Za-z0-9&.' -]{1,25}?)(?:!|\.|\s+and|\s+Terms|\s+Privacy|,|\(|\r?\n|$)/i
  );
  if (welcomeMatch?.[1]) {
    const candidate = cleanCandidate(welcomeMatch[1]);
    if (candidate) return candidate;
  }

  // Pattern 4: Contract parties: "between you and PayPal, Inc.", "provided by Zoom Video Communications"
  const entityMatch = cleanedHeader.match(
    /(?:between\s+you\s+and|between\s+(?:the\s+)?user\s+and|provided\s+by|operated\s+by|offered\s+by)\s+([A-Z0-9][A-Za-z0-9&.' -]{1,35}?)(?:,|\.|\s+\(|'|"|\s+and\b|\r?\n|$)/i
  );
  if (entityMatch?.[1]) {
    const candidate = cleanCandidate(entityMatch[1]);
    if (candidate) return candidate;
  }

  // Pattern 5: Distinct recognized service detection in header if unambiguously present
  if (/\bGoogle\s+Pay\b/i.test(cleanedHeader)) {
    return "GOOGLE PAY";
  }

  return null;
}

function extractCompanyName(sourceUrl, fallbackLabel = "the Service Provider", policyText = "") {
  // If policyText is provided, attempt to extract company name from introductory text
  if (policyText) {
    const extracted = extractCompanyNameFromText(policyText);
    if (extracted) return extracted;
  } else if (
    sourceUrl &&
    (sourceUrl.includes("\n") ||
      (!sourceUrl.startsWith("http://") &&
        !sourceUrl.startsWith("https://") &&
        !sourceUrl.startsWith("PDF:") &&
        !sourceUrl.startsWith("Pasted text")))
  ) {
    const extracted = extractCompanyNameFromText(sourceUrl);
    if (extracted) return extracted;
  }

  if (!sourceUrl || typeof sourceUrl !== "string") return fallbackLabel;

  // Handle PDF uploads: "PDF: google-terms.pdf"
  if (sourceUrl.startsWith("PDF:")) {
    const rawName = sourceUrl.replace(/^PDF:\s*/i, "").trim();
    const nameWithoutExt = rawName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
    if (nameWithoutExt) {
      return nameWithoutExt.toUpperCase();
    }
    return fallbackLabel;
  }

  // Handle pasted text without throwing
  if (sourceUrl.startsWith("Pasted text")) {
    const candidate =
      policyText ||
      (typeof window !== "undefined" && window.lastPastedPolicyText) ||
      (typeof textInput !== "undefined" && textInput ? textInput.value : "");
    if (candidate) {
      const extracted = extractCompanyNameFromText(candidate);
      if (extracted) return extracted;
    }
    return fallbackLabel;
  }

  // Handle URLs
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length === 0) return fallbackLabel;
    if (parts.length === 1) return parts[0].toUpperCase();

    // Check for common second-level domain extensions (e.g. .co.uk, .com.au, .org.uk)
    const secondLevelTlds = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
    let brandIndex = parts.length - 2;
    if (parts.length >= 3 && secondLevelTlds.has(parts[parts.length - 2])) {
      brandIndex = parts.length - 3;
    }
    const brand = parts[brandIndex];

    // Special check for recognized Google products:
    // e.g. pay.google.com or pay.google.co.uk or /about/google-pay -> "GOOGLE PAY"
    if (brand === "google") {
      const subdomains = parts.slice(0, brandIndex);
      const isGooglePay =
        subdomains.includes("pay") ||
        /\b(?:google[-_]?pay|pay)\b/i.test(u.pathname);
      if (isGooglePay) {
        return "GOOGLE PAY";
      }
    }

    return brand ? brand.toUpperCase() : fallbackLabel;
  } catch {
    return fallbackLabel;
  }
}

// =========================================================================
// Multi-Vendor Stack & Session History
// =========================================================================

// =========================================================================
// Phase 8: Multi-Vendor Matrix, Portfolio Risk & Statutory LexCheck UI
// =========================================================================

const sessionVendorStack = [];

function addToVendorStack(report) {
  if (!report) return;

  // Preserve existing duplicate-prevention: do not add identical scan re-submits
  const isDuplicateScan = sessionVendorStack.some((item) => {
    if (item.sourceUrl && report.sourceUrl && item.sourceUrl === report.sourceUrl) {
      const itemFlags = item.analysis?.flags || [];
      const reportFlags = report.flags || [];
      if (itemFlags.length === reportFlags.length) {
        return itemFlags.every((f, idx) => f.title === reportFlags[idx]?.title && f.quote === reportFlags[idx]?.quote);
      }
    }
    return false;
  });
  if (isDuplicateScan) return;

  // Derive vendor name, inspecting available pasted policy text or preview
  const candidateText =
    report.policyText ||
    report.text ||
    (typeof window !== "undefined" && window.lastPastedPolicyText) ||
    (typeof textInput !== "undefined" && textInput ? textInput.value : "");
  let derivedName = extractCompanyName(report.sourceUrl, null, candidateText);
  if (!derivedName || derivedName === "the Service Provider") {
    derivedName = `Policy #${sessionVendorStack.length + 1}`;
  }

  // Ensure unique vendor name in stack so distinct scans don't collide in comparison matrix
  let vendorName = derivedName;
  let counter = 2;
  while (sessionVendorStack.some((v) => v.vendorName.toLowerCase() === vendorName.toLowerCase())) {
    vendorName = `${derivedName} (${counter})`;
    counter++;
  }

  sessionVendorStack.push({
    vendorName,
    sourceUrl: report.sourceUrl,
    analysis: report
  });
  if (sessionVendorStack.length > 10) sessionVendorStack.shift();
}

// Phase 9.4.4 Interactive Evidence-Grounded Q&A Module
function prepareQaDocumentClauses(report) {
  qaDocumentClauses = [];

  // Source 1: Segments from scanned report or pre-ingested PDF
  const candidateSegments = Array.isArray(report?.segments) && report.segments.length > 0
    ? report.segments
    : (Array.isArray(report?.clauses) && report.clauses.length > 0)
      ? report.clauses
      : (Array.isArray(window.lastIngestedDocument?.segments) && window.lastIngestedDocument.segments.length > 0)
        ? window.lastIngestedDocument.segments
        : null;

  if (candidateSegments) {
    const seenTexts = new Set();
    for (let idx = 0; idx < candidateSegments.length; idx++) {
      const s = candidateSegments[idx];
      const text = typeof s === "string" ? s.trim() : String(s?.text || s?.rawText || "").trim();
      if (!text) continue;

      const dedupeKey = text.slice(0, 120).toLowerCase();
      if (seenTexts.has(dedupeKey)) continue;
      seenTexts.add(dedupeKey);

      qaDocumentClauses.push({
        clauseId: String(s.clauseId || `clause_${s.segmentIndex != null ? s.segmentIndex + 1 : idx + 1}`),
        text,
        section: String(s.title || s.section || `Section ${idx + 1}`).trim(),
        category: String(s.clauseCategory || s.category || "").trim(),
        pageNumber: Number(s.pageNumber || 1)
      });

      if (qaDocumentClauses.length >= 250) break;
    }
  } else if (typeof (report?.policyText || window.lastPastedPolicyText) === "string" && (report?.policyText || window.lastPastedPolicyText).length >= 50) {
    // Source 2: Pasted policy text split into natural paragraphs
    const rawText = report?.policyText || window.lastPastedPolicyText;
    const rawParagraphs = rawText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const seenTexts = new Set();
    for (let idx = 0; idx < rawParagraphs.length; idx++) {
      const p = rawParagraphs[idx];
      const dedupeKey = p.slice(0, 120).toLowerCase();
      if (seenTexts.has(dedupeKey)) continue;
      seenTexts.add(dedupeKey);

      const firstLine = p.split("\n")[0].trim();
      const section = firstLine.length < 60 && /^[A-Z0-9\s:.-]+$/i.test(firstLine) ? firstLine : `Clause ${qaDocumentClauses.length + 1}`;
      qaDocumentClauses.push({
        clauseId: `clause_${qaDocumentClauses.length + 1}`,
        text: p,
        section,
        pageNumber: 1
      });

      if (qaDocumentClauses.length >= 250) break;
    }
  }

  // Source 3: Fallback red-flag quotes from report if no document segments or text available
  if (qaDocumentClauses.length === 0 && Array.isArray(report?.flags) && report.flags.length > 0) {
    qaDocumentClauses = report.flags.map((f, idx) => ({
      clauseId: String(f.clauseId || `flag_${idx + 1}`),
      text: f.quote || f.plainEnglish || f.whyItMatters || "",
      section: f.clauseType || f.title || `Finding ${idx + 1}`,
      category: f.clauseType || "",
      pageNumber: f.pageNumber || 1
    })).filter((c) => c.text && c.text.length > 0);
  }

  enableQaSection(qaDocumentClauses.length > 0);
}

function enableQaSection(enabled) {
  if (qaQuestionInput) {
    qaQuestionInput.disabled = !enabled;
  }
  if (qaSubmitBtn) {
    const hasValidLength = Boolean(qaQuestionInput && qaQuestionInput.value.trim().length >= 3);
    qaSubmitBtn.disabled = !enabled || !hasValidLength;
  }
  if (qaStatusBox && qaStatusText) {
    if (enabled) {
      qaStatusBox.className = "qa-status-box qa-status-idle";
      qaStatusText.textContent = "Ask a question about this Terms of Service. Your answer will be based only on the analyzed ToS evidence.";
    } else {
      qaStatusBox.className = "qa-status-box qa-status-disabled";
      qaStatusText.textContent = "Analyze a Terms of Service document first to ask questions about it.";
    }
  }
  if (!enabled && qaResultsContainer) {
    qaResultsContainer.classList.add("hidden");
    qaResultsContainer.innerHTML = "";
  }
}

function resetQaSection() {
  qaDocumentClauses = [];
  enableQaSection(false);
  if (qaQuestionInput) {
    qaQuestionInput.value = "";
  }
  if (qaCharCount) {
    qaCharCount.textContent = "0 / 500";
    qaCharCount.className = "qa-char-count";
  }
}

/**
 * Formats evidence similarity score for display.
 * Reads supported field names: similarityScore, similarity_score, similarity.
 * Preserves genuine 0% scores. Displays 'Similarity unavailable' for missing or invalid scores.
 *
 * @param {Object} item
 * @returns {string}
 */
function formatSimilarityScore(item) {
  if (!item || typeof item !== "object") return "Similarity unavailable";
  const raw = item.similarityScore ?? item.similarity_score ?? item.similarity;

  let scoreNum = null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    scoreNum = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("%")) {
      const parsedPct = Number(trimmed.slice(0, -1).trim());
      if (Number.isFinite(parsedPct)) {
        scoreNum = parsedPct / 100;
      }
    } else {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        scoreNum = parsed;
      }
    }
  }

  if (scoreNum === null) {
    return "Similarity unavailable";
  }

  const pct = (scoreNum > 1.0 && scoreNum <= 100) ? Math.round(scoreNum) : Math.round(scoreNum * 100);
  return `Similarity: ${pct}%`;
}

function renderQaResult(qa) {
  if (!qaResultsContainer) return;

  qaResultsContainer.innerHTML = "";
  qaResultsContainer.classList.remove("hidden");

  // Requirement 10: Graceful unavailable state banner if available === false
  if (qa.available === false) {
    const unavailableBanner = document.createElement("div");
    unavailableBanner.className = "qa-unavailable-banner";
    unavailableBanner.textContent = "AI Q&A is currently unavailable. Please review the highlighted ToS clauses directly.";
    qaResultsContainer.append(unavailableBanner);
  }

  // AI Answer card
  const card = document.createElement("article");
  card.className = "qa-answer-card";

  const head = document.createElement("header");
  head.className = "qa-answer-header";

  const title = document.createElement("h3");
  title.className = "qa-answer-title";
  title.textContent = "AI Answer";

  const badgeGroup = document.createElement("div");
  badgeGroup.className = "qa-badge-group";

  // Requirement 8: Grounded status indicator
  const groundedBadge = document.createElement("span");
  groundedBadge.className = `qa-grounded-badge ${qa.grounded ? "qa-grounded-true" : "qa-grounded-false"}`;
  groundedBadge.textContent = qa.grounded
    ? "✓ Grounded in your ToS"
    : "⚠ The supplied ToS evidence does not provide enough information.";
  badgeGroup.append(groundedBadge);

  // Requirement 7: Confidence % (e.g., Confidence: 95%)
  if (typeof qa.confidence === "number" && qa.confidence > 0) {
    const confBadge = document.createElement("span");
    confBadge.className = "qa-confidence-badge";
    confBadge.textContent = `Confidence: ${Math.round(qa.confidence * 100)}%`;
    badgeGroup.append(confBadge);
  }

  head.append(title, badgeGroup);
  card.append(head);

  // Requirement 7 & 13: Strictly XSS-safe textContent insertion for AI answer
  const answerP = document.createElement("p");
  answerP.className = "qa-answer-text";
  answerP.textContent = qa.answer || "No answer provided.";
  card.append(answerP);

  // Phase 3: Hugging Face NLI Validation Section
  // (cross-encoder/nli-deberta-v3-base independent factual verification)
  if (qa && qa.nliValidation && typeof qa.nliValidation === "object") {
    const nli = qa.nliValidation;
    const rawStatus = typeof nli.status === "string" ? nli.status.toLowerCase().trim() : "";

    let status = "unavailable";
    if (rawStatus === "supported" || rawStatus === "contradicted" || rawStatus === "uncertain" || rawStatus === "unavailable") {
      status = rawStatus;
    }

    const nliSection = document.createElement("section");
    nliSection.className = `qa-nli-section qa-nli-status-${status}`;
    nliSection.setAttribute("aria-label", "Independent NLI Verification");

    // Header: title, model badge, and primary status badge
    const nliHeader = document.createElement("div");
    nliHeader.className = "qa-nli-header";

    const nliTitleGroup = document.createElement("div");
    nliTitleGroup.className = "qa-nli-title-group";

    const nliTitle = document.createElement("h4");
    nliTitle.className = "qa-nli-title";
    nliTitle.textContent = "Independent NLI Verification";

    const nliModelTag = document.createElement("span");
    nliModelTag.className = "qa-nli-model-tag";
    nliModelTag.textContent = "cross-encoder/nli-deberta-v3-base";

    nliTitleGroup.append(nliTitle, nliModelTag);

    const nliBadge = document.createElement("span");
    nliBadge.className = `qa-nli-badge qa-nli-badge-${status}`;

    let statusLabel = "Validation unavailable";
    if (status === "supported") {
      statusLabel = "✓ Supported by ToS evidence";
    } else if (status === "contradicted") {
      statusLabel = "✕ Contradicted by ToS evidence";
    } else if (status === "uncertain") {
      statusLabel = "? Uncertain / Inconclusive";
    }
    nliBadge.textContent = statusLabel;

    nliHeader.append(nliTitleGroup, nliBadge);
    nliSection.append(nliHeader);

    const nliBody = document.createElement("div");
    nliBody.className = "qa-nli-body";

    if (status === "unavailable") {
      // For unavailable validation, show a concise explanation and NEVER fabricate scores
      const reasonP = document.createElement("p");
      reasonP.className = "qa-nli-reason";

      let reasonText = "Validation could not be completed for this answer.";
      if (typeof nli.reason === "string" && nli.reason.trim()) {
        const r = nli.reason.trim();
        if (r === "no_evidence_supplied") {
          reasonText = "No supporting clauses were available to validate against.";
        } else if (r === "nli_service_unavailable" || r === "nli_client_unavailable") {
          reasonText = "NLI validation service is temporarily offline.";
        } else if (r === "answer_generation_failed") {
          reasonText = "Answer generation failed; validation could not be performed.";
        } else if (r === "nli_validation_failed") {
          reasonText = "NLI validation encountered an unexpected processing error.";
        } else {
          reasonText = r;
        }
      }
      reasonP.textContent = reasonText;
      nliBody.append(reasonP);
    } else {
      // Display NLI scores ONLY when valid numeric scores are present
      const scores = nli.scores;
      const hasScores = scores && typeof scores === "object" &&
        typeof scores.entailment === "number" && !isNaN(scores.entailment) &&
        typeof scores.neutral === "number" && !isNaN(scores.neutral) &&
        typeof scores.contradiction === "number" && !isNaN(scores.contradiction);

      if (hasScores) {
        const scoresContainer = document.createElement("div");
        scoresContainer.className = "qa-nli-scores";

        const entPill = document.createElement("span");
        entPill.className = "qa-nli-score-pill qa-nli-score-entailment";
        entPill.textContent = `Entailment: ${Math.round(scores.entailment * 100)}%`;

        const neuPill = document.createElement("span");
        neuPill.className = "qa-nli-score-pill qa-nli-score-neutral";
        neuPill.textContent = `Neutral: ${Math.round(scores.neutral * 100)}%`;

        const conPill = document.createElement("span");
        conPill.className = "qa-nli-score-pill qa-nli-score-contradiction";
        conPill.textContent = `Contradiction: ${Math.round(scores.contradiction * 100)}%`;

        scoresContainer.append(entPill, neuPill, conPill);
        nliBody.append(scoresContainer);
      }

      // Display the best evidence clause identifier ONLY when present
      if (typeof nli.bestClauseId === "string" && nli.bestClauseId.trim()) {
        const clauseRow = document.createElement("div");
        clauseRow.className = "qa-nli-clause-row";

        const clauseLabel = document.createElement("span");
        clauseLabel.className = "qa-nli-clause-label";
        clauseLabel.textContent = "Best evidence clause:";

        const clauseCode = document.createElement("code");
        clauseCode.className = "qa-nli-clause-id";
        clauseCode.textContent = nli.bestClauseId.trim();

        clauseRow.append(clauseLabel, clauseCode);
        nliBody.append(clauseRow);
      }
    }

    nliSection.append(nliBody);
    card.append(nliSection);
  }

  // Requirement 9: Supporting Evidence section
  if (Array.isArray(qa.evidence) && qa.evidence.length > 0) {
    const evidenceSection = document.createElement("section");
    evidenceSection.className = "qa-evidence-section";

    const evidenceTitle = document.createElement("h4");
    evidenceTitle.className = "qa-evidence-title";
    evidenceTitle.textContent = "Supporting Evidence";
    evidenceSection.append(evidenceTitle);

    const evidenceList = document.createElement("div");
    evidenceList.className = "qa-evidence-list";

    qa.evidence.forEach((item) => {
      const itemCard = document.createElement("div");
      itemCard.className = "qa-evidence-item";

      const itemTop = document.createElement("div");
      itemTop.className = "qa-evidence-item-header";

      const secName = document.createElement("span");
      secName.className = "qa-evidence-section-name";
      secName.textContent = item.section || "Clause Context";

      const scoreBadge = document.createElement("span");
      scoreBadge.className = "qa-evidence-score";
      scoreBadge.textContent = formatSimilarityScore(item);

      itemTop.append(secName, scoreBadge);

      const quoteEl = document.createElement("blockquote");
      quoteEl.className = "qa-evidence-quote";
      quoteEl.textContent = `“${item.text || ""}”`;

      itemCard.append(itemTop, quoteEl);
      evidenceList.append(itemCard);
    });

    evidenceSection.append(evidenceList);
    card.append(evidenceSection);
  }

  qaResultsContainer.append(card);

  // Update status box
  if (qaStatusBox && qaStatusText) {
    qaStatusBox.className = "qa-status-box qa-status-ready";
    qaStatusText.textContent = "Answer generated based on analyzed ToS evidence.";
  }
}

function initQaSection() {
  if (!qaForm || !qaQuestionInput || !qaSubmitBtn) return;

  // Character counter and input validation
  qaQuestionInput.addEventListener("input", () => {
    const len = qaQuestionInput.value.length;
    if (qaCharCount) {
      qaCharCount.textContent = `${len} / 500`;
      if (len > 500) {
        qaCharCount.className = "qa-char-count char-limit-reached";
      } else if (len >= 450) {
        qaCharCount.className = "qa-char-count char-limit-near";
      } else {
        qaCharCount.className = "qa-char-count";
      }
    }

    const trimmed = qaQuestionInput.value.trim();
    if (!isQaSubmitting && qaDocumentClauses.length > 0) {
      qaSubmitBtn.disabled = trimmed.length < 3 || trimmed.length > 500;
    }
  });

  // Keyboard accessibility: Enter submits (Shift+Enter inserts newline)
  qaQuestionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!qaSubmitBtn.disabled) {
        qaForm.requestSubmit();
      }
    }
  });

  // Submit event handler
  qaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isQaSubmitting) return;

    const question = qaQuestionInput.value.trim();
    if (question.length < 3) {
      if (qaStatusBox && qaStatusText) {
        qaStatusBox.className = "qa-status-box qa-status-error";
        qaStatusText.textContent = "Question must be at least 3 characters long.";
      }
      return;
    }

    if (question.length > 500) {
      if (qaStatusBox && qaStatusText) {
        qaStatusBox.className = "qa-status-box qa-status-error";
        qaStatusText.textContent = "Question must not exceed 500 characters.";
      }
      return;
    }

    if (qaDocumentClauses.length === 0) {
      if (qaStatusBox && qaStatusText) {
        qaStatusBox.className = "qa-status-box qa-status-disabled";
        qaStatusText.textContent = "Analyze a Terms of Service document first to ask questions about it.";
      }
      return;
    }

    // Set loading state
    isQaSubmitting = true;
    qaSubmitBtn.disabled = true;
    qaQuestionInput.disabled = true;
    if (qaStatusBox && qaStatusText) {
      qaStatusBox.className = "qa-status-box qa-status-loading";
      qaStatusText.textContent = "Analyzing ToS evidence...";
    }

    try {
      const response = await apiFetch("/api/analyze/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          clauses: qaDocumentClauses
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data?.qa) {
        const errorMsg = data?.error || "We couldn't process that question. Please try again.";
        if (qaStatusBox && qaStatusText) {
          qaStatusBox.className = "qa-status-box qa-status-error";
          qaStatusText.textContent = errorMsg;
        }
        return;
      }

      renderQaResult(data.qa);
    } catch (err) {
      if (qaStatusBox && qaStatusText) {
        qaStatusBox.className = "qa-status-box qa-status-error";
        qaStatusText.textContent = "We couldn't process that question. Please try again.";
      }
    } finally {
      isQaSubmitting = false;
      qaQuestionInput.disabled = false;
      const trimmed = qaQuestionInput.value.trim();
      qaSubmitBtn.disabled = trimmed.length < 3 || trimmed.length > 500;
    }
  });
}

initQaSection();

/**
 * Backend Connection & Authentication Settings Controller (Phase 8C.4B).
 */
function initSettingsModal() {
  const modal = document.querySelector("#settings-modal");
  const openBtn = document.querySelector("#btn-open-settings");
  const closeBtn = document.querySelector("#btn-settings-close-x");
  const saveBtn = document.querySelector("#btn-settings-save");
  const testBtn = document.querySelector("#btn-settings-test");
  const resetBtn = document.querySelector("#btn-settings-reset");
  const toggleTokenBtn = document.querySelector("#settings-toggle-token");
  const urlInput = document.querySelector("#settings-backend-url");
  const tokenInput = document.querySelector("#settings-bearer-token");
  const statusBox = document.querySelector("#settings-status-box");
  const authBanner = document.querySelector("#auth-alert-banner");
  const alertOpenBtn = document.querySelector("#btn-auth-alert-open");
  const settingsForm = document.querySelector("#settings-form");

  if (!modal) return;

  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
    });
  }

  function setStatus(message, type = "info") {
    if (!statusBox) return;
    statusBox.className = `settings-status-card status-${type}`;
    statusBox.textContent = message;
    statusBox.classList.remove("hidden");
  }

  function clearStatus() {
    if (!statusBox) return;
    statusBox.className = "settings-status-card hidden";
    statusBox.textContent = "";
  }

  function openSettings() {
    const config = getStoredConfig();
    if (urlInput) urlInput.value = config.backendUrl || "";
    if (tokenInput) tokenInput.value = config.token || "";
    clearStatus();
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
    urlInput?.focus();
  }

  function closeSettings() {
    modal.classList.add("hidden");
    modal.setAttribute("hidden", "true");
  }

  if (openBtn) openBtn.addEventListener("click", openSettings);
  if (alertOpenBtn) alertOpenBtn.addEventListener("click", openSettings);
  if (closeBtn) closeBtn.addEventListener("click", closeSettings);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeSettings();
  });

  if (toggleTokenBtn && tokenInput) {
    toggleTokenBtn.addEventListener("click", () => {
      const isPassword = tokenInput.type === "password";
      tokenInput.type = isPassword ? "text" : "password";
      toggleTokenBtn.textContent = isPassword ? "Hide" : "Show";
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const backendUrl = urlInput?.value?.trim() || "";
      const token = tokenInput?.value?.trim() || "";

      const res = saveStoredConfig({ backendUrl, token });
      if (!res.ok) {
        setStatus(`Error: ${res.error}`, "error");
        return;
      }

      setStatus("Configuration saved successfully.", "success");
      if (authBanner) authBanner.classList.add("hidden");
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const backendUrl = urlInput?.value?.trim() || "";
      const token = tokenInput?.value?.trim() || "";

      setStatus("Testing connection to backend...", "warning");
      testBtn.disabled = true;

      try {
        const result = await testBackendConnection({ backendUrl, token });
        if (result.code === "AUTH_SUCCESS") {
          setStatus("Connected: Backend reachable and Bearer Token verified successfully.", "success");
          if (authBanner) authBanner.classList.add("hidden");
        } else if (result.code === "REACHABLE") {
          setStatus("Connected: Backend reachable (Authentication is disabled on this backend).", "success");
          if (authBanner) authBanner.classList.add("hidden");
        } else if (result.code === "AUTH_REQUIRED") {
          setStatus("Backend reachable, but API authentication is enabled. Please enter a valid Bearer Token.", "warning");
        } else if (result.code === "AUTH_INVALID") {
          setStatus("Authentication failed (HTTP 401). The supplied Bearer Token was rejected.", "error");
        } else if (result.code === "CORS_BLOCKED") {
          setStatus("CORS Forbidden (HTTP 403). Backend rejected request origin.", "error");
        } else {
          setStatus(`Connection failed: ${result.message}`, "error");
        }
      } catch (err) {
        setStatus(`Test failed: ${err.message}`, "error");
      } finally {
        testBtn.disabled = false;
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetStoredConfig();
      if (urlInput) urlInput.value = "";
      if (tokenInput) tokenInput.value = "";
      setStatus("Reset to default same-origin / localhost.", "success");
    });
  }

  // Global listener for 401 Unauthorized responses dispatched by apiFetch
  if (typeof window !== "undefined") {
    window.addEventListener("tos:auth_required", () => {
      if (authBanner) {
        authBanner.classList.remove("hidden");
      }
    });
  }
}

initSettingsModal();

/* ==============================================================================
   Analyze View Controller (Single-Page Mode)
   ============================================================================== */

function initSaaSViews() {
  const viewAnalyze = document.querySelector("#view-analyze");
  if (viewAnalyze) {
    viewAnalyze.classList.remove("hidden");
  }
}

initSaaSViews();

export { extractCompanyName, extractCompanyNameFromText, addToVendorStack, sessionVendorStack, renderQaResult, formatSimilarityScore, initSaaSViews };
