/**
 * Executive Report Exporter for TOS Red Flag Scanner (Phase 6).
 *
 * Produces structured audit artifacts in Markdown, JSON, and printable standalone HTML.
 * Includes complete verbatim evidence, personalized rankings, plain-English explanations,
 * actionable checklist steps, and mandatory consumer disclaimers.
 */

import { LEGAL_DISCLAIMER } from "../remediation/optout-generator.js";

export const EXPORT_FORMATS = {
  MARKDOWN: "markdown",
  JSON: "json",
  HTML: "html"
};

/**
 * Escapes HTML characters for safe HTML output.
 */
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Exports an analysis result into the requested format.
 *
 * @param {Object} analysis - Pipeline analysis result
 * @param {string} [format="markdown"] - One of "markdown" | "json" | "html"
 * @param {Object} [options={}]
 * @param {string} [options.documentTitle]
 * @param {string} [options.sourceLabel]
 * @returns {string|Object} Rendered report content
 */
export function exportReport(analysis = {}, format = EXPORT_FORMATS.MARKDOWN, options = {}) {
  const normFormat = String(format || "").toLowerCase().trim();

  if (normFormat === EXPORT_FORMATS.JSON) {
    return exportJsonReport(analysis, options);
  }
  if (normFormat === EXPORT_FORMATS.HTML) {
    return exportHtmlReport(analysis, options);
  }
  return exportMarkdownReport(analysis, options);
}

/**
 * Generates structured Markdown Audit Report.
 */
export function exportMarkdownReport(analysis = {}, options = {}) {
  const docTitle = options.documentTitle || analysis.documentMetadata?.filename || "Terms of Service Agreement";
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const findings = Array.isArray(analysis.rankedFindings) ? analysis.rankedFindings : (analysis.findings || []);
  const summary = analysis.summary || {};
  const checklist = analysis.checklist?.items || [];
  const personalized = summary.personalized || {};

  let md = `# ClauseGuard AI — Terms of Service Risk Audit\n\n`;
  md += `**Document:** ${docTitle}  \n`;
  md += `**Audit Date:** ${dateStr}  \n`;
  md += `**Overall Risk Level:** ${(summary.overallRisk || "UNKNOWN").toUpperCase()}  \n`;
  md += `**Personalized Safety Score:** ${personalized.score ?? 70}/100  \n\n`;

  md += `> [!NOTE]\n`;
  md += `> ${LEGAL_DISCLAIMER}\n\n`;

  md += `## 1. Executive Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Total Red Flags Flagged** | ${summary.totalFindings || findings.length} |\n`;
  md += `| **High / Critical Severity** | ${(summary.bySeverity?.HIGH || 0) + (personalized.byImpact?.Critical || 0)} |\n`;
  md += `| **Medium Severity** | ${summary.bySeverity?.MEDIUM || 0} |\n`;
  md += `| **Low / Informational** | ${(summary.bySeverity?.LOW || 0) + (summary.bySeverity?.INFO || 0)} |\n`;
  md += `| **Document Word Count** | ${analysis.documentMetadata?.wordCount || "N/A"} |\n\n`;

  if (checklist.length > 0) {
    md += `## 2. Actionable Pre-Agreement Checklist\n\n`;
    for (const item of checklist) {
      const urgencyTag = item.urgency === "IMMEDIATE" ? "⚠️ **IMMEDIATE**" : (item.urgency === "DAY_30" ? "⏳ **30-DAY WINDOW**" : "ℹ️ **ONGOING**");
      md += `- [ ] **${item.title}** (${urgencyTag})\n`;
      md += `  - *Action:* ${item.action}\n`;
      md += `  - *Details:* ${item.details}\n`;
      if (item.hasRemediationLetter) {
        md += `  - *Remediation Available:* Formal opt-out notice template available.\n`;
      }
      md += `\n`;
    }
  }

  md += `## 3. Detailed Ranked Clause Findings\n\n`;
  if (findings.length === 0) {
    md += `*No significant contractual red flags detected under active rules.*\n\n`;
  } else {
    for (const f of findings) {
      const rankNum = f.rank || 1;
      const magnitude = f.impactMagnitude || f.severity || "MEDIUM";
      md += `### #${rankNum} — ${f.title || f.categoryDisplayName || "Contractual Red Flag"}\n\n`;
      md += `- **Category:** ${f.categoryDisplayName || f.categoryId}  \n`;
      md += `- **Personalized Impact:** \`${magnitude}\` (User Priority Weight: ${f.userConcernWeight || 3}/5)  \n`;
      md += `- **Why it was ranked here:** ${f.rankingReason || "Ranked by baseline severity and user concern."}  \n\n`;

      md += `#### Plain-English Guidance\n`;
      if (f.plainEnglishExplanation) {
        md += `- **What it means:** ${f.plainEnglishExplanation.whatItMeans}\n`;
        md += `- **Why it matters:** ${f.plainEnglishExplanation.whyItMatters}\n`;
        md += `- **What to watch out for:** ${f.plainEnglishExplanation.whatToWatchFor}\n\n`;
      } else if (f.explanation) {
        md += `${f.explanation}\n\n`;
      }

      md += `> **Verbatim Legal Evidence (Preserved Exact Text):**\n`;
      md += `> "${(f.evidence || "No excerpt recorded.").replace(/\n/g, " ")}"\n\n`;
      md += `---\n\n`;
    }
  }

  md += `\n*Audit generated by ClauseGuard AI. Verbatim contract provisions are strictly preserved without modification.*\n`;
  return md;
}

/**
 * Generates standardized JSON Audit Artifact.
 */
export function exportJsonReport(analysis = {}, options = {}) {
  const docTitle = options.documentTitle || analysis.documentMetadata?.filename || "Terms of Service Agreement";
  const dateStr = new Date().toISOString();

  return {
    schemaVersion: "clauseguard-audit-v1.0",
    generatedAt: dateStr,
    documentTitle: docTitle,
    disclaimer: LEGAL_DISCLAIMER,
    summary: {
      overallRisk: analysis.summary?.overallRisk || "unknown",
      totalFindings: analysis.summary?.totalFindings || 0,
      personalizedScore: analysis.summary?.personalized?.score ?? 70,
      severityDistribution: analysis.summary?.bySeverity || {},
      impactDistribution: analysis.summary?.personalized?.byImpact || {}
    },
    checklist: analysis.checklist?.items || [],
    rankedFindings: (analysis.rankedFindings || analysis.findings || []).map((f) => ({
      rank: f.rank || 1,
      categoryId: f.categoryId,
      categoryDisplayName: f.categoryDisplayName,
      severity: f.severity,
      impactMagnitude: f.impactMagnitude,
      userConcernWeight: f.userConcernWeight,
      personalizedScore: f.personalizedScore,
      rankingReason: f.rankingReason,
      plainEnglishExplanation: f.plainEnglishExplanation,
      verbatimEvidence: f.evidence,
      pageNumber: f.pageNumber,
      segmentIndex: f.segmentIndex
    }))
  };
}

/**
 * Generates standalone, printable HTML Report with CSS print styles.
 */
export function exportHtmlReport(analysis = {}, options = {}) {
  const docTitle = escapeHtml(options.documentTitle || analysis.documentMetadata?.filename || "Terms of Service Agreement");
  const dateStr = escapeHtml(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
  const findings = Array.isArray(analysis.rankedFindings) ? analysis.rankedFindings : (analysis.findings || []);
  const summary = analysis.summary || {};
  const checklist = analysis.checklist?.items || [];
  const personalized = summary.personalized || {};

  const riskColor =
    summary.overallRisk === "high" || summary.overallRisk === "critical"
      ? "#ef4444"
      : summary.overallRisk === "medium"
      ? "#f59e0b"
      : "#10b981";

  let itemsHtml = "";
  for (const f of findings) {
    const rankNum = f.rank || 1;
    const impact = f.impactMagnitude || f.severity || "MEDIUM";
    const impactClass = `impact-${String(impact).toLowerCase()}`;
    const evidenceText = escapeHtml(f.evidence || "No excerpt recorded.");
    const explanation = f.plainEnglishExplanation
      ? `<div class="expl-section"><strong>What it means:</strong> ${escapeHtml(f.plainEnglishExplanation.whatItMeans)}</div>
         <div class="expl-section"><strong>Why it matters:</strong> ${escapeHtml(f.plainEnglishExplanation.whyItMatters)}</div>
         <div class="expl-section"><strong>What to watch for:</strong> ${escapeHtml(f.plainEnglishExplanation.whatToWatchFor)}</div>`
      : `<div class="expl-section">${escapeHtml(f.explanation || "")}</div>`;

    itemsHtml += `
      <div class="finding-card">
        <div class="finding-header">
          <span class="rank-badge">#${rankNum}</span>
          <span class="finding-title">${escapeHtml(f.title || f.categoryDisplayName || "Contract Red Flag")}</span>
          <span class="badge ${impactClass}">${escapeHtml(impact)}</span>
        </div>
        <div class="ranking-reason"><strong>Why ranked here:</strong> ${escapeHtml(f.rankingReason || "")}</div>
        <div class="guidance-box">${explanation}</div>
        <div class="verbatim-box">
          <span class="verbatim-label">Verbatim Contract Clause:</span>
          <blockquote>&ldquo;${evidenceText}&rdquo;</blockquote>
        </div>
      </div>
    `;
  }

  let checklistHtml = "";
  if (checklist.length > 0) {
    checklistHtml += `<div class="checklist-section"><h2>Actionable Pre-Agreement Checklist</h2><ul class="checklist">`;
    for (const c of checklist) {
      checklistHtml += `
        <li>
          <input type="checkbox" disabled />
          <div>
            <strong>${escapeHtml(c.title)}</strong>
            <span class="urgency-pill ${c.urgency.toLowerCase()}">${escapeHtml(c.urgency)}</span>
            <p>${escapeHtml(c.action)}</p>
          </div>
        </li>
      `;
    }
    checklistHtml += `</ul></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClauseGuard AI Audit — ${docTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); padding: 36px; border: 1px solid #e2e8f0; }
    .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { margin: 0 0 6px 0; font-size: 24px; color: #0f172a; }
    .header .meta { color: #64748b; font-size: 14px; }
    .score-badge { text-align: right; }
    .score-value { font-size: 32px; font-weight: 800; color: ${riskColor}; }
    .score-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .disclaimer-banner { background: #f1f5f9; border-left: 4px solid #64748b; padding: 12px 16px; font-size: 13px; color: #475569; margin-bottom: 28px; border-radius: 4px; }
    .finding-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px; background: #ffffff; page-break-inside: avoid; }
    .finding-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .rank-badge { background: #0f172a; color: #ffffff; font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 4px; }
    .finding-title { font-weight: 600; font-size: 16px; color: #0f172a; flex: 1; }
    .badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; }
    .impact-critical { background: #fee2e2; color: #b91c1c; }
    .impact-high { background: #fef3c7; color: #b45309; }
    .impact-medium { background: #e0f2fe; color: #0369a1; }
    .impact-low { background: #f1f5f9; color: #475569; }
    .ranking-reason { font-size: 13px; color: #64748b; margin-bottom: 12px; }
    .guidance-box { background: #f8fafc; border-radius: 6px; padding: 12px 14px; font-size: 14px; margin-bottom: 12px; }
    .expl-section { margin-bottom: 6px; }
    .expl-section:last-child { margin-bottom: 0; }
    .verbatim-box { border-left: 3px solid #cbd5e1; padding-left: 12px; font-size: 13px; color: #334155; }
    .verbatim-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px; }
    .verbatim-box blockquote { margin: 0; font-style: italic; }
    .checklist-section { margin-bottom: 32px; background: #fdfdfd; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 20px; }
    .checklist { list-style: none; padding: 0; margin: 0; }
    .checklist li { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .checklist li p { margin: 4px 0 0 0; font-size: 13px; color: #64748b; }
    .urgency-pill { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-left: 6px; text-transform: uppercase; }
    .urgency-pill.immediate { background: #fee2e2; color: #b91c1c; }
    .urgency-pill.day_30 { background: #fef3c7; color: #b45309; }
    .urgency-pill.ongoing { background: #e2e8f0; color: #475569; }
    .actions-bar { margin-bottom: 20px; text-align: right; }
    .btn-print { background: #2563eb; color: #ffffff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .btn-print:hover { background: #1d4ed8; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { box-shadow: none; border: none; padding: 0; max-width: 100%; }
      .actions-bar { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="actions-bar">
      <button class="btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
    <div class="header">
      <div>
        <h1>ClauseGuard AI — Terms Risk Audit</h1>
        <div class="meta">Document: <strong>${docTitle}</strong> &bull; Generated: ${dateStr}</div>
      </div>
      <div class="score-badge">
        <div class="score-value">${personalized.score ?? 70}/100</div>
        <div class="score-label">Personalized Safety Score</div>
      </div>
    </div>

    <div class="disclaimer-banner">
      <strong>Notice:</strong> ${escapeHtml(LEGAL_DISCLAIMER)}
    </div>

    ${checklistHtml}

    <h2>Detailed Ranked Findings (${findings.length})</h2>
    ${itemsHtml}
  </div>
</body>
</html>`;
}
