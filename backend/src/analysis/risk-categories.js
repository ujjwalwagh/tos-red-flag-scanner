/**
 * Centralized Legal Risk Categories for TOS Red Flag Scanner (Phase 5).
 *
 * Provides a single source of truth for category definitions, friendly aliases,
 * descriptions, default user concern weights, and severity characteristics.
 */

export const RISK_CATEGORIES = {
  ARBITRATION: {
    id: "ARBITRATION",
    displayName: "Arbitration & Class Action Waiver",
    aliases: ["arbitration", "class_action", "dispute_resolution", "jury_waiver", "dispute"],
    description: "Forces disputes into private, binding arbitration and prohibits joining class-action lawsuits or jury trials.",
    defaultWeight: 5,
    severityCharacteristics: "HIGH",
    impactDomain: "Legal Rights & Due Process",
    whatToWatchFor: "Loss of court access, shortened dispute notice windows, and location of arbitration."
  },

  PRIVACY_DATA_SHARING: {
    id: "PRIVACY_DATA_SHARING",
    displayName: "Data Sharing & Third-Party Disclosure",
    aliases: ["privacy", "data_sharing", "third_party_tracking", "cookies", "data_broker"],
    description: "Permits sharing, selling, or transmitting personal data, usage tracking, and device details with third parties or affiliates.",
    defaultWeight: 5,
    severityCharacteristics: "HIGH",
    impactDomain: "Privacy & Data Protection",
    whatToWatchFor: "Vague partner categories, commercial monetization of personal data, and lack of opt-out mechanisms."
  },

  DATA_RETENTION: {
    id: "DATA_RETENTION",
    displayName: "Indefinite Data Retention & Deletion Limits",
    aliases: ["data_retention", "retention", "data_collection", "storage"],
    description: "Allows the service to retain personal data, backups, or account logs indefinitely even after account closure or termination.",
    defaultWeight: 4,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Privacy & Data Protection",
    whatToWatchFor: "Lack of deletion commitments, perpetual backup retention, and rights upon account deletion."
  },

  USER_CONTENT_RIGHTS: {
    id: "USER_CONTENT_RIGHTS",
    displayName: "Broad User Content Rights & Ownership",
    aliases: ["user_content_rights", "content_rights", "user_content", "ip_rights", "content_license"],
    description: "Demands broad, irrevocable, perpetual, royalty-free licenses to use, modify, commercialize, or sublicense user-uploaded content.",
    defaultWeight: 4,
    severityCharacteristics: "HIGH",
    impactDomain: "Intellectual Property & Creator Rights",
    whatToWatchFor: "Perpetual or irrevocable grants, sublicensing rights, and lack of compensation or attribution."
  },

  CONTENT_LICENSE: {
    id: "CONTENT_LICENSE",
    displayName: "Commercial Content Sub-licensing",
    aliases: ["content_license", "licensing", "intellectual_property", "ip"],
    description: "Allows the platform to sublicense or distribute your creative works, likeness, or materials to third-party commercial partners.",
    defaultWeight: 4,
    severityCharacteristics: "HIGH",
    impactDomain: "Intellectual Property & Creator Rights",
    whatToWatchFor: "Commercial transferability and use of user likeness/content for advertising."
  },

  AUTO_RENEWAL: {
    id: "AUTO_RENEWAL",
    displayName: "Automatic Subscription Renewal & Recurring Billing",
    aliases: ["auto_renewal", "subscription", "recurring_billing", "billing", "payment", "pricing"],
    description: "Automatically charges payment methods on recurring intervals unless canceled before strict cutoff deadlines.",
    defaultWeight: 4,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Financial & Billing",
    whatToWatchFor: "Renewal notification promises, cancellation notice window requirements, and price change policies."
  },

  REFUND_RESTRICTIONS: {
    id: "REFUND_RESTRICTIONS",
    displayName: "Non-Refundable Fees & Payment Forfeiture",
    aliases: ["refund_restrictions", "refund", "non_refundable", "forfeiture", "cancellation_fees"],
    description: "Stipulates that all purchases, prepaid subscriptions, and fees are strictly non-refundable under all circumstances.",
    defaultWeight: 3,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Financial & Billing",
    whatToWatchFor: "Total ban on refunds, immediate forfeiture upon service termination, and absence of pro-rated returns."
  },

  ACCOUNT_CONTROL: {
    id: "ACCOUNT_CONTROL",
    displayName: "Unilateral Account Suspension & Deletion",
    aliases: ["account_control", "account_suspension", "account_restrictions", "suspension", "account"],
    description: "Grants the platform total discretion to suspend, disable, or delete user accounts without prior notice or explanation.",
    defaultWeight: 3,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Account Governance & Continuity",
    whatToWatchFor: "Immediate termination without cause, inability to retrieve data, and loss of prepaid access."
  },

  TERMINATION_RIGHTS: {
    id: "TERMINATION_RIGHTS",
    displayName: "Immediate Contract Termination Rights",
    aliases: ["termination_rights", "termination", "cancellation"],
    description: "Gives the company broad rights to terminate the agreement at any time for any reason without liability or notice.",
    defaultWeight: 3,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Account Governance & Continuity",
    whatToWatchFor: "Surviving obligations after termination and lack of cure periods."
  },

  LIABILITY_LIMITATIONS: {
    id: "LIABILITY_LIMITATIONS",
    displayName: "Limitation of Liability & Warranty Disclaimers",
    aliases: ["liability_limitations", "liability", "disclaimer", "as_is", "warranties"],
    description: "Caps maximum recoverable damages to trivial amounts (or fees paid) and disclaims liability for data loss, downtime, or security breaches.",
    defaultWeight: 3,
    severityCharacteristics: "HIGH",
    impactDomain: "Legal Liability & Consumer Protection",
    whatToWatchFor: "Damage caps pegged to nominal fees, exclusion of gross negligence, and disclaimer of fitness."
  },

  INDEMNIFICATION: {
    id: "INDEMNIFICATION",
    displayName: "Broad User Indemnification Obligations",
    aliases: ["indemnification", "indemnity", "hold_harmless", "legal_fees"],
    description: "Requires you to defend, hold harmless, and pay the company's legal fees in disputes arising from your use of the service.",
    defaultWeight: 3,
    severityCharacteristics: "HIGH",
    impactDomain: "Legal Liability & Consumer Protection",
    whatToWatchFor: "Obligation to pay company legal expenses and indemnification for third-party claims."
  },

  UNILATERAL_CHANGES: {
    id: "UNILATERAL_CHANGES",
    displayName: "Unilateral Terms Modification",
    aliases: ["unilateral_changes", "changes_to_terms", "modifications", "amendment", "terms_changes"],
    description: "Allows the service to modify terms at any time with continued use constituting binding acceptance without affirmative notice.",
    defaultWeight: 3,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Contract Governance",
    whatToWatchFor: "Lack of direct email/in-app notification and automatic deemed consent."
  },

  GOVERNING_LAW: {
    id: "GOVERNING_LAW",
    displayName: "Exclusive Foreign Venue & Governing Law",
    aliases: ["governing_law", "jurisdiction", "venue", "foreign_court"],
    description: "Specifies a specific jurisdiction or remote venue for all legal actions, requiring you to litigate far from home.",
    defaultWeight: 2,
    severityCharacteristics: "LOW",
    impactDomain: "Legal Rights & Due Process",
    whatToWatchFor: "Remote state or country jurisdiction and waiver of home-state consumer protections."
  },

  DISPUTE_RESOLUTION: {
    id: "DISPUTE_RESOLUTION",
    displayName: "Informal Dispute Escalation & Filing Windows",
    aliases: ["dispute_resolution", "informal_dispute", "statute_of_limitations"],
    description: "Imposes mandatory pre-dispute negotiation periods or severely shortened deadlines to file claims (e.g., 1-year limits).",
    defaultWeight: 2,
    severityCharacteristics: "MEDIUM",
    impactDomain: "Legal Rights & Due Process",
    whatToWatchFor: "Drastically shortened filing windows and mandatory negotiation hurdles."
  },

  GENERAL_RISK: {
    id: "GENERAL_RISK",
    displayName: "General Policy Risk",
    aliases: ["general", "general_risk", "standard_terms"],
    description: "General contractual obligations or boilerplate provisions carrying potential consumer disadvantage.",
    defaultWeight: 2,
    severityCharacteristics: "INFO",
    impactDomain: "General Terms",
    whatToWatchFor: "Boilerplate terms that limit remedies or bind user behavior."
  },

  OTHER: {
    id: "OTHER",
    displayName: "Other Identified Legal Risk",
    aliases: ["other", "miscellaneous", "uncategorized"],
    description: "Uncategorized or novel contractual provisions flagged for consumer review.",
    defaultWeight: 2,
    severityCharacteristics: "INFO",
    impactDomain: "General Terms",
    whatToWatchFor: "Unusual or non-standard contractual covenants."
  }
};

/**
 * Normalizes any category string or alias to a canonical Category ID.
 * @param {string} input - Category ID or alias (e.g. "privacy", "ARBITRATION", "auto_renewal")
 * @returns {string} Canonical category ID or "OTHER"
 */
export function normalizeCategoryId(input) {
  if (typeof input !== "string" || !input.trim()) return "OTHER";
  const clean = input.trim().toUpperCase().replace(/[\s-]+/g, "_");

  // Direct match by ID key
  if (RISK_CATEGORIES[clean]) {
    return clean;
  }

  const lower = input.trim().toLowerCase();
  const cleanLower = lower.replace(/[^a-z0-9]/g, "");

  // Match canonical ID or display name
  for (const cat of Object.values(RISK_CATEGORIES)) {
    if (cat.id.toLowerCase() === lower || cat.id.toLowerCase().replace(/_/g, "") === cleanLower) {
      return cat.id;
    }
    if (cat.displayName.toLowerCase() === lower || cat.displayName.toLowerCase().replace(/[^a-z0-9]/g, "") === cleanLower) {
      return cat.id;
    }
  }

  // Check aliases (exact, without underscores, or alphanumeric match)
  for (const cat of Object.values(RISK_CATEGORIES)) {
    if (cat.aliases.some((alias) => {
      const aLower = alias.toLowerCase();
      return aLower === lower || aLower.replace(/[^a-z0-9]/g, "") === cleanLower;
    })) {
      return cat.id;
    }
  }

  // Fuzzy substring match for composite clauses containing known aliases
  for (const cat of Object.values(RISK_CATEGORIES)) {
    for (const alias of cat.aliases) {
      const aLower = alias.toLowerCase().replace(/_/g, " ");
      if (aLower.length >= 5 && (lower.includes(aLower) || aLower.includes(lower))) {
        return cat.id;
      }
    }
  }

  return "OTHER";
}

/**
 * Retrieves the full category metadata object.
 * @param {string} input - Category ID or alias
 * @returns {Object} Category definition
 */
export function getRiskCategory(input) {
  const canonicalId = normalizeCategoryId(input);
  return RISK_CATEGORIES[canonicalId] || RISK_CATEGORIES.OTHER;
}

/**
 * Returns all risk categories as an array suitable for API responses or UI rendering.
 * @returns {Array<Object>}
 */
export function getAllRiskCategories() {
  return Object.values(RISK_CATEGORIES);
}
