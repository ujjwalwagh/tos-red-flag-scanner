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

test("Phase 9.3 UI: index.html defines topbar SaaS navigation tabs and app-views", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  // Topbar navigation tabs
  assert.ok(html.includes('id="nav-tab-analyze"'), "Must define Analyze navigation tab");
  assert.ok(html.includes('id="nav-tab-portfolio"'), "Must define Portfolio navigation tab");
  assert.ok(html.includes('id="nav-tab-sentinel"'), "Must define Sentinel navigation tab");
  assert.ok(html.includes('id="nav-tab-compliance"'), "Must define Compliance navigation tab");

  // Dedicated view containers
  assert.ok(html.includes('id="view-analyze"'), "Must define view-analyze container");
  assert.ok(html.includes('id="view-portfolio"'), "Must define view-portfolio container");
  assert.ok(html.includes('id="view-sentinel"'), "Must define view-sentinel container");
  assert.ok(html.includes('id="view-compliance"'), "Must define view-compliance container");

  // Initial state: view-analyze active, others hidden
  assert.match(html, /<div id="view-analyze" class="app-view">/);
  assert.match(html, /<section id="view-portfolio" class="app-view hidden"/);
  assert.match(html, /<section id="view-sentinel" class="app-view hidden"/);
  assert.match(html, /<section id="view-compliance" class="app-view hidden"/);
});

test("Phase 9.3 UI: index.html has complete label associations and accessible controls", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  // Portfolio view inputs
  assert.ok(html.includes('for="portfolio-vendor-name-input"'));
  assert.ok(html.includes('id="portfolio-vendor-name-input"'));
  assert.ok(html.includes('for="portfolio-vendor-text-input"'));
  assert.ok(html.includes('id="portfolio-vendor-text-input"'));

  // Sentinel view inputs
  assert.ok(html.includes('for="sentinel-vendor-input"'));
  assert.ok(html.includes('id="sentinel-vendor-input"'));
  assert.ok(html.includes('for="sentinel-snapshot-select"'));
  assert.ok(html.includes('id="sentinel-snapshot-select"'));
  assert.ok(html.includes('for="sentinel-base-text"'));
  assert.ok(html.includes('id="sentinel-base-text"'));
  assert.ok(html.includes('for="sentinel-current-text"'));
  assert.ok(html.includes('id="sentinel-current-text"'));

  // Compliance view inputs
  assert.ok(html.includes('for="compliance-jurisdiction-select"'));
  assert.ok(html.includes('id="compliance-jurisdiction-select"'));
  assert.ok(html.includes('for="compliance-custom-textarea"'));
  assert.ok(html.includes('id="compliance-custom-textarea"'));
});

test("Phase 9.3 CSP Compliance: No inline style attributes or inline event handlers in views", () => {
  const html = fs.readFileSync(indexPath, "utf8");

  // Extract content of the new views
  const portfolioMatch = html.match(/<section id="view-portfolio"[\s\S]*?<\/section>/);
  assert.ok(portfolioMatch, "view-portfolio section must be present");
  assert.ok(!portfolioMatch[0].includes('style="'), "view-portfolio must not contain inline style attributes");
  assert.ok(!portfolioMatch[0].includes("onclick="), "view-portfolio must not contain onclick handlers");
  assert.ok(!portfolioMatch[0].includes("onsubmit="), "view-portfolio must not contain onsubmit handlers");

  const sentinelMatch = html.match(/<section id="view-sentinel"[\s\S]*?<\/section>/);
  assert.ok(sentinelMatch, "view-sentinel section must be present");
  assert.ok(!sentinelMatch[0].includes('style="'), "view-sentinel must not contain inline style attributes");
  assert.ok(!sentinelMatch[0].includes("onclick="), "view-sentinel must not contain onclick handlers");

  const complianceMatch = html.match(/<section id="view-compliance"[\s\S]*?<\/section>/);
  assert.ok(complianceMatch, "view-compliance section must be present");
  assert.ok(!complianceMatch[0].includes('style="'), "view-compliance must not contain inline style attributes");
  assert.ok(!complianceMatch[0].includes("onclick="), "view-compliance must not contain onclick handlers");
});

test("Phase 9.3 Styles: styles.css contains required SaaS UI classes", () => {
  const css = fs.readFileSync(stylesPath, "utf8");

  assert.ok(css.includes(".nav-tabs-group"), "styles.css must define .nav-tabs-group");
  assert.ok(css.includes(".nav-tab"), "styles.css must define .nav-tab");
  assert.ok(css.includes(".app-view"), "styles.css must define .app-view");
  assert.ok(css.includes(".vendor-stack-card"), "styles.css must define .vendor-stack-card");
  assert.ok(css.includes(".portfolio-banner-card"), "styles.css must define .portfolio-banner-card");
  assert.ok(css.includes(".procurement-rec-banner"), "styles.css must define .procurement-rec-banner");
  assert.ok(css.includes(".drift-results-card"), "styles.css must define .drift-results-card");
  assert.ok(css.includes(".compliance-results-card"), "styles.css must define .compliance-results-card");
  assert.ok(css.includes(".statutory-alert-item"), "styles.css must define .statutory-alert-item");
});

test("Phase 9.3 Logic: app.js contains API integrations for Portfolio, Sentinel, and Compliance", () => {
  const appJs = fs.readFileSync(appJsPath, "utf8");

  // Portfolio API integrations
  assert.ok(appJs.includes('"/api/portfolio/evaluate"'), "app.js must call /api/portfolio/evaluate");
  assert.ok(appJs.includes('"/api/portfolio/compare"'), "app.js must call /api/portfolio/compare");

  // Sentinel API integrations
  assert.ok(appJs.includes("/api/sentinel/drift"), "app.js must call /api/sentinel/drift");
  assert.ok(appJs.includes("/api/sentinel/snapshot"), "app.js must call /api/sentinel/snapshot");
  assert.ok(appJs.includes("/api/sentinel/snapshots/"), "app.js must call /api/sentinel/snapshots/:vendorName");

  // Compliance API integrations
  assert.ok(appJs.includes('"/api/compliance/audit"'), "app.js must call /api/compliance/audit");
  assert.ok(appJs.includes('"/api/compliance/jurisdictions"'), "app.js must call /api/compliance/jurisdictions");

  // Export check
  assert.ok(appJs.includes("initSaaSViews"), "app.js must define and export initSaaSViews");
});
