/**
 * Actionable Pre-Agreement Checklist Generator for TOS Red Flag Scanner (Phase 6).
 *
 * Converts detected and ranked clause findings into a practical, chronologically
 * structured consumer checklist ("Steps to Take Before and After Clicking Agree").
 */

import { getRiskCategory } from "../analysis/risk-categories.js";
import { NOTICE_TYPES, resolveNoticeType } from "./optout-generator.js";

export const CHECKLIST_URGENCY = {
  IMMEDIATE: "IMMEDIATE", // Within 24-48 hours / before agreeing
  DAY_30: "DAY_30",       // Within 30 days (typical contractual opt-out window)
  ONGOING: "ONGOING"      // Best practices during service utilization
};

/**
 * Derives practical action checklist items from ranked clause findings.
 *
 * @param {Array<Object>} rankedFindings - Findings sorted by priority/urgency
 * @param {Object} [options={}]
 * @param {string} [options.companyName] - Optional provider name
 * @returns {Object} Structured checklist with categorized action items
 */
export function generateActionChecklist(rankedFindings = [], options = {}) {
  if (!Array.isArray(rankedFindings) || rankedFindings.length === 0) {
    return {
      summary: {
        totalItems: 0,
        immediateCount: 0,
        day30Count: 0,
        ongoingCount: 0,
        optOutEligibleCount: 0
      },
      items: []
    };
  }

  const company = (options.companyName || "").trim() || "the service provider";
  const items = [];
  // Prioritize findings so genuine renewal clauses are processed before optional ones
  const prioritizedFindings = [...rankedFindings].sort((a, b) => {
    const aIsOpt = a.title === "Optional Recurring Payment Feature" || a.severity === "LOW";
    const bIsOpt = b.title === "Optional Recurring Payment Feature" || b.severity === "LOW";
    if (aIsOpt && !bIsOpt) return 1;
    if (!aIsOpt && bIsOpt) return -1;
    return (a.rank || 99) - (b.rank || 99);
  });

  const seenCategories = new Set();

  for (const finding of prioritizedFindings) {
    const catId = finding.categoryId || finding.category || "OTHER";
    const categoryMeta = getRiskCategory(catId);
    const impact = finding.impactMagnitude || "Medium";

    // Deduplicate duplicate items within the same category to keep checklist concise
    if (seenCategories.has(categoryMeta.id)) {
      continue;
    }
    seenCategories.add(categoryMeta.id);

    const checklistItem = buildChecklistItem(finding, categoryMeta, company);
    if (checklistItem) {
      items.push(checklistItem);
    }
  }

  // Sort items: IMMEDIATE first, then DAY_30, then ONGOING
  const urgencyOrder = {
    [CHECKLIST_URGENCY.IMMEDIATE]: 1,
    [CHECKLIST_URGENCY.DAY_30]: 2,
    [CHECKLIST_URGENCY.ONGOING]: 3
  };

  items.sort((a, b) => {
    const uDiff = (urgencyOrder[a.urgency] || 99) - (urgencyOrder[b.urgency] || 99);
    if (uDiff !== 0) return uDiff;
    return (a.rank || 99) - (b.rank || 99);
  });

  const summary = {
    totalItems: items.length,
    immediateCount: items.filter((i) => i.urgency === CHECKLIST_URGENCY.IMMEDIATE).length,
    day30Count: items.filter((i) => i.urgency === CHECKLIST_URGENCY.DAY_30).length,
    ongoingCount: items.filter((i) => i.urgency === CHECKLIST_URGENCY.ONGOING).length,
    optOutEligibleCount: items.filter((i) => i.hasRemediationLetter).length
  };

  return {
    summary,
    items
  };
}

/**
 * Builds an individual checklist item for a specific finding.
 */
function buildChecklistItem(finding, categoryMeta, company) {
  const catId = categoryMeta.id;
  const rank = finding.rank || 1;
  const impact = finding.impactMagnitude || "Medium";

  // 1. Mandatory Arbitration / Class Action Waiver
  if (catId === "ARBITRATION" || catId === "CLASS_ACTION_WAIVER") {
    return {
      id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
      rank,
      categoryId: catId,
      categoryDisplayName: categoryMeta.displayName,
      urgency: CHECKLIST_URGENCY.DAY_30,
      impactMagnitude: impact,
      title: `Submit Arbitration Opt-Out Notice to ${company}`,
      action: "Draft and mail/email an arbitration opt-out letter within 30 days of registration.",
      details: "Most arbitration clauses contain a 30-day opt-out provision. Exercising this opt-out preserves your constitutional right to take disputes to court without closing your account.",
      hasRemediationLetter: true,
      noticeType: NOTICE_TYPES.ARBITRATION_OPT_OUT,
      findingId: finding.findingId,
      evidence: finding.evidence
    };
  }

  // 2. Automatic Subscription Renewal / Billing
  if (catId === "AUTO_RENEWAL" || catId === "AUTO_RENEWAL_SUBSCRIPTION") {
    const isOptional =
      finding.title === "Optional Recurring Payment Feature" ||
      finding.severity === "LOW" ||
      /\boptional\b/i.test(finding.title || "");

    if (isOptional) {
      return {
        id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
        rank,
        categoryId: catId,
        categoryDisplayName: categoryMeta.displayName,
        urgency: CHECKLIST_URGENCY.ONGOING,
        impactMagnitude: impact,
        title: "Review Optional Recurring Payment / Autopay Settings",
        action: "If you choose to enable recurring payments or Autopay, verify payment limits and mandate revocation controls in your app settings.",
        details: "This service offers optional recurring payment features (such as Autopay). Because enrollment is voluntary, no mandatory subscription renewal applies unless you explicitly configure it.",
        hasRemediationLetter: false,
        noticeType: null,
        findingId: finding.findingId,
        evidence: finding.evidence
      };
    }

    const hasCancellationDeadline =
      finding.title === "Automatic Subscription Renewal with Cancellation Restrictions" ||
      finding.severity === "HIGH" ||
      /\b(?:cancellation\s+restrictions?|deadline|window)\b/i.test(finding.title || "");

    return {
      id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
      rank,
      categoryId: catId,
      categoryDisplayName: categoryMeta.displayName,
      urgency: CHECKLIST_URGENCY.IMMEDIATE,
      impactMagnitude: impact,
      title: hasCancellationDeadline
        ? "Set Calendar Alert for Strict Subscription Renewal & Cancellation Deadline"
        : "Set Calendar Alert for Subscription Renewal Deadline",
      action: hasCancellationDeadline
        ? "Create a calendar reminder well ahead of the contractual cancellation cutoff window to review or terminate the subscription."
        : "Create a recurring reminder 3 days before each billing cycle to evaluate cancellation.",
      details: hasCancellationDeadline
        ? "This contract imposes strict advance notice windows or deadlines for cancellation. Failing to cancel before the specified cutoff will trigger an automatic recurring renewal charge."
        : "Subscriptions automatically renew and bill your payment card. Ensure you know the cancellation cutoff window (typically 24-48 hours before billing).",
      hasRemediationLetter: true,
      noticeType: NOTICE_TYPES.SUBSCRIPTION_CANCELLATION,
      findingId: finding.findingId,
      evidence: finding.evidence
    };
  }

  // 3. Privacy / Data Sharing & Sale
  if (catId === "PRIVACY_DATA_SHARING" || catId === "PRIVACY_DATA_COLLECTION") {
    return {
      id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
      rank,
      categoryId: catId,
      categoryDisplayName: categoryMeta.displayName,
      urgency: CHECKLIST_URGENCY.DAY_30,
      impactMagnitude: impact,
      title: "Submit Data Sharing & Targeted Ad Restriction Request",
      action: "Request that your personal information and browsing metrics not be shared with advertising brokers.",
      details: "Exercise your statutory privacy rights (CCPA/GDPR) to restrict commercial data dissemination and targeted advertising profiling.",
      hasRemediationLetter: true,
      noticeType: NOTICE_TYPES.DATA_SHARING_RESTRICTION,
      findingId: finding.findingId,
      evidence: finding.evidence
    };
  }

  // 4. Broad Content Rights / IP License
  if (catId === "USER_CONTENT_RIGHTS" || catId === "CONTENT_LICENSE") {
    return {
      id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
      rank,
      categoryId: catId,
      categoryDisplayName: categoryMeta.displayName,
      urgency: CHECKLIST_URGENCY.ONGOING,
      impactMagnitude: impact,
      title: "Sanitize & Restrict Proprietary Content Uploads",
      action: "Avoid uploading confidential, copyrighted, or sensitive creative assets to this platform.",
      details: "The service demands a sweeping, perpetual, or royalty-free license to your uploaded materials. Retain full ownership of critical IP by keeping it off this service.",
      hasRemediationLetter: false,
      noticeType: null,
      findingId: finding.findingId,
      evidence: finding.evidence
    };
  }

  // 5. Unilateral Changes to Terms
  if (catId === "UNILATERAL_CHANGES" || catId === "CHANGES_TO_TERMS") {
    return {
      id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
      rank,
      categoryId: catId,
      categoryDisplayName: categoryMeta.displayName,
      urgency: CHECKLIST_URGENCY.ONGOING,
      impactMagnitude: impact,
      title: "Archive This Copy of the Terms of Service",
      action: "Download or bookmark this terms snapshot with today's date for evidentiary records.",
      details: "The provider reserves the right to modify these terms without direct individual notification. Having a dated snapshot preserves the terms you agreed to.",
      hasRemediationLetter: false,
      noticeType: null,
      findingId: finding.findingId,
      evidence: finding.evidence
    };
  }

  // 6. Generic High/Critical Fallback
  return {
    id: `CHECKLIST_${catId}_${finding.findingId || rank}`,
    rank,
    categoryId: catId,
    categoryDisplayName: categoryMeta.displayName,
    urgency: impact === "Critical" ? CHECKLIST_URGENCY.IMMEDIATE : CHECKLIST_URGENCY.ONGOING,
    impactMagnitude: impact,
    title: `Review ${categoryMeta.displayName} Terms Before Registering`,
    action: `Carefully examine the contractual restrictions in Section "${finding.title || categoryMeta.displayName}".`,
    details: finding.plainEnglishExplanation?.summary || categoryMeta.description,
    hasRemediationLetter: false,
    noticeType: null,
    findingId: finding.findingId,
    evidence: finding.evidence
  };
}
