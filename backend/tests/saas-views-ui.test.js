import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.resolve(__dirname, "../../frontend/public/index.html");
const stylesPath = path.resolve(__dirname, "../../frontend/public/styles.css");
const appJsPath = path.resolve(__dirname, "../../frontend/public/app.js");

test("Analyze-Only UI: index.html defines Analyze navigation and view container only", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  // Analyze navigation tab must be present
  assert.ok(html.includes('id="nav-tab-analyze"'), "Must define Analyze navigation tab");

  // Removed views navigation tabs must NOT be present
  assert.ok(!html.includes('id="nav-tab-portfolio"'), "Must NOT define Portfolio navigation tab");
  assert.ok(!html.includes('id="nav-tab-sentinel"'), "Must NOT define Sentinel navigation tab");
  assert.ok(!html.includes('id="nav-tab-compliance"'), "Must NOT define Compliance navigation tab");

  // Dedicated view container for Analyze must be present
  assert.ok(html.includes('id="view-analyze"'), "Must define view-analyze container");

  // Removed view containers must NOT be present
  assert.ok(!html.includes('id="view-portfolio"'), "Must NOT define view-portfolio container");
  assert.ok(!html.includes('id="view-sentinel"'), "Must NOT define view-sentinel container");
  assert.ok(!html.includes('id="view-compliance"'), "Must NOT define view-compliance container");

  // State: view-analyze is active
  assert.match(html, /<div id="view-analyze" class="app-view">/);
});

test("Analyze-Only UI: index.html retains core Analyze tools and settings modal, removing simplified sections and modals", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  // Core Analyze inputs and options
  assert.ok(html.includes('id="policy-url"'), "URL input must be present");
  assert.ok(html.includes('id="policy-file"'), "File/PDF input must be present");
  assert.ok(html.includes('id="policy-text"'), "Textarea input must be present");
  assert.ok(html.includes('id="scan-btn"'), "Analyze submit button must be present");
  assert.ok(html.includes('id="summary"'), "Summary section must be present");
  assert.ok(html.includes('id="results"'), "Results section must be present");
  assert.ok(html.includes('id="qa-section"'), "Interactive Q&A section must be present");

  // Retained settings modal
  assert.ok(html.includes('id="settings-modal"'), "Settings modal must be retained");

  // Removed simplified sections and controls
  assert.ok(!html.includes('name="scanMode"'), "Analysis Mode selector must be removed");
  assert.ok(!html.includes('id="pref-arbitration"'), "Arbitration preference dropdown must be removed");
  assert.ok(!html.includes('id="pref-privacy"'), "Privacy preference dropdown must be removed");
  assert.ok(!html.includes('id="pref-subscription"'), "Subscription preference dropdown must be removed");
  assert.ok(!html.includes('id="pref-content"'), "Content rights preference dropdown must be removed");
  assert.ok(!html.includes('id="pref-jurisdiction"'), "Target jurisdiction dropdown must be removed");
  assert.ok(!html.includes('id="readability"'), "Readability section must be removed");
  assert.ok(!html.includes('id="compliance-section"'), "Compliance section must be removed");
  assert.ok(!html.includes('id="benchmark-section"'), "Benchmark section must be removed");
  assert.ok(!html.includes('id="checklist-section"'), "Checklist section must be removed");
  assert.ok(!html.includes('id="export-bar"'), "Export toolbar must be removed");

  // Removed modals
  assert.ok(!html.includes('id="optout-modal"'), "Opt-Out modal must be removed");
  assert.ok(!html.includes('id="amendment-modal"'), "Amendment modal must be removed");
  assert.ok(!html.includes('id="rider-modal"'), "Rider modal must be removed");
  assert.ok(!html.includes('id="matrix-modal"'), "Matrix modal must be removed");
  assert.ok(!html.includes('id="drift-modal"'), "Drift modal must be removed");
});

test("Analyze-Only CSP Compliance: No inline style attributes or inline event handlers", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  const analyzeMatch = html.match(/<div id="view-analyze"[\s\S]*?<!-- End View 1: Document Analysis -->/);
  assert.ok(analyzeMatch, "view-analyze section must be present");
  assert.ok(!analyzeMatch[0].includes('style="'), "view-analyze must not contain inline style attributes");
  assert.ok(!analyzeMatch[0].includes("onclick="), "view-analyze must not contain onclick handlers");
  assert.ok(!analyzeMatch[0].includes("onsubmit="), "view-analyze must not contain onsubmit handlers");
});

test("Analyze-Only Styles: styles.css contains required navigation and view styles", () => {
  const css = fs.readFileSync(stylesPath, "utf8");

  assert.ok(css.includes(".nav-tabs-group"), "styles.css must define .nav-tabs-group");
  assert.ok(css.includes(".nav-tab"), "styles.css must define .nav-tab");
  assert.ok(css.includes(".app-view"), "styles.css must define .app-view");
});

test("Analyze-Only Logic: app.js contains Analyze integrations and exports", () => {
  const appJs = fs.readFileSync(appJsPath, "utf8");

  // Verification of Analyze-only view setup
  assert.ok(appJs.includes("initSaaSViews"), "app.js must define and export initSaaSViews");
  assert.ok(appJs.includes("extractCompanyName"), "app.js must export extractCompanyName");
  assert.ok(appJs.includes("renderQaResult"), "app.js must export renderQaResult");

  // Obsolete view API integrations should not be active
  assert.ok(!appJs.includes('"/api/portfolio/evaluate"'), "app.js must not call /api/portfolio/evaluate");
  assert.ok(!appJs.includes('"/api/portfolio/compare"'), "app.js must not call /api/portfolio/compare");
  assert.ok(!appJs.includes('"/api/sentinel/drift"'), "app.js must not call /api/sentinel/drift");
  assert.ok(!appJs.includes('"/api/sentinel/snapshot"'), "app.js must not call /api/sentinel/snapshot");
  assert.ok(!appJs.includes('"/api/remediation/checklist"'), "app.js must not call /api/remediation/checklist");
  assert.ok(!appJs.includes('"/api/remediation/opt-out"'), "app.js must not call /api/remediation/opt-out");
  assert.ok(!appJs.includes('"/api/negotiation/amendment"'), "app.js must not call /api/negotiation/amendment");
  assert.ok(!appJs.includes('"/api/negotiation/rider"'), "app.js must not call /api/negotiation/rider");
  assert.ok(!appJs.includes('"/api/benchmarks/evaluate"'), "app.js must not call /api/benchmarks/evaluate");
  assert.ok(!appJs.includes('"/api/compliance/audit"'), "app.js must not call /api/compliance/audit");
  assert.ok(!appJs.includes('"/api/export/report"'), "app.js must not call /api/export/report");
});
