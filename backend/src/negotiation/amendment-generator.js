/**
 * FairTerms Contract Amendment & Counter-Proposal Generator (Phase 7).
 *
 * Produces balanced, legally standard counter-proposals to replace one-sided
 * contractual clauses, generates visual word-level redline diffs, and compiles
 * formal Contract Amendment Addenda / Riders.
 *
 * LEGAL SAFETY NOTICE:
 * All generated counter-proposals and riders are informational negotiating drafts.
 * They do not constitute formal legal representation or binding legal counsel.
 */

import { AppError } from "../security/security.js";
import { getRiskCategory } from "../analysis/risk-categories.js";
import { computeWordDiff, formatRedlineHtml } from "./redline-differ.js";

export const NEGOTIATION_DISCLAIMER =
  "LEGAL DISCLAIMER: This document and proposed amendment language are automated informational " +
  "drafting aids produced by ClauseGuard AI. They do not constitute formal legal representation, " +
  "attorney work-product, or statutory advice. The enforceability of contract amendments depends " +
  "on mutual consent, applicable governing law, and contract formation principles. Consult a qualified " +
  "attorney to confirm statutory enforceability in your jurisdiction.";

/**
 * Standard attorney-vetted fair counter-language templates across canonical categories.
 */
const BALANCED_TEMPLATES = {
  ARBITRATION: {
    title: "Mutual Dispute Resolution & Judicial Access Amendment",
    sectionTitle: "DISPUTE RESOLUTION",
    rationale: "Replaces mandatory individual arbitration and jury waivers with fair mutual negotiation and access to courts of competent jurisdiction.",
    talkingPoints: [
      "Mandatory binding arbitration strips constitutional jury rights and appeals.",
      "A 30-day informal mediation escalation period resolves legitimate disputes faster while preserving court access if mediation fails.",
      "Mutual judicial access aligns with standard fair commercial contracting norms."
    ],
    fallbackAlternative: "If judicial resolution is rejected, propose AAA commercial arbitration with mutual arbitrator selection, local hearing venue, and company paying all filing and hearing fees.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `All disputes arising under or related to this Agreement shall be submitted exclusively to the state or federal courts located in the county where ${user} resides or maintains its principal place of business. Neither party shall be bound by or subjected to mandatory private arbitration or jury trial waivers.`,
      BALANCED: (company, user) =>
        `In the event of any dispute, claim, or controversy arising out of or relating to this Agreement, ${company} and ${user} agree to first attempt in good faith to resolve the matter informally through executive consultation or mediation within thirty (30) days of written notice. If the dispute is not resolved through informal negotiations, either party may commence legal proceedings exclusively in a court of competent jurisdiction. Neither party shall be required to submit claims to mandatory private binding arbitration.`,
      CONSERVATIVE: (company, user) =>
        `Disputes shall be resolved through binding arbitration administered by the American Arbitration Association under its Commercial Rules, provided that: (a) arbitration shall occur in the city nearest to ${user}; (b) ${company} shall pay all administrative and arbitrator fees; and (c) either party may pursue claims in small claims court.`
    }
  },

  CLASS_ACTION_WAIVER: {
    title: "Mutual Rights Reservation on Collective Redress",
    sectionTitle: "COLLECTIVE CLAIMS AND REDRESS",
    rationale: "Removes unilateral class-action waivers that insulate providers from accountability for widespread systemic violations.",
    talkingPoints: [
      "Blanket waivers disproportionately disadvantage small claimants with identical low-dollar harms.",
      "Removes restriction preventing claimants from consolidating claims where procedural rules permit."
    ],
    fallbackAlternative: "Allow class representation specifically for systemic billing errors or verified data breach incidents.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `Neither party waives any right to initiate, join, or participate in any class action, collective action, private attorney general proceeding, or consolidated claim against the other party. Any clause purporting to waive such collective rights is hereby declared null and void.`,
      BALANCED: (company, user) =>
        `Nothing in this Agreement shall prevent ${user} or ${company} from participating in joint, collective, or representative proceedings where permitted under applicable procedural rules and consumer protection statutes.`,
      CONSERVATIVE: (company, user) =>
        `Class action waivers shall not apply to claims alleging intentional breach of data security, unauthorized recurring billing, or statutory violations under consumer protection legislation.`
    }
  },

  USER_CONTENT_RIGHTS: {
    title: "Limited Operational License & Creator Rights Protection",
    sectionTitle: "INTELLECTUAL PROPERTY & CONTENT LICENSING",
    rationale: "Replaces sweeping, perpetual, and irrevocable content licenses with a narrow, revocable license strictly limited to core service delivery.",
    talkingPoints: [
      "The platform only requires operational rights to host, cache, and transmit user content.",
      "Perpetual, irrevocable, and sublicensable commercial rights overreach beyond legitimate hosting needs.",
      "License should automatically terminate upon account closure."
    ],
    fallbackAlternative: "Allow a non-exclusive license that terminates 60 days following account deletion, excluding cached archival backups.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `${user} retains all right, title, and ownership in all content and data submitted. ${company} is granted a non-exclusive, non-transferable, revocable license strictly to store and transmit such content solely to the extent required to display it to ${user}. No sublicensing, AI training, or derivative works are permitted.`,
      BALANCED: (company, user) =>
        `${user} retains all copyright, ownership, and intellectual property rights in and to any text, images, media, or data uploaded to the Service. ${user} grants ${company} a non-exclusive, worldwide, royalty-free, revocable license solely to host, store, reproduce, and display such content strictly as necessary to operate and deliver the Service to ${user}. This license automatically terminates within thirty (30) days following the termination or deletion of ${user}'s account.`,
      CONSERVATIVE: (company, user) =>
        `${user} grants ${company} a worldwide, royalty-free license to host, display, and distribute user content solely in connection with operating the Service, terminating upon deletion of the content or account, except for reasonable system backups.`
    }
  },

  CONTENT_LICENSE: {
    title: "Non-Commercialization of User Materials Amendment",
    sectionTitle: "CONTENT COMMERCIALIZATION RESTRICTIONS",
    rationale: "Prohibits the platform from sublicensing, selling, or monetizing user content or likeness to third parties.",
    talkingPoints: [
      "Commercial sublicensing without compensation or consent compromises creator ownership.",
      "Service provider should not commercialize user materials with third-party advertisers."
    ],
    fallbackAlternative: "Permit promotional use only with explicit opt-in confirmation per campaign.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `${company} shall not sell, license, commercialize, or train any artificial intelligence or machine learning model using any content, prompt, or data provided by ${user}.`,
      BALANCED: (company, user) =>
        `${company} shall not sell, license, sublicense, or commercially exploit any content, likeness, or materials uploaded by ${user} to any third-party marketing, advertising, or artificial intelligence training partner without ${user}'s prior explicit written consent.`,
      CONSERVATIVE: (company, user) =>
        `${company} may use user materials for marketing purposes only with advance email notification and the opportunity for ${user} to opt out within ten (10) days.`
    }
  },

  AUTO_RENEWAL: {
    title: "Fair Billing, Advance Renewal Notice & 1-Click Cancellation",
    sectionTitle: "BILLING, RENEWALS & CANCELLATION",
    rationale: "Requires advance written notice prior to recurring renewals and guarantees simple, fee-free online cancellation.",
    talkingPoints: [
      "Complies with FTC Negative Option Rule and modern state automatic renewal statutes.",
      "Guarantees a 7-day advance reminder email before annual or monthly recurring charges.",
      "Ensures cancellation is as simple as registration, with no hidden phone calls or barriers."
    ],
    fallbackAlternative: "Provide 30-day money-back guarantee following any recurring renewal charge.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `No subscription shall auto-renew without affirmative written re-authorization from ${user} prior to each renewal term. Any renewal charge processed without prior authorization shall be promptly refunded in full.`,
      BALANCED: (company, user) =>
        `Subscriptions shall renew on a recurring basis only if ${company} provides ${user} with an automated electronic renewal reminder at least seven (7) days prior to each recurring charge. ${user} may cancel the subscription at any time prior to the renewal date via a clear, prominent, one-click online cancellation mechanism in the account settings, without telephone calls, penalty fees, or administrative delays.`,
      CONSERVATIVE: (company, user) =>
        `Subscriptions renew automatically, provided ${company} sends email notice at least fifteen (15) days before annual renewals. ${user} may cancel online anytime before the billing date.`
    }
  },

  CANCELLATION_TERMINATION: {
    title: "Advance Notice & Cure Period for Account Termination",
    sectionTitle: "SUSPENSION & TERMINATION",
    rationale: "Replaces 'sole discretion' immediate termination with 30-day advance notice, cure periods, and data export access.",
    talkingPoints: [
      "Abrupt termination without notice or cause destroys user data and business continuity.",
      "Provides a 15-day cure window for non-material breaches.",
      "Guarantees 30 days post-termination access to download user data."
    ],
    fallbackAlternative: "Permit immediate suspension only for verified illegal conduct, with 14 days to export non-infringing user data.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `${company} may terminate this Agreement only for material breach that remains uncured after thirty (30) days written notice. Immediate termination without cause is strictly prohibited.`,
      BALANCED: (company, user) =>
        `${company} may suspend or terminate ${user}'s account only upon at least thirty (30) days prior written notice, or upon five (5) business days written notice for material breach where ${user} has failed to cure such breach within a fifteen (15) day cure period. In the event of account termination, ${user} shall have thirty (30) days from the effective date of termination to export and retrieve all stored user data.`,
      CONSERVATIVE: (company, user) =>
        `${company} may terminate accounts for cause upon seven (7) days notice, and will provide user with access to export data for fourteen (14) days following termination.`
    }
  },

  LIABILITY_INDEMNIFICATION: {
    title: "Mutual Indemnification & Reasonable Liability Cap",
    sectionTitle: "INDEMNIFICATION & LIABILITY LIMITS",
    rationale: "Replaces one-sided, uncapped indemnification with mutual indemnity capped at fees paid over the preceding 12 months.",
    talkingPoints: [
      "Uncapped indemnity creates unacceptable financial exposure for ordinary consumer or freelance use.",
      "Mutual liability caps are standard in modern commercial contracting.",
      "Excludes damages caused by the other party's own gross negligence or willful misconduct."
    ],
    fallbackAlternative: "Cap liability at the greater of $1,000 or total fees paid during the contract term.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `${user} shall have no indemnification obligation to ${company}. ${company} shall defend and indemnify ${user} against any claims arising from platform security failures, IP infringement, or service downtime.`,
      BALANCED: (company, user) =>
        `Each party shall indemnify, defend, and hold harmless the other party against third-party claims arising from its gross negligence, willful misconduct, or material breach of this Agreement. In no event shall either party's aggregate liability under this Agreement exceed the total amounts actually paid by ${user} to ${company} in the twelve (12) months preceding the claim.`,
      CONSERVATIVE: (company, user) =>
        `User's indemnification obligation shall be limited to third-party claims directly caused by user's intentional misuse. Total liability for both parties is capped at twelve (12) months of fees paid.`
    }
  },

  UNILATERAL_CHANGES: {
    title: "Advance Notice & Prorated Exit for Contract Modifications",
    sectionTitle: "MODIFICATION OF TERMS",
    rationale: "Replaces unilateral modifications without notice with 30 days advance notice and penalty-free cancellation with refund.",
    talkingPoints: [
      "Binding users to terms changed without direct notification violates core contract notice principles.",
      "Users must have the right to decline material modifications and receive a prorated refund."
    ],
    fallbackAlternative: "Notice sent via email 14 days in advance, with termination right but standard non-refundable fees.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `No modification, amendment, or waiver of any provision of these Terms shall be effective against ${user} unless executed in an affirmative written agreement signed by both parties. Any unilateral updates by ${company} shall have no legal force.`,
      BALANCED: (company, user) =>
        `${company} shall provide at least thirty (30) calendar days prior written notice via email of any material changes to these Terms. If ${user} does not agree to the modified terms, ${user} may terminate the account prior to the effective date of the changes and receive a prompt, prorated refund of any pre-paid, unused subscription fees.`,
      CONSERVATIVE: (company, user) =>
        `${company} will provide notice of material changes 30 days prior to effectiveness. User's continued use after the 30-day notice period constitutes acceptance of non-material revisions.`
    }
  },

  PRIVACY_DATA_SHARING: {
    title: "Strict Third-Party Data Sharing Restriction",
    sectionTitle: "DATA PRIVACY & THIRD-PARTY SHARING",
    rationale: "Prohibits commercial third-party data sharing, sales, and cross-context ad tracking.",
    talkingPoints: [
      "Protects user information in accordance with CCPA/CPRA, GDPR, and modern privacy frameworks.",
      "Permits sharing only with vetted infrastructure sub-processors strictly required for technical hosting."
    ],
    fallbackAlternative: "Permit aggregated and de-identified data sharing only, with guaranteed opt-out for all identifiable data.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `${company} shall not share, transfer, or disclose any user data to any external third party for any reason without explicit, contemporaneous per-instance written authorization.`,
      BALANCED: (company, user) =>
        `${company} shall not sell, lease, share, or disclose ${user}'s personal data, identifiers, or behavioral telemetry to any third party for commercial marketing, advertising, or data brokerage purposes. Data may only be shared with verified technical sub-processors under written confidentiality obligations strictly necessary to operate the Service.`,
      CONSERVATIVE: (company, user) =>
        `${company} will not sell personal data, and will provide an easy opt-out mechanism for behavioral advertising cookies and third-party trackers.`
    }
  },

  OTHER: {
    title: "Commercial Reasonableness & Mutual Standard Provision",
    sectionTitle: "GENERAL TERMS & PERFORMANCE",
    rationale: "Applies standard commercial reasonableness and mutual obligations to ambiguous contract terms.",
    talkingPoints: [
      "Ensures provisions are interpreted mutually and reasonably rather than in provider's sole discretion."
    ],
    fallbackAlternative: "Add mutual good-faith negotiation requirement before enforcement.",
    postures: {
      AGGRESSIVE: (company, user) =>
        `All provisions and conditions in this section shall be interpreted strictly in favor of ${user} and against ${company}.`,
      BALANCED: (company, user) =>
        `The parties agree that all duties, performance standards, and discretions exercised under this section shall be carried out in a commercially reasonable manner and in good faith, subject to mutual agreement.`,
      CONSERVATIVE: (company, user) =>
        `The parties agree to act in good faith and with reasonable commercial diligence in the exercise of their rights under this section.`
    }
  }
};

// Aliases for categories that map to the standard templates
const CATEGORY_ALIASES = {
  PRIVACY_DATA_COLLECTION: "PRIVACY_DATA_SHARING",
  DATA_RETENTION: "PRIVACY_DATA_SHARING",
  ACCOUNT_RESTRICTIONS: "CANCELLATION_TERMINATION",
  WAIVER_OF_RIGHTS: "CLASS_ACTION_WAIVER",
  UNREASONABLE_RESTRICTIONS: "OTHER",
  FEES_PAYMENTS: "AUTO_RENEWAL",
  LIABILITY_LIMITATION: "LIABILITY_INDEMNIFICATION",
  IP_OWNERSHIP_CONTENT: "USER_CONTENT_RIGHTS"
};

/**
 * Generates an attorney-vetted counter-proposal and redline diff for a given clause or category.
 *
 * @param {Object} params
 * @param {string} [params.categoryId] - Canonical category ID
 * @param {string} [params.clauseText] - Original clause text
 * @param {string} [params.originalEvidence] - Alias for clauseText
 * @param {string} [params.posture="BALANCED"] - AGGRESSIVE | BALANCED | CONSERVATIVE
 * @param {string} [params.companyName="Service Provider"] - Provider name
 * @param {string} [params.userName="User"] - User name
 * @param {string} [params.context] - Additional context
 * @returns {Object} Structured amendment proposal
 */
export function generateAmendmentProposal(params = {}) {
  const rawCat = params.categoryId || params.category;
  const catMeta = getRiskCategory(rawCat);
  const normalizedCatId = catMeta?.id || rawCat || "OTHER";
  const mappedTemplateKey = BALANCED_TEMPLATES[normalizedCatId]
    ? normalizedCatId
    : (CATEGORY_ALIASES[normalizedCatId] || "OTHER");

  const template = BALANCED_TEMPLATES[mappedTemplateKey] || BALANCED_TEMPLATES.OTHER;
  const rawPosture = String(params.posture || "BALANCED").toUpperCase();
  const posture = ["AGGRESSIVE", "BALANCED", "CONSERVATIVE"].includes(rawPosture)
    ? rawPosture
    : "BALANCED";

  const company = (params.companyName || params.parties?.vendor || "Service Provider").trim();
  const user = (params.userName || params.parties?.user || params.counterpartyName || "User").trim();
  const originalClause = (params.clauseText || params.originalEvidence || params.evidence || "").trim();

  const generatorFn = template.postures[posture] || template.postures.BALANCED;
  const proposedAmendment = generatorFn(company, user);

  // Compute word-level redline diff
  const redline = computeWordDiff(originalClause, proposedAmendment);

  return {
    categoryId: normalizedCatId,
    categoryDisplayName: catMeta?.displayName || template.title,
    title: template.title,
    sectionTitle: template.sectionTitle || "AMENDED PROVISION",
    rationale: template.rationale,
    posture,
    talkingPoints: template.talkingPoints,
    originalClause,
    proposedAmendment,
    proposedClause: proposedAmendment, // alias for backwards compatibility
    fallbackAlternative: template.fallbackAlternative,
    redline: {
      diffChunks: redline.diffChunks || redline,
      htmlDiff: redline.htmlDiff,
      stats: redline.stats
    },
    disclaimer: NEGOTIATION_DISCLAIMER
  };
}

/**
 * Backward compatibility alias for generateClauseAmendment.
 */
export function generateClauseAmendment(params = {}) {
  return generateAmendmentProposal(params);
}

/**
 * Compiles multiple accepted amendments into a formal Contract Amendment Rider / Addendum.
 *
 * @param {Array<Object>|Object} firstArg - Array of amendments or config object
 * @param {Object} [secondArg] - Options if firstArg is Array
 * @returns {Object} Structured Contract Rider
 */
export function buildContractRider(firstArg = {}, secondArg = {}) {
  let amendments = [];
  let options = {};

  if (Array.isArray(firstArg)) {
    amendments = firstArg;
    options = secondArg || {};
  } else if (firstArg && typeof firstArg === "object") {
    amendments = Array.isArray(firstArg.amendments) ? firstArg.amendments : [];
    options = firstArg;
  }

  if (amendments.length === 0) {
    throw new AppError(400, "A non-empty 'amendments' array is required to compile a Contract Amendment Rider.");
  }

  const agreementTitle = options.agreementTitle || options.contractTitle || "Terms of Service";
  const vendor = (options.companyName || options.parties?.vendor || "Service Provider").trim();
  const counterparty = (options.counterpartyName || options.parties?.user || "Customer / User").trim();
  const effectiveDate = options.effectiveDate || new Date().toISOString().split("T")[0];

  let doc = `# CONTRACT AMENDMENT RIDER\n\n`;
  doc += `**Relating to:** ${agreementTitle}  \n`;
  doc += `**Effective Date:** ${effectiveDate}  \n`;
  doc += `**Parties:**\n`;
  doc += `- **Provider:** ${vendor}  \n`;
  doc += `- **Counterparty / User:** ${counterparty}  \n\n`;

  doc += `### RECITALS\n\n`;
  doc += `WHEREAS, the parties have entered into or are entering into the ${agreementTitle} ("Agreement"); and\n\n`;
  doc += `WHEREAS, the parties desire to amend and modify the Agreement as set forth herein to establish mutually fair and commercially standard terms;\n\n`;
  doc += `NOW, THEREFORE, the parties agree as follows:\n\n`;

  doc += `### AMENDED PROVISIONS\n\n`;

  amendments.forEach((item, index) => {
    const num = index + 1;
    const catId = item.categoryId || "OTHER";
    const template = BALANCED_TEMPLATES[catId] || BALANCED_TEMPLATES[CATEGORY_ALIASES[catId]] || BALANCED_TEMPLATES.OTHER;
    const secTitle = item.sectionTitle || template.sectionTitle || item.title || `AMENDED PROVISION ${num}`;
    const orig = item.originalClause || item.clauseText || "";
    const prop = item.proposedAmendment || item.proposedClause || "";

    doc += `#### SECTION ${num}: ${secTitle.toUpperCase()}\n\n`;
    if (orig) {
      doc += `*Existing Provision:*  \n`;
      doc += `> "${orig.replace(/\n/g, " ")}"  \n\n`;
      doc += `*is hereby deleted, superseded, and replaced in its entirety with the following:*  \n\n`;
    }
    doc += `"${prop}"\n\n`;
    doc += `---\n\n`;
  });

  doc += `### GENERAL PROVISIONS\n\n`;
  doc += `1. **Conflict & Precedence:** In the event of any conflict or inconsistency between this Rider and the Agreement, this Rider shall govern and control.\n`;
  doc += `2. **Full Force & Effect:** Except as specifically modified by this Rider, all terms and conditions of the Agreement shall remain in full force and effect.\n`;
  doc += `3. **Counterparts:** This Rider may be executed in counterparts and electronically.\n\n`;

  doc += `### SIGNATURES & EXECUTION\n\n`;
  doc += `IN WITNESS WHEREOF, the parties have executed this Contract Amendment Rider as of ${effectiveDate}.\n\n`;
  doc += `**PROVIDER: ${vendor}**  \n`;
  doc += `Signature: ______________________________________  \n`;
  doc += `Name: ______________________ Title: _____________ Date: ____________\n\n`;
  doc += `**COUNTERPARTY: ${counterparty}**  \n`;
  doc += `Signature: ______________________________________  \n`;
  doc += `Name: ______________________ Title: _____________ Date: ____________\n\n`;

  doc += `> [!NOTE]\n`;
  doc += `> ${NEGOTIATION_DISCLAIMER}\n`;

  return {
    agreementTitle,
    companyName: vendor,
    vendor, // alias
    counterpartyName: counterparty,
    user: counterparty, // alias
    effectiveDate,
    clauseCount: amendments.length,
    totalAmendments: amendments.length, // alias
    markdown: doc,
    documentMarkdown: doc, // alias
    disclaimer: NEGOTIATION_DISCLAIMER
  };
}
