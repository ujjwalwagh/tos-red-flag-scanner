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
const readabilityEl = document.querySelector("#readability");
const resultsEl = document.querySelector("#results");
const scanBtn = document.querySelector("#scan-btn");
const cursorGlow = document.querySelector("#cursor-glow");
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

window.addEventListener("mousemove", (event) => {
  if (cursorGlow) {
    cursorGlow.style.left = `${event.clientX}px`;
    cursorGlow.style.top = `${event.clientY}px`;
  }
});

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
  clearReadability();

  try {
    const scanMode = getSelectedScanMode();
    const userPreferences = {
      ARBITRATION: Number(document.getElementById("pref-arbitration")?.value || 5),
      PRIVACY_DATA_SHARING: Number(document.getElementById("pref-privacy")?.value || 5),
      AUTO_RENEWAL: Number(document.getElementById("pref-subscription")?.value || 4),
      USER_CONTENT_RIGHTS: Number(document.getElementById("pref-content")?.value || 4)
    };
    let response;
    if (file) {
      const formData = new FormData();
      formData.append("policyFile", file);
      formData.append("scanMode", scanMode);
      formData.append("userPreferences", JSON.stringify(userPreferences));
      response = await apiFetch("/api/scan", {
        method: "POST",
        body: formData
      });
    } else {
      const payload = url ? { url, scanMode, userPreferences } : { policyText, scanMode, userPreferences };
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
  renderReadability(report.readability);
  renderComplianceSection(report);
  renderBenchmarkSection(report);
  renderActionChecklist(report);
  renderExportBar(report);
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

    // Category normalization & optional payment detection
    const normCategory = String(flag.clauseType || flag.category || flag.categoryId || "").toUpperCase();
    const isOptionalPayment =
      flag.title === "Optional Recurring Payment Feature" ||
      /\boptional\s+recurring\s+payment\b/i.test(flag.title || "") ||
      (normCategory.includes("RENEWAL") && /\boptional\b/i.test(flag.title || ""));

    // Counter-proposal amendment action (suppressed for optional payment features)
    if (!isOptionalPayment) {
      const amendBtn = document.createElement("button");
      amendBtn.type = "button";
      amendBtn.className = "btn-action-amendment";
      amendBtn.textContent = "Propose Amendment";
      amendBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAmendmentModal({
          category: normCategory || flag.categoryId || flag.category || "OTHER",
          evidence: flag.quote || flag.evidence || "",
          findingTitle: flag.title || "",
          companyName: extractCompanyName(report.sourceUrl)
        });
      });
      card.append(amendBtn);
    }

    // Actionable opt-out notice trigger on eligible clauses (suppressed for optional payment features)
    if (
      !isOptionalPayment &&
      (normCategory.includes("ARBITRATION") ||
        normCategory.includes("CLASS_ACTION") ||
        normCategory.includes("DATA") ||
        normCategory.includes("SHARING") ||
        normCategory.includes("SUBSCRIPTION") ||
        normCategory.includes("RENEWAL"))
    ) {
      const optOutBtn = document.createElement("button");
      optOutBtn.type = "button";
      optOutBtn.className = "btn-action-optout";
      optOutBtn.textContent = "Draft Opt-Out Notice";
      optOutBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openOptOutModal({
          category: normCategory,
          evidence: flag.quote || flag.evidence || "",
          findingTitle: flag.title || "",
          title: flag.title || "",
          companyName: extractCompanyName(report.sourceUrl)
        });
      });
      card.append(optOutBtn);
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
  const modeLabel = report.scanMode === "strict" ? "strict" : "broad";
  label.textContent = `Overall risk profile: ${riskLevel.toUpperCase()} (mode: ${modeLabel})`;

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
  const complianceEl = document.querySelector("#compliance-section");
  if (complianceEl) {
    complianceEl.classList.add("hidden");
    complianceEl.innerHTML = "";
  }
  const benchmarkEl = document.querySelector("#benchmark-section");
  if (benchmarkEl) {
    benchmarkEl.classList.add("hidden");
    benchmarkEl.innerHTML = "";
  }
  const matrixEl = document.querySelector("#matrix-section");
  if (matrixEl) {
    matrixEl.classList.add("hidden");
    matrixEl.innerHTML = "";
  }
  const portfolioEl = document.querySelector("#portfolio-section");
  if (portfolioEl) {
    portfolioEl.classList.add("hidden");
    portfolioEl.innerHTML = "";
  }
  const driftEl = document.querySelector("#drift-section");
  if (driftEl) {
    driftEl.classList.add("hidden");
    driftEl.innerHTML = "";
  }
  const checklistEl = document.querySelector("#checklist-section");
  if (checklistEl) {
    checklistEl.classList.add("hidden");
    checklistEl.innerHTML = "";
  }
  const exportBarEl = document.querySelector("#export-bar");
  if (exportBarEl) {
    exportBarEl.classList.add("hidden");
  }
  resetQaSection();
}

function clearSummary() {
  summaryEl.classList.add("hidden");
  summaryEl.innerHTML = "";
}

function clearReadability() {
  readabilityEl.classList.add("hidden");
  readabilityEl.innerHTML = "";
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

function renderReadability(readability) {
  if (!readability) return;

  readabilityEl.classList.remove("hidden");
  const strip = document.createElement("div");
  strip.className = "summary-strip";

  const label = document.createElement("div");
  label.className = "summary-label";
  label.innerHTML = `<strong>Legalese level:</strong> ${escapeHtml(readability.level)} (${readability.score}/100)`;

  const warning = document.createElement("div");
  warning.className = "summary-label";
  warning.textContent = readability.warning || "";

  strip.append(label, warning);
  readabilityEl.append(strip);
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
      playPromise.catch(() => {});
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
    { phrase: "i accept everything", message: "Skeptic mode suggested. Switched to strict." },
    { phrase: "no red flags", message: "Bold claim detected. Double-check every clause." }
  ];

  textInput.addEventListener("input", () => {
    const value = textInput.value.toLowerCase();
    for (const trigger of triggers) {
      if (!value.includes(trigger.phrase)) continue;
      if (textInput.dataset.lastEgg === trigger.phrase) continue;
      textInput.dataset.lastEgg = trigger.phrase;

      const strictRadio = document.querySelector('input[name="scanMode"][value="strict"]');
      if (strictRadio) {
        strictRadio.checked = true;
      }

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

function getSelectedScanMode() {
  const checked = document.querySelector('input[name="scanMode"]:checked');
  return checked?.value === "strict" ? "strict" : "broad";
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
  const notes = document.querySelectorAll(".note");
  notes.forEach((note) => enableDrag(note));
}

function enableDrag(element) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let offsetX = Number(element.dataset.dx || 0);
  let offsetY = Number(element.dataset.dy || 0);

  element.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".react-btn")) {
      return;
    }
    dragging = true;
    element.classList.add("dragging");
    startX = event.clientX - offsetX;
    startY = event.clientY - offsetY;
    element.setPointerCapture(event.pointerId);
  });

  element.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    offsetX = event.clientX - startX;
    offsetY = event.clientY - startY;
    element.dataset.dx = String(offsetX);
    element.dataset.dy = String(offsetY);
    applyDragTransform(element, offsetX, offsetY);
  });

  const release = () => {
    dragging = false;
    element.classList.remove("dragging");
  };

  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
}

function applyDragTransform(element, x, y) {
  const hasRotate = /rotate\([^)]*\)/.test(element.style.transform);
  if (hasRotate) {
    element.style.transform = element.style.transform.replace(
      /translate\([^)]*\)/,
      ""
    );
    element.style.transform += ` translate(${x}px, ${y}px)`;
    return;
  }

  const rotate = element.classList.contains("note")
    ? element.style.transform || ""
    : "";
  element.style.transform = `${rotate} translate(${x}px, ${y}px)`.trim();
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

async function renderActionChecklist(report) {
  const checklistSection = document.querySelector("#checklist-section");
  if (!checklistSection) return;

  checklistSection.innerHTML = "";

  // Derive findings to build checklist
  const findings = report.flags || report.rankedFindings || [];
  if (findings.length === 0) {
    checklistSection.classList.add("hidden");
    return;
  }

  try {
    const res = await apiFetch("/api/remediation/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedFindings: findings,
        companyName: extractCompanyName(report.sourceUrl)
      })
    });

    if (!res.ok) return;
    const data = await res.json();
    const checklist = data.checklist;

    if (!checklist || !checklist.items || checklist.items.length === 0) {
      checklistSection.classList.add("hidden");
      return;
    }

    checklistSection.classList.remove("hidden");

    const header = document.createElement("div");
    header.className = "checklist-title";
    header.innerHTML = `<span>🛡️ Actionable Pre-Agreement Checklist</span> <span class="checklist-count-badge">(${checklist.summary.totalItems} recommended steps)</span>`;

    const list = document.createElement("ul");
    list.className = "checklist-list";

    for (const item of checklist.items) {
      const entry = document.createElement("li");
      entry.className = "checklist-entry";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "checklist-checkbox";
      cb.addEventListener("change", () => {
        entry.style.opacity = cb.checked ? "0.4" : "1";
      });

      const content = document.createElement("div");
      content.className = "checklist-content";

      const topRow = document.createElement("div");
      topRow.innerHTML = `
        <span class="checklist-entry-title">${escapeHtml(item.title)}</span>
        <span class="checklist-urgency-badge urgency-${String(item.urgency).toLowerCase()}">${escapeHtml(item.urgency)}</span>
      `;

      const actionText = document.createElement("div");
      actionText.className = "checklist-entry-action";
      actionText.textContent = item.action;

      content.append(topRow, actionText);

      if (item.hasRemediationLetter) {
        const letterBtn = document.createElement("button");
        letterBtn.type = "button";
        letterBtn.className = "btn-action-optout";
        letterBtn.textContent = "✉️ Draft Formal Opt-Out Notice";
        letterBtn.addEventListener("click", () => {
          openOptOutModal({
            category: item.categoryId,
            evidence: item.evidence,
            companyName: extractCompanyName(report.sourceUrl)
          });
        });
        content.append(letterBtn);
      }

      entry.append(cb, content);
      list.append(entry);
    }

    checklistSection.append(header, list);
  } catch (err) {
    console.warn("Could not load checklist:", err);
  }
}

function renderExportBar(report) {
  const exportBar = document.querySelector("#export-bar");
  if (!exportBar) return;

  exportBar.classList.remove("hidden");

  const mdBtn = document.querySelector("#btn-export-md");
  const jsonBtn = document.querySelector("#btn-export-json");
  const printBtn = document.querySelector("#btn-export-print");

  if (mdBtn) {
    mdBtn.addEventListener("click", async () => {
      try {
        const res = await apiFetch("/api/export/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysis: {
              summary: {
                overallRisk: report.overallRisk,
                totalFindings: report.flags?.length || 0,
                bySeverity: {}
              },
              rankedFindings: report.flags || [],
              documentMetadata: { filename: report.sourceUrl || "policy" }
            },
            format: "markdown",
            documentTitle: report.sourceUrl || "Terms of Service"
          })
        });
        const data = await res.json();
        if (data.content) {
          downloadFile(data.content, "ClauseGuard-Audit.md", "text/markdown");
        }
      } catch (err) {
        alert("Export failed: " + err.message);
      }
    });
  }

  if (jsonBtn) {
    jsonBtn.addEventListener("click", async () => {
      try {
        const res = await apiFetch("/api/export/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysis: {
              summary: {
                overallRisk: report.overallRisk,
                totalFindings: report.flags?.length || 0
              },
              rankedFindings: report.flags || [],
              documentMetadata: { filename: report.sourceUrl || "policy" }
            },
            format: "json",
            documentTitle: report.sourceUrl || "Terms of Service"
          })
        });
        const data = await res.json();
        if (data.content) {
          downloadFile(JSON.stringify(data.content, null, 2), "ClauseGuard-Audit.json", "application/json");
        }
      } catch (err) {
        alert("Export failed: " + err.message);
      }
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", async () => {
      try {
        const res = await apiFetch("/api/export/report?raw=true", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysis: {
              summary: {
                overallRisk: report.overallRisk,
                totalFindings: report.flags?.length || 0
              },
              rankedFindings: report.flags || [],
              documentMetadata: { filename: report.sourceUrl || "policy" }
            },
            format: "html",
            documentTitle: report.sourceUrl || "Terms of Service"
          })
        });
        const html = await res.text();
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
        }
      } catch (err) {
        alert("Print generation failed: " + err.message);
      }
    });
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openOptOutModal(params = {}) {
  activeOptOutParams = params;
  const modal = document.querySelector("#optout-modal");
  if (!modal) return;

  const companyInput = document.querySelector("#optout-company-name");
  if (companyInput && params.companyName) {
    companyInput.value = params.companyName;
  }

  modal.classList.remove("hidden");
  modal.removeAttribute("hidden");
  regenerateOptOutLetter();
}

async function regenerateOptOutLetter() {
  if (!activeOptOutParams) return;

  const userName = document.querySelector("#optout-user-name")?.value || "";
  const userEmail = document.querySelector("#optout-user-email")?.value || "";
  const accountNumber = document.querySelector("#optout-account-id")?.value || "";
  const companyName = document.querySelector("#optout-company-name")?.value || activeOptOutParams.companyName || "";

  try {
    const res = await apiFetch("/api/remediation/opt-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remediationType: activeOptOutParams.category || "ARBITRATION",
        companyName,
        clauseEvidence: activeOptOutParams.evidence || "",
        findingTitle: activeOptOutParams.findingTitle || activeOptOutParams.title || "",
        userMetadata: { userName, userEmail, accountNumber }
      })
    });

    const data = await res.json();
    if (data.notice) {
      const textarea = document.querySelector("#optout-letter-text");
      const instructions = document.querySelector("#optout-instructions");
      if (textarea) textarea.value = data.notice.body;
      if (instructions && data.notice.deliveryInstructions) {
        instructions.innerHTML = `<strong>Delivery Advice:</strong><ul>${data.notice.deliveryInstructions.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
      }
    } else if (data.error) {
      const textarea = document.querySelector("#optout-letter-text");
      if (textarea) textarea.value = `Notice could not be generated: ${data.error}`;
      const instructions = document.querySelector("#optout-instructions");
      if (instructions) instructions.innerHTML = `<span class="text-red-400">${escapeHtml(data.error)}</span>`;
    }
  } catch (err) {
    console.error("Failed to generate letter:", err);
  }
}

function initOptOutModal() {
  const modal = document.querySelector("#optout-modal");
  const closeBtn = document.querySelector("#btn-close-modal");
  const doneBtn = document.querySelector("#btn-modal-done");
  const copyBtn = document.querySelector("#btn-copy-letter");
  const regenerateBtn = document.querySelector("#btn-generate-letter");

  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (modal) {
      if (modal.classList.contains("hidden") && modal.hasAttribute("hidden")) return;
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  };

  if (closeBtn) closeBtn.addEventListener("click", close);
  if (doneBtn) doneBtn.addEventListener("click", close);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close(e);
    });
  }

  if (regenerateBtn) {
    regenerateBtn.addEventListener("click", regenerateOptOutLetter);
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const textarea = document.querySelector("#optout-letter-text");
      if (textarea && textarea.value) {
        navigator.clipboard.writeText(textarea.value).then(() => {
          copyBtn.textContent = "✅ Copied!";
          setTimeout(() => {
            copyBtn.textContent = "📋 Copy to Clipboard";
          }, 2000);
        });
      }
    });
  }
}

window.openOptOutModal = openOptOutModal;
initOptOutModal();

// =========================================================================
// Phase 7: FairTerms Comparative Benchmarking & Negotiation Riders UI
// =========================================================================

let activeAmendmentParams = null;
let activePosture = "BALANCED";
let selectedRiderAmendments = [];

function updateRiderCount() {
  const countEl = document.querySelector("#rider-count");
  if (countEl) countEl.textContent = String(selectedRiderAmendments.length);
}

async function renderBenchmarkSection(report) {
  const benchmarkEl = document.querySelector("#benchmark-section");
  if (!benchmarkEl) return;

  benchmarkEl.innerHTML = "";
  let benchmarks = report.benchmarks;

  // If benchmarks were not pre-calculated in pipeline, evaluate on demand
  if (!benchmarks) {
    try {
      const res = await apiFetch("/api/benchmarks/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findings: report.flags || report.rankedFindings || [],
          sector: "GENERAL"
        })
      });
      if (res.ok) {
        const data = await res.json();
        benchmarks = data.benchmarks;
      }
    } catch (err) {
      console.warn("Could not evaluate benchmarks:", err);
    }
  }

  if (!benchmarks) {
    benchmarkEl.classList.add("hidden");
    return;
  }

  benchmarkEl.classList.remove("hidden");

  const standingClass = `standing-${String(benchmarks.relativeStanding || "standard").toLowerCase()}`;
  const standingBadge = benchmarks.relativeStanding ? benchmarks.relativeStanding.replace("_", " ") : "Standard";

  const container = document.createElement("div");
  container.className = "benchmark-container";

  container.innerHTML = `
    <div class="benchmark-banner">
      <div class="benchmark-score-col">
        <div class="benchmark-circle-metric">
          <span class="benchmark-circle-score">${benchmarks.restrictivenessScore || 0}</span>
          <span class="benchmark-circle-label">Index / 100</span>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-bold text-white">Comparative Vendor Restrictiveness</h3>
            <span class="benchmark-standing-badge ${standingClass}">${escapeHtml(standingBadge)}</span>
          </div>
          <p class="text-xs text-neutral-300 mt-1">${escapeHtml(benchmarks.comparisonStatement || "")}</p>
          <span class="text-[11px] text-neutral-400">Benchmarked against empirical <strong>${escapeHtml(benchmarks.sectorDisplayName || benchmarks.sector || "Industry Baseline")}</strong> corpus.</span>
        </div>
      </div>
    </div>

    ${
      benchmarks.domainBreakdown
        ? `
      <div class="benchmark-domains-grid">
        <div class="benchmark-domain-card">
          <div class="benchmark-domain-title">Dispute Resolution</div>
          <div class="benchmark-domain-status">${escapeHtml(benchmarks.domainBreakdown.disputeResolution?.status || "Standard")}</div>
          <div class="benchmark-domain-rate">${escapeHtml(benchmarks.domainBreakdown.disputeResolution?.industryPrevalence || "")}</div>
        </div>
        <div class="benchmark-domain-card">
          <div class="benchmark-domain-title">Content & IP Rights</div>
          <div class="benchmark-domain-status">${escapeHtml(benchmarks.domainBreakdown.contentRights?.status || "Standard")}</div>
          <div class="benchmark-domain-rate">${escapeHtml(benchmarks.domainBreakdown.contentRights?.industryPrevalence || "")}</div>
        </div>
        <div class="benchmark-domain-card">
          <div class="benchmark-domain-title">Data Privacy & Sharing</div>
          <div class="benchmark-domain-status">${escapeHtml(benchmarks.domainBreakdown.dataPrivacy?.status || "Standard")}</div>
          <div class="benchmark-domain-rate">${escapeHtml(benchmarks.domainBreakdown.dataPrivacy?.industryPrevalence || "")}</div>
        </div>
        <div class="benchmark-domain-card">
          <div class="benchmark-domain-title">Billing & Renewals</div>
          <div class="benchmark-domain-status">${escapeHtml(benchmarks.domainBreakdown.billingPractices?.status || "Standard")}</div>
          <div class="benchmark-domain-rate">${escapeHtml(benchmarks.domainBreakdown.billingPractices?.industryPrevalence || "")}</div>
        </div>
      </div>
    `
        : ""
    }

    ${
      Array.isArray(benchmarks.outliers) && benchmarks.outliers.length > 0
        ? `
      <div class="benchmark-outliers-box">
        <h4 class="text-xs font-bold text-red-400 mb-1">⚠️ Outlier Restrictiveness Warnings:</h4>
        <ul class="text-xs text-red-200 list-disc pl-4 space-y-0.5">
          ${benchmarks.outliers.map(o => `<li>${escapeHtml(o)}</li>`).join("")}
        </ul>
      </div>
    `
        : ""
    }
  `;

  benchmarkEl.append(container);
}

function openAmendmentModal(params = {}) {
  activeAmendmentParams = params;
  activePosture = "BALANCED";

  const modal = document.querySelector("#amendment-modal");
  if (!modal) return;

  // Reset posture buttons
  document.querySelectorAll(".btn-posture").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.posture === "BALANCED");
  });

  const subtitle = document.querySelector("#amendment-subtitle");
  if (subtitle && params.category) {
    subtitle.textContent = `Balanced counter-proposal for ${params.category.replace(/_/g, " ")}`;
  }

  modal.classList.remove("hidden");
  modal.removeAttribute("hidden");
  fetchAndRenderAmendment();
}

async function fetchAndRenderAmendment() {
  if (!activeAmendmentParams) return;

  const diffEl = document.querySelector("#redline-diff-content");
  const statsEl = document.querySelector("#diff-stats");
  const proposedTextarea = document.querySelector("#proposed-clause-text");
  const pointsList = document.querySelector("#talking-points-list");
  const fallbackText = document.querySelector("#fallback-text");
  const addBtn = document.querySelector("#btn-add-to-rider");

  if (diffEl) diffEl.innerHTML = `<span class="text-neutral-400">Generating balanced counter-proposal and redline diff...</span>`;

  try {
    const res = await apiFetch("/api/negotiation/amendment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: activeAmendmentParams.category || "OTHER",
        clauseText: activeAmendmentParams.evidence || "",
        posture: activePosture,
        companyName: activeAmendmentParams.companyName || "Service Provider"
      })
    });

    if (!res.ok) throw new Error("Failed to generate amendment proposal.");
    const data = await res.json();
    const amendment = data.amendment;

    activeAmendmentParams.currentAmendment = amendment;

    if (diffEl) {
      diffEl.innerHTML = amendment.redline?.htmlDiff || escapeHtml(amendment.proposedAmendment);
    }

    if (statsEl && amendment.redline?.stats) {
      const s = amendment.redline.stats;
      statsEl.textContent = `+${s.wordsAdded} added / -${s.wordsRemoved} deleted (${s.wordsUnchanged} kept)`;
    }

    if (proposedTextarea) {
      proposedTextarea.value = amendment.proposedAmendment || "";
    }

    if (pointsList) {
      pointsList.innerHTML = (amendment.talkingPoints || [])
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join("");
    }

    if (fallbackText) {
      fallbackText.textContent = amendment.fallbackAlternative || "Standard good-faith mutual escalation.";
    }

    if (addBtn) {
      const alreadyAdded = selectedRiderAmendments.some(a => a.categoryId === amendment.categoryId);
      addBtn.textContent = alreadyAdded ? "✅ Added to Rider" : "➕ Add to Contract Rider";
      addBtn.disabled = alreadyAdded;
    }
  } catch (err) {
    if (diffEl) diffEl.innerHTML = `<span class="text-red-400">Error: ${escapeHtml(err.message)}</span>`;
  }
}

function initAmendmentModal() {
  const modal = document.querySelector("#amendment-modal");
  const closeBtn = document.querySelector("#btn-close-amendment");
  const doneBtn = document.querySelector("#btn-amendment-done");
  const copyBtn = document.querySelector("#btn-copy-amendment-text");
  const addBtn = document.querySelector("#btn-add-to-rider");

  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (modal) {
      if (modal.classList.contains("hidden") && modal.hasAttribute("hidden")) return;
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  };

  if (closeBtn) closeBtn.addEventListener("click", close);
  if (doneBtn) doneBtn.addEventListener("click", close);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close(e);
    });
  }

  // Posture selector buttons
  document.querySelectorAll(".btn-posture").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-posture").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activePosture = btn.dataset.posture || "BALANCED";
      fetchAndRenderAmendment();
    });
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const textarea = document.querySelector("#proposed-clause-text");
      if (textarea && textarea.value) {
        navigator.clipboard.writeText(textarea.value).then(() => {
          copyBtn.textContent = "✅ Copied!";
          setTimeout(() => {
            copyBtn.textContent = "📋 Copy Clause";
          }, 2000);
        });
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (activeAmendmentParams?.currentAmendment) {
        const item = activeAmendmentParams.currentAmendment;
        const exists = selectedRiderAmendments.some(a => a.categoryId === item.categoryId);
        if (!exists) {
          selectedRiderAmendments.push(item);
          updateRiderCount();
          addBtn.textContent = "✅ Added to Rider";
          addBtn.disabled = true;
        }
      }
    });
  }
}

async function openRiderModal() {
  const modal = document.querySelector("#rider-modal");
  if (!modal) return;

  if (selectedRiderAmendments.length === 0) {
    alert("No amendments added yet. Click '⚖️ Propose Fair Amendment' on any clause to add clauses to your rider.");
    return;
  }

  modal.classList.remove("hidden");
  modal.removeAttribute("hidden");
  await compileAndRenderRider();
}

async function compileAndRenderRider() {
  const vendorInput = document.querySelector("#rider-vendor-name");
  const userInput = document.querySelector("#rider-user-name");
  const titleInput = document.querySelector("#rider-agreement-title");
  const dateInput = document.querySelector("#rider-effective-date");
  const textarea = document.querySelector("#rider-markdown-text");
  const countSpan = document.querySelector("#rider-clause-count");

  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }

  const companyName = vendorInput?.value || "Service Provider";
  const counterpartyName = userInput?.value || "User";
  const agreementTitle = titleInput?.value || "Terms of Service";
  const effectiveDate = dateInput?.value || "";

  if (textarea) textarea.value = "Compiling unified Contract Amendment Rider...";

  try {
    const res = await apiFetch("/api/negotiation/rider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amendments: selectedRiderAmendments,
        companyName,
        counterpartyName,
        agreementTitle,
        effectiveDate
      })
    });

    if (!res.ok) throw new Error("Failed to compile contract rider.");
    const data = await res.json();
    const rider = data.rider;

    if (textarea) textarea.value = rider.markdown || "";
    if (countSpan) countSpan.textContent = `${rider.clauseCount} clause ${rider.clauseCount === 1 ? "amendment" : "amendments"} included`;
  } catch (err) {
    if (textarea) textarea.value = `Error compiling rider: ${err.message}`;
  }
}

function initRiderModal() {
  const modal = document.querySelector("#rider-modal");
  const closeBtn = document.querySelector("#btn-close-rider");
  const doneBtn = document.querySelector("#btn-rider-done");
  const exportRiderBtn = document.querySelector("#btn-export-rider");
  const copyBtn = document.querySelector("#btn-copy-rider");
  const downloadBtn = document.querySelector("#btn-download-rider");

  const close = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (modal) {
      if (modal.classList.contains("hidden") && modal.hasAttribute("hidden")) return;
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  };

  if (closeBtn) closeBtn.addEventListener("click", close);
  if (doneBtn) doneBtn.addEventListener("click", close);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close(e);
    });
  }

  if (exportRiderBtn) {
    exportRiderBtn.addEventListener("click", openRiderModal);
  }

  // Auto-recompile rider when metadata changes
  const vendorInput = document.querySelector("#rider-vendor-name");
  const userInput = document.querySelector("#rider-user-name");
  const titleInput = document.querySelector("#rider-agreement-title");
  const dateInput = document.querySelector("#rider-effective-date");

  [vendorInput, userInput, titleInput, dateInput].forEach((inp) => {
    if (inp) inp.addEventListener("change", compileAndRenderRider);
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const textarea = document.querySelector("#rider-markdown-text");
      if (textarea && textarea.value) {
        navigator.clipboard.writeText(textarea.value).then(() => {
          copyBtn.textContent = "✅ Copied!";
          setTimeout(() => {
            copyBtn.textContent = "📋 Copy Markdown";
          }, 2000);
        });
      }
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const textarea = document.querySelector("#rider-markdown-text");
      if (textarea && textarea.value) {
        downloadFile(textarea.value, "Contract-Amendment-Rider.md", "text/markdown");
      }
    });
  }
}

window.openAmendmentModal = openAmendmentModal;
window.openRiderModal = openRiderModal;

initAmendmentModal();
initRiderModal();

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

async function renderComplianceSection(report) {
  const compEl = document.querySelector("#compliance-section");
  if (!compEl) return;

  compEl.innerHTML = "";
  let compliance = report.compliance;

  const targetJurisdiction = document.querySelector("#pref-jurisdiction")?.value || "US_FEDERAL";

  // If compliance was not pre-calculated or needs update for selected jurisdiction
  if (!compliance || compliance.jurisdiction !== targetJurisdiction) {
    try {
      const res = await apiFetch("/api/compliance/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findings: report.flags || report.rankedFindings || [],
          jurisdiction: targetJurisdiction,
          sourceUrl: report.sourceUrl || "",
          policyText: report.policyText || report.text || (typeof window !== "undefined" && window.lastPastedPolicyText) || ""
        })
      });
      if (res.ok) {
        const data = await res.json();
        compliance = data.compliance;
      }
    } catch (err) {
      console.warn("Could not audit compliance:", err);
    }
  }

  if (!compliance || !compliance.statutoryAlerts || compliance.statutoryAlerts.length === 0) {
    compEl.classList.add("hidden");
    return;
  }

  compEl.classList.remove("hidden");

  const banner = document.createElement("div");
  banner.className = "compliance-banner";

  banner.innerHTML = `
    <div class="flex justify-between items-center flex-wrap gap-2 mb-2">
      <div>
        <h3 class="text-sm font-bold text-purple-200">⚖️ Jurisdictional Compliance Audit ("LexCheck")</h3>
        <span class="text-xs text-purple-300/80">Evaluated against <strong>${escapeHtml(compliance.jurisdictionDisplayName || compliance.jurisdiction)}</strong></span>
      </div>
      <span class="badge badge-statutory">${escapeHtml(compliance.complianceStanding.replace(/_/g, " "))}</span>
    </div>
    ${
      compliance.applicabilityNotice
        ? `<div class="p-2 mb-2 text-xs bg-purple-950/60 border border-purple-500/30 rounded text-purple-200">ℹ️ ${escapeHtml(compliance.applicabilityNotice)}</div>`
        : ""
    }
    <p class="text-xs text-purple-200/90 mb-2">
      Found ${compliance.totalStatutoryAlerts} statutory points of note, including ${compliance.unenforceableClausesCount} clauses with potential consumer enforceability limitations.
    </p>
    <div class="compliance-alerts-grid">
      ${compliance.statutoryAlerts.map(a => {
        let badgeColor = "text-purple-300";
        let badgeLabel = a.enforceabilityStatus ? a.enforceabilityStatus.replace(/_/g, " ") : "Statutory Requirement";
        if (a.alertClassification === "UNENFORCEABLE_CLAUSE") {
          badgeColor = "text-amber-300";
          badgeLabel = "⚠️ Unenforceable Risk";
        } else if (a.alertClassification === "STATUTORY_VIOLATION") {
          badgeColor = "text-red-300";
          badgeLabel = "🛑 Statutory Violation";
        } else if (a.alertClassification === "STATUTORY_REQUIREMENT") {
          badgeColor = "text-purple-300";
          badgeLabel = "📋 Statutory Standard";
        }
        return `
        <div class="compliance-alert-card">
          <div class="flex justify-between items-center text-xs font-bold text-purple-300 mb-1">
            <span>${escapeHtml(a.categoryDisplayName)}</span>
            <span class="text-[10px] ${badgeColor} font-mono">${escapeHtml(badgeLabel)}</span>
          </div>
          <div class="text-xs text-neutral-300 font-semibold">${escapeHtml(a.statutoryCitation)}</div>
          <div class="text-[11px] text-neutral-400 mt-1">${escapeHtml(a.summary)}</div>
          <div class="text-[10px] text-purple-300/90 mt-1 italic">Guidance: ${escapeHtml(a.guidance)}</div>
        </div>
      `;}).join("")}
    </div>
    ${
      compliance.regulatoryNotice
        ? `<div class="text-[10px] text-purple-300/70 mt-2 italic">${escapeHtml(compliance.regulatoryNotice)}</div>`
        : ""
    }
  `;

  compEl.append(banner);
}

// Multi-Vendor Matrix Modal
async function openMatrixModal() {
  const modal = document.querySelector("#matrix-modal");
  if (!modal) return;

  if (sessionVendorStack.length < 2) {
    alert("Please scan at least two different policies first to compare them side-by-side in the matrix.");
    return;
  }

  modal.classList.remove("hidden");
  modal.removeAttribute("hidden");
  const recBox = document.querySelector("#matrix-recommendation-box");
  const thead = document.querySelector("#matrix-thead");
  const tbody = document.querySelector("#matrix-tbody");

  if (recBox) recBox.textContent = "Compiling comparative vendor matrix...";
  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";

  try {
    const res = await apiFetch("/api/portfolio/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendors: sessionVendorStack.slice(0, 5)
      })
    });

    if (!res.ok) throw new Error("Failed to compare vendors.");
    const data = await res.json();
    const comp = data.comparison;

    if (recBox) {
      recBox.innerHTML = `
        <strong>Procurement Recommendation:</strong> ${escapeHtml(comp.recommendedVendor)}  
        <div class="mt-1 text-emerald-300">${escapeHtml(comp.recommendationRationale)}</div>
      `;
    }

    if (thead) {
      let headHtml = `<tr><th class="p-2">Risk Category</th>`;
      for (const v of comp.vendors) {
        headHtml += `<th class="p-2">${escapeHtml(v)} (Score: ${comp.vendorScores[v] || 0})</th>`;
      }
      headHtml += `</tr>`;
      thead.innerHTML = headHtml;
    }

    if (tbody) {
      let bodyHtml = "";
      for (const [catId, catData] of Object.entries(comp.categoryMatrix)) {
        bodyHtml += `<tr><td class="font-semibold text-neutral-200 p-2">${escapeHtml(catData.categoryDisplayName)}</td>`;
        for (const v of comp.vendors) {
          const entry = catData.vendorEntries[v];
          const isFlagged = entry?.status === "FLAGGED";
          const cellClass = isFlagged ? "matrix-cell-flagged" : "matrix-cell-undetected";
          const badgeText = isFlagged ? "⚠️ " + escapeHtml(entry.severity) : "— Not Detected";
          bodyHtml += `
            <td class="${cellClass} p-2 text-xs">
              <span class="font-bold">${badgeText}</span>
              <div class="text-[11px] text-neutral-400 mt-0.5">${escapeHtml(entry?.summary || "")}</div>
            </td>
          `;
        }
        bodyHtml += `</tr>`;
      }
      tbody.innerHTML = bodyHtml;
    }
  } catch (err) {
    if (recBox) recBox.textContent = `Error comparing vendors: ${err.message}`;
  }
}

// Portfolio Stack Modal / Dashboard
async function openPortfolioModal() {
  if (sessionVendorStack.length === 0) {
    alert("Please scan at least one policy first to view your portfolio stack risk.");
    return;
  }

  const portEl = document.querySelector("#portfolio-section");
  if (!portEl) return;

  portEl.innerHTML = `<div class="p-4 text-center text-xs text-neutral-400">Evaluating stack risk exposure across ${sessionVendorStack.length} vendors...</div>`;
  portEl.classList.remove("hidden");
  portEl.scrollIntoView({ behavior: "smooth" });

  try {
    const res = await apiFetch("/api/portfolio/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolioName: "Active Software Stack",
        vendors: sessionVendorStack
      })
    });

    if (!res.ok) throw new Error("Failed to evaluate portfolio.");
    const data = await res.json();
    const port = data.portfolio;

    portEl.innerHTML = `
      <div class="portfolio-banner">
        <div class="portfolio-metrics-row mb-3">
          <div class="benchmark-circle-metric">
            <span class="benchmark-circle-score">${port.aggregateStackScore}</span>
            <span class="benchmark-circle-label">Stack Score</span>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-bold text-white">${escapeHtml(port.portfolioName)}</h3>
              <span class="benchmark-standing-badge standing-${String(port.portfolioHealth).toLowerCase()}">${escapeHtml(port.portfolioHealth.replace(/_/g, " "))}</span>
            </div>
            <p class="text-xs text-neutral-300 mt-1">Evaluated across <strong>${port.totalVendors} vendors</strong> in your active stack.</p>
          </div>
        </div>

        <div class="text-xs font-bold text-neutral-300 uppercase mb-2">Vendor Rankings:</div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          ${port.vendorRankings.map(v => `
            <div class="p-2 rounded bg-black/40 border border-neutral-700/60 text-xs">
              <div class="font-bold text-white">${escapeHtml(v.vendorName)}</div>
              <div class="text-neutral-400 text-[11px]">Score: ${v.score}/100 &bull; ${escapeHtml(v.standing)}</div>
            </div>
          `).join("")}
        </div>

        ${port.systemicExposures.length > 0 ? `
          <div class="text-xs font-bold text-red-400 uppercase mb-1">⚠️ Systemic Risk Concentrations:</div>
          <div class="space-y-1">
            ${port.systemicExposures.map(e => `
              <div class="systemic-exposure-card text-xs text-red-200">
                <strong>${escapeHtml(e.domainLabel)}:</strong> ${escapeHtml(e.summary)}
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  } catch (err) {
    portEl.innerHTML = `<div class="p-3 text-red-400 text-xs">Error evaluating portfolio: ${escapeHtml(err.message)}</div>`;
  }
}

function openDriftModal() {
  const modal = document.querySelector("#drift-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.removeAttribute("hidden");
}

function closeDriftModal() {
  const modal = document.querySelector("#drift-modal");
  if (!modal) return;
  if (modal.classList.contains("hidden") && modal.hasAttribute("hidden")) {
    return;
  }
  modal.classList.add("hidden");
  modal.setAttribute("hidden", "");
}

async function computeDrift() {
  const vendorName = document.querySelector("#drift-vendor-name")?.value || "Vendor";
  const baseText = document.querySelector("#drift-base-text")?.value || "";
  const currentText = document.querySelector("#drift-current-text")?.value || "";
  const resultsBox = document.querySelector("#drift-results-box");

  if (!baseText || !currentText) {
    alert("Please provide both baseline version text and current version text.");
    return;
  }

  if (resultsBox) resultsBox.innerHTML = `<div class="text-neutral-400 text-xs">Computing semantic policy drift...</div>`;

  try {
    const res = await apiFetch("/api/sentinel/drift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorName,
        baseVersion: { versionLabel: "Baseline Version", policyText: baseText },
        currentVersion: { versionLabel: "Current Version", policyText: currentText }
      })
    });

    if (!res.ok) throw new Error("Failed to calculate drift.");
    const data = await res.json();
    const drift = data.drift;

    if (resultsBox) {
      resultsBox.innerHTML = `
        <div class="p-3 rounded bg-neutral-900 border border-neutral-700 text-xs">
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold text-white">Drift Direction: ${escapeHtml(drift.driftDirection)}</span>
            <span class="badge ${drift.driftMagnitude === "HIGH" ? "badge-rank" : "badge-rule"}">${escapeHtml(drift.driftMagnitude)} Shift</span>
          </div>
          <p class="text-neutral-300 mt-1">${escapeHtml(drift.driftSummary)}</p>

          ${drift.newRestrictions.length > 0 ? `
            <div class="mt-2 text-red-300 font-semibold">⚠️ Newly Added Restrictions (${drift.newRestrictions.length}):</div>
            <ul class="list-disc pl-4 text-red-200/90 space-y-0.5 mt-0.5">
              ${drift.newRestrictions.map(r => `<li>${escapeHtml(r.title)} (${escapeHtml(r.severity)})</li>`).join("")}
            </ul>
          ` : ""}

          ${drift.removedRestrictions.length > 0 ? `
            <div class="mt-2 text-emerald-300 font-semibold">✓ Removed / Relaxed Restrictions (${drift.removedRestrictions.length}):</div>
            <ul class="list-disc pl-4 text-emerald-200/90 space-y-0.5 mt-0.5">
              ${drift.removedRestrictions.map(r => `<li>${escapeHtml(r.title)}</li>`).join("")}
            </ul>
          ` : ""}
        </div>
      `;
    }
  } catch (err) {
    if (resultsBox) resultsBox.innerHTML = `<div class="text-red-400 text-xs">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function initPhase8Modals() {
  const matrixModal = document.querySelector("#matrix-modal");
  const closeMatrixBtn = document.querySelector("#btn-close-matrix");
  const doneMatrixBtn = document.querySelector("#btn-matrix-done");
  const openMatrixBtn = document.querySelector("#btn-open-matrix");

  const closeMatrix = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (matrixModal) {
      if (matrixModal.classList.contains("hidden") && matrixModal.hasAttribute("hidden")) return;
      matrixModal.classList.add("hidden");
      matrixModal.setAttribute("hidden", "");
    }
  };

  if (closeMatrixBtn) closeMatrixBtn.addEventListener("click", closeMatrix);
  if (doneMatrixBtn) doneMatrixBtn.addEventListener("click", closeMatrix);
  if (openMatrixBtn) openMatrixBtn.addEventListener("click", openMatrixModal);

  if (matrixModal) {
    matrixModal.addEventListener("click", (e) => {
      if (matrixModal.classList.contains("hidden")) return;
      if (
        e.target === matrixModal ||
        e.target.closest("#btn-close-matrix") ||
        e.target.closest("#btn-matrix-done")
      ) {
        closeMatrix(e);
      }
    });
  }

  const openPortfolioBtn = document.querySelector("#btn-open-portfolio");
  if (openPortfolioBtn) openPortfolioBtn.addEventListener("click", openPortfolioModal);

  const driftModal = document.querySelector("#drift-modal");
  const closeDriftBtn = document.querySelector("#btn-close-drift");
  const doneDriftBtn = document.querySelector("#btn-drift-done");
  const runDriftBtn = document.querySelector("#btn-run-drift");
  const openDriftBtn = document.querySelector("#btn-open-drift");

  const closeDrift = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeDriftModal();
  };

  if (closeDriftBtn) closeDriftBtn.addEventListener("click", closeDrift);
  if (doneDriftBtn) doneDriftBtn.addEventListener("click", closeDrift);
  if (runDriftBtn) runDriftBtn.addEventListener("click", computeDrift);
  if (openDriftBtn) openDriftBtn.addEventListener("click", openDriftModal);

  if (driftModal) {
    driftModal.addEventListener("click", (e) => {
      if (driftModal.classList.contains("hidden")) return;
      if (
        e.target === driftModal ||
        e.target.closest("#btn-close-drift") ||
        e.target.closest("#btn-drift-done")
      ) {
        closeDrift(e);
      }
    });
  }

  // Keyboard accessibility: Escape key closes active modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (driftModal && !driftModal.classList.contains("hidden")) {
        closeDrift(e);
      }
      if (matrixModal && !matrixModal.classList.contains("hidden")) {
        closeMatrix(e);
      }
    }
  });

  // Global delegation for clause action buttons (CSP-compliant without inline onclick)
  document.addEventListener("click", (e) => {
    const amendBtn = e.target.closest('[data-action="amendment"]');
    if (amendBtn) {
      e.preventDefault();
      openAmendmentModal({
        category: amendBtn.dataset.category || "",
        evidence: amendBtn.dataset.evidence || ""
      });
      return;
    }

    const optOutBtn = e.target.closest('[data-action="optout"]');
    if (optOutBtn) {
      e.preventDefault();
      openOptOutModal({
        category: optOutBtn.dataset.category || ""
      });
      return;
    }
  });
}

window.openMatrixModal = openMatrixModal;
window.openPortfolioModal = openPortfolioModal;
window.openDriftModal = openDriftModal;
window.closeDriftModal = closeDriftModal;

initPhase8Modals();

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

  if (!modal) return;

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

export { extractCompanyName, extractCompanyNameFromText, addToVendorStack, sessionVendorStack, renderQaResult, formatSimilarityScore };
