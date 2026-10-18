/**
 * Curated Statutory Legal Frameworks & Rule Mappings (Phase 8).
 *
 * Defines codified legal rules, citation authorities, and unenforceability
 * baselines across major jurisdictions for commercial and consumer contracting.
 */

export const JURISDICTIONS = {
  US_FEDERAL: {
    id: "US_FEDERAL",
    displayName: "United States (Federal Law & FTC)",
    region: "US"
  },
  US_CALIFORNIA: {
    id: "US_CALIFORNIA",
    displayName: "California (CCPA/CPRA, ARL & UCL)",
    region: "US"
  },
  EU_GDPR: {
    id: "EU_GDPR",
    displayName: "European Union (GDPR, UCTD & DSA)",
    region: "EU"
  },
  UK_CRA: {
    id: "UK_CRA",
    displayName: "United Kingdom (Consumer Rights Act 2015)",
    region: "UK"
  },
  IN_CONSUMER: {
    id: "IN_CONSUMER",
    displayName: "India (Consumer Protection Act 2019 & RBI E-Mandate)",
    region: "IN"
  }
};

/**
 * Statutory rules mapped by canonical risk category.
 */
export const STATUTORY_RULES = {
  ARBITRATION: [
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "Unfair Contract Terms Directive 93/13/EEC, Annex 1(q)",
      status: "LIKELY_UNENFORCEABLE_CONSUMER",
      riskLevel: "HIGH",
      summary: "Mandatory pre-dispute arbitration clauses in standard consumer contracts are presumed unfair and void across EU member states.",
      guidance: "Consumers retain statutory rights to bring claims before their local court of domicile."
    },
    {
      jurisdiction: "UK_CRA",
      statutoryCitation: "UK Consumer Rights Act 2015, Schedule 2, Para 20",
      status: "LIKELY_UNENFORCEABLE_CONSUMER",
      riskLevel: "HIGH",
      summary: "Excluding or hindering consumer rights to take legal action or exercise legal remedies is blacklisted as unfair.",
      guidance: "Consumers cannot be forced into private arbitration without individual post-dispute agreement."
    },
    {
      jurisdiction: "US_CALIFORNIA",
      statutoryCitation: "McGill v. Citibank, N.A., 2 Cal. 5th 945 (Cal. 2017)",
      status: "POTENTIALLY_UNENFORCEABLE_PARTIAL",
      riskLevel: "MEDIUM",
      summary: "Pre-dispute arbitration agreements cannot waive statutory rights to seek public injunctive relief under California UCL or CLRA.",
      guidance: "Waiver of public injunctive relief is invalid as against California public policy."
    },
    {
      jurisdiction: "US_FEDERAL",
      statutoryCitation: "Federal Arbitration Act (FAA), 9 U.S.C. § 2",
      status: "GENERALLY_ENFORCEABLE_FEDERAL",
      riskLevel: "LOW",
      summary: "Arbitration agreements are strongly protected under federal policy unless invalidated upon general contract revocation grounds.",
      guidance: "Opt-out provisions must be exercised within statutory or contractually specified deadlines."
    }
  ],

  CLASS_ACTION_WAIVER: [
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "EU Representative Actions Directive (Directive 2020/1828)",
      status: "UNENFORCEABLE_COLLECTIVE_REDRESS",
      riskLevel: "HIGH",
      summary: "Contractual clauses prohibiting consumers from joining qualified representative actions are invalid under EU law.",
      guidance: "Designated qualified entities may file collective redress actions on behalf of consumers."
    },
    {
      jurisdiction: "UK_CRA",
      statutoryCitation: "Consumer Rights Act 2015, Part 2 & Competition Act 1998 § 47B",
      status: "UNENFORCEABLE_COLLECTIVE_REDRESS",
      riskLevel: "HIGH",
      summary: "Waivers of representative or collective proceedings in consumer matters are contrary to public policy.",
      guidance: "Consumers retain participation rights in collective proceedings where authorized."
    }
  ],

  AUTO_RENEWAL: [
    {
      jurisdiction: "US_CALIFORNIA",
      statutoryCitation: "California Automatic Renewal Law (ARL), Cal. Bus. & Prof. Code § 17600 et seq.",
      status: "STATUTORY_COMPLIANCE_MANDATE",
      riskLevel: "HIGH",
      summary: "Requires clear and conspicuous disclosure of terms, advance notice before annual renewals, and an easy one-click online cancellation mechanism.",
      guidance: "Non-compliant automatic renewals may render products or services an unconditional gift."
    },
    {
      jurisdiction: "US_FEDERAL",
      statutoryCitation: "FTC Negative Option Rule (16 C.F.R. Part 425) & ROSCA (15 U.S.C. § 8401)",
      status: "REGULATORY_ENFORCEMENT_PRIORITY",
      riskLevel: "HIGH",
      summary: "FTC requires cancellation mechanisms to be as simple as signup (click-to-cancel) with affirmative informed consent prior to charging.",
      guidance: "Dark patterns and phone-only cancellation requirements face active federal enforcement."
    },
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "German Civil Code (BGB § 309 Nr. 9b) & EU Consumer Rights Directive",
      status: "STATUTORY_CANCELLATION_CAP",
      riskLevel: "MEDIUM",
      summary: "Indefinite annual lock-ins after initial term are restricted; consumers must be permitted to cancel monthly after first term.",
      guidance: "Providers cannot lock consumers into successive multi-year renewal commitments."
    },
    {
      jurisdiction: "IN_CONSUMER",
      statutoryCitation: "RBI E-Mandate Framework & Consumer Protection Act 2019 § 2(47)",
      status: "STATUTORY_COMPLIANCE_MANDATE",
      riskLevel: "MEDIUM",
      summary: "Requires pre-debit notifications (at least 24 hours prior), explicit AFA registration, and accessible user revocation for recurring e-mandates.",
      guidance: "Users retain statutory rights to pause or revoke recurring UPI autopay mandates at any time via the payment application interface."
    }
  ],

  PRIVACY_DATA_SHARING: [
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "GDPR Regulation (EU) 2016/679, Articles 6(1)(a) & 7",
      status: "REGULATORY_VIOLATION_RISK",
      riskLevel: "CRITICAL",
      summary: "Commercial third-party data sharing without explicit, granular, and freely given consent violates core GDPR mandates.",
      guidance: "Bundling marketing data sharing into general Terms of Service is unlawful."
    },
    {
      jurisdiction: "US_CALIFORNIA",
      statutoryCitation: "CCPA/CPRA, Cal. Civ. Code § 1798.120 & § 1798.135",
      status: "STATUTORY_OPT_OUT_MANDATE",
      riskLevel: "HIGH",
      summary: "Consumers have an absolute statutory right to opt out of the 'sale' or 'sharing' of personal data for cross-context behavioral advertising.",
      guidance: "Platform must honor Global Privacy Control (GPC) signals and provide a clear opt-out mechanism."
    }
  ],

  UNILATERAL_CHANGES: [
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "Unfair Contract Terms Directive 93/13/EEC, Annex 1(j)",
      status: "PRESUMED_UNFAIR_TERM",
      riskLevel: "HIGH",
      summary: "Terms allowing the seller to alter the terms of the contract unilaterally without a valid reason specified in the contract are unfair.",
      guidance: "Advance notice and immediate penalty-free right of withdrawal must be provided."
    },
    {
      jurisdiction: "UK_CRA",
      statutoryCitation: "Consumer Rights Act 2015, Schedule 2, Para 11",
      status: "PRESUMED_UNFAIR_TERM",
      riskLevel: "HIGH",
      summary: "Clauses giving the trader discretion to change contract terms without reasonable notice and dissolution rights are non-binding.",
      guidance: "Consumers are not bound by unilateral modifications without contemporaneous informed acceptance."
    },
    {
      jurisdiction: "US_FEDERAL",
      statutoryCitation: "Douglas v. Talk America Inc., 495 F.3d 1062 (9th Cir. 2007)",
      status: "UNENFORCEABLE_WITHOUT_NOTICE",
      riskLevel: "MEDIUM",
      summary: "Posting revised terms on a website without direct affirmative notice to existing customers does not create a binding amendment.",
      guidance: "Parties already bound by a contract cannot have new burdens imposed without consideration and notice."
    }
  ],

  LIABILITY_LIMITATION: [
    {
      jurisdiction: "UK_CRA",
      statutoryCitation: "Consumer Rights Act 2015 § 65 & § 62",
      status: "STATUTORILY_PROHIBITED",
      riskLevel: "CRITICAL",
      summary: "A trader cannot by a term of a consumer contract exclude or restrict liability for death or personal injury resulting from negligence.",
      guidance: "General exclusions of liability are subject to the test of fairness and disproportionate caps are void."
    },
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "Unfair Contract Terms Directive 93/13/EEC, Annex 1(a)",
      status: "PRESUMED_UNFAIR_EXCLUSION",
      riskLevel: "HIGH",
      summary: "Clauses limiting the legal liability of a seller in the event of death, injury, or gross negligence are void.",
      guidance: "Liability caps below paid amounts are frequently struck down in European consumer jurisdictions."
    }
  ],

  USER_CONTENT_RIGHTS: [
    {
      jurisdiction: "EU_GDPR",
      statutoryCitation: "EU Copyright in the Digital Single Market Directive 2019/790 & AI Act Art. 53",
      status: "AUTHOR_PROTECTION_RESTRICTION",
      riskLevel: "HIGH",
      summary: "Perpetual moral right waivers and sweeping irrevocable licenses for AI model training overreach beyond hosting needs.",
      guidance: "Creators must have transparency regarding copyrighted work utilization for generative AI training."
    }
  ]
};
