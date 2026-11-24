/**
 * Centralized Legal Rule Definitions for TOS Red Flag Scanner (Phase 3).
 *
 * Deterministic rule definitions covering 14 major legal categories.
 * Each rule defines detection patterns, anti-patterns (false-positive filters),
 * severity rating, non-definitive explanatory language, and category metadata.
 *
 * NOTE: Severity indicates potential user impact and review priority;
 * it does NOT represent a definitive legal conclusion or illegality.
 */

export const SEVERITY_LEVELS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INFO: "INFO"
};

export const RULE_DEFINITIONS = [
  // 1. ARBITRATION / CLASS ACTION WAIVER
  {
    id: "RULE_ARBITRATION",
    categoryId: "ARBITRATION",
    category: "Dispute Resolution & Legal Rights",
    title: "Mandatory Arbitration Clause",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Requires disputes to be resolved through private binding arbitration rather than in court.",
    explanation: "This provision appears to mandate private arbitration for disputes, which may waive your constitutional right to a court trial and traditional discovery procedures.",
    patterns: [
      /\b(?:binding|mandatory|exclusive)\s+arbitration\b/i,
      /\barbitration\s+(?:shall|will|must)\s+be\s+(?:the\s+exclusive|mandatory|conducted)\b/i,
      /\bagree\s+to\s+(?:resolve|settle)\s+(?:all\s+)?(?:disputes|claims|controversies)\s+(?:solely\s+)?(?:through|by|via)\s+(?:binding\s+)?arbitration\b/i,
      /\barbitration\s+under\s+the\s+(?:rules|auspices)\s+of\s+the\s+(?:AAA|JAMS|American\s+Arbitration|ICC)\b/i
    ],
    secondaryKeywords: ["arbitrator", "arbitral", "award", "claim", "hearing"],
    negativePatterns: [
      /\bdoes\s+not\s+(?:require|mandate)\s+arbitration\b/i,
      /\bmay\s+(?:opt[- ]out|choose\s+not)\s+to\s+arbitrate\b/i
    ],
    baseConfidence: 0.95
  },

  {
    id: "RULE_CLASS_ACTION_WAIVER",
    categoryId: "ARBITRATION",
    category: "Dispute Resolution & Legal Rights",
    title: "Class-Action & Jury Trial Waiver",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Prohibits participating in class actions, collective proceedings, or jury trials against the company.",
    explanation: "This clause appears to restrict you from joining collective or class-action lawsuits, requiring any dispute to be brought on an individual basis only.",
    patterns: [
      /\bclass\s+action\s+waiver\b/i,
      /\bwaive(?:s|d|r)?\s+(?:any\s+)?(?:right\s+to\s+)?(?:participate\s+in\s+a\s+)?(?:class|collective|representative)\s+(?:action|lawsuit|proceeding)\b/i,
      /\bno\s+class\s+or\s+representative\s+proceedings\b/i,
      /\bwaive(?:s|d|r)?\s+(?:any\s+)?right\s+to\s+a\s+jury\s+trial\b/i,
      /\bbrought\s+only\s+in\s+(?:your|an)\s+individual\s+capacity\s+and\s+not\s+as\s+a\s+plaintiff\s+or\s+class\s+member\b/i
    ],
    secondaryKeywords: ["class", "representative", "jury", "waiver", "individual capacity"],
    negativePatterns: [
      /\bnot\s+waiving\s+(?:any\s+)?class\s+action\b/i
    ],
    baseConfidence: 0.94
  },

  // 2. BROAD RIGHTS TO USER CONTENT
  {
    id: "RULE_BROAD_CONTENT_RIGHTS",
    categoryId: "USER_CONTENT_RIGHTS",
    category: "Intellectual Property & Content",
    title: "Broad License to User Content",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Grants the provider sweeping, perpetual, or irrevocable rights to use, monetize, or sublicense user-uploaded content.",
    explanation: "This provision appears to grant the service an extensive license (such as perpetual, irrevocable, or sublicensable rights) to your uploaded text, media, or data.",
    patterns: [
      /\b(?:perpetual|irrevocable|worldwide|royalty-free|unrestricted)\s+(?:and\s+transferable\s+)?license\s+to\s+(?:use|reproduce|modify|distribute|display|exploit)\b/i,
      /\bgrant\s+(?:us|the\s+company|provider)\s+a\s+(?:worldwide|perpetual|non-exclusive|royalty-free)\b/i,
      /\bperpetual,\s*(?:irrevocable,\s*)?worldwide,\s*royalty-free\b/i,
      /\bright\s+to\s+sublicense,\s+(?:reproduce|distribute|modify|create\s+derivative\s+works)\b/i
    ],
    secondaryKeywords: ["user content", "submissions", "materials", "sublicensable", "derivative works"],
    negativePatterns: [
      /\bsolely\s+for\s+the\s+purpose\s+of\s+operating\s+the\s+service\b/i,
      /\bdo\s+not\s+claim\s+ownership\b/i,
      /\bthis\s+license\s+permits\s+use\s+of\s+the\s+software\b/i // don't flag software license granted to user
    ],
    baseConfidence: 0.91
  },

  // 3. AUTOMATIC SUBSCRIPTION RENEWAL
  {
    id: "RULE_AUTO_RENEWAL",
    categoryId: "AUTO_RENEWAL",
    category: "Subscriptions & Billing",
    title: "Automatic Subscription Renewal",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Subscriptions automatically renew and bill recurring payments unless explicitly cancelled prior to the renewal date.",
    explanation: "This clause addresses automatic renewal or recurring billing terms for subscriptions or services.",
    patterns: [
      /\b(?:subscription|plan|service)\s+(?:will\s+)?(?:automatically\s+renew(?:s)?|renew(?:s)?\s+automatically)\b/i,
      /\bautomatic\s+renewal\s+(?:of\s+your\s+subscription|terms|policy)\b/i,
      /\brecurring\s+(?:billing|subscription|charges)\b/i,
      /\brecurring\s+payments?\s+(?:will\s+(?:automatically\s+)?continue|until\s+cancell?ed|for\s+(?:your\s+)?subscription)\b/i,
      /\b(?:will\s+)?(?:automatically\s+renew(?:s)?|renew(?:s)?\s+automatically)\b/i,
      /\bwill\s+continue\s+to\s+bill\s+(?:your\s+payment\s+method\s+)?on\s+a\s+recurring\s+basis\b/i,
      /\b(?:enrolled\s+in|subject\s+to)\s+recurring\s+(?:billing|charges|subscription)\b/i,
      /\b(?:set\s+up|choose\s+to\s+set\s+up|allows?\s+(?:users?|you)\s+to|lets?\s+(?:users?|you)|configure|enable|optionally\s+set\s+up)\s+(?:[a-z\s]{0,25})?recurring\s+payments\b/i,
      /\b(?:must\s+cancel|cancel)\s+(?:at\s+least\s+)?\d+\s+(?:days?|hours?|weeks?)\s+(?:before|prior\s+to)\s+(?:the\s+)?(?:renewal|end\s+of|expiration\s+of|expiration\s+date|renewal\s+date)\b/i,
      /\b(?:(?:written\s+)?notice\s+of\s+cancell?ation|cancell?ation\s+notice|cancell?ation)\s+(?:must\s+be\s+received|must\s+be\s+given|is\s+required)\s+(?:at\s+least\s+)?\d+\s+(?:days?|hours?|weeks?)\s+(?:before|prior\s+to)\s+(?:the\s+)?(?:renewal|end\s+of|expiration\s+of|expiration\s+date|renewal\s+date)\b/i
    ],
    secondaryKeywords: ["billing cycle", "cancel before", "auto-renew", "credit card", "charge"],
    negativePatterns: [
      /\bdoes\s+not\s+automatically\s+renew\b/i,
      /\bmanual\s+renewal\s+only\b/i,
      /\b"(?:autopay|recurring\s+payments?)"\s+means\b/i
    ],
    baseConfidence: 0.93
  },

  // 4. DATA RETENTION
  {
    id: "RULE_DATA_RETENTION",
    categoryId: "DATA_RETENTION",
    category: "Privacy & Data Rights",
    title: "Post-Termination Data Retention",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Provider retains user personal data or content even after account deletion or service termination.",
    explanation: "This provision notes that certain user data, account records, or backups may be retained or archived by the company even after you delete your account.",
    patterns: [
      /\bretain\s+(?:your\s+)?(?:data|information|content|records)\s+(?:after|following)\s+(?:account\s+)?(?:deletion|termination|closure)\b/i,
      /\bdata\s+(?:may\s+be\s+)?retained\s+in\s+(?:our\s+)?(?:backups|archives|disaster\s+recovery)\b/i,
      /\bretention\s+period\s+(?:for\s+personal\s+data|is\s+indefinite|exceeds)\b/i,
      /\bwe\s+may\s+continue\s+to\s+store\s+(?:your\s+)?(?:information|content)\s+indefinitely\b/i,
      /\breserve\s+the\s+right\s+to\s+retain\s+(?:copies|data)\b/i
    ],
    secondaryKeywords: ["retention", "archive", "backups", "deletion", "stored"],
    negativePatterns: [
      /\bpermanently\s+(?:delete|destroy)\s+all\s+(?:data|records)\s+immediately\b/i,
      /\bwe\s+do\s+not\s+retain\b/i
    ],
    baseConfidence: 0.88
  },

  // 5. ACCOUNT CONTROL / SUSPENSION
  {
    id: "RULE_ACCOUNT_SUSPENSION",
    categoryId: "ACCOUNT_CONTROL",
    category: "Account Governance",
    title: "Account Suspension Without Notice",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Provider reserves the right to suspend, freeze, or restrict your account at any time without advance warning.",
    explanation: "This clause appears to allow the company to suspend, block, or restrict your account access immediately without prior notice or explanation.",
    patterns: [
      /\b(?:suspend|disable|block|restrict)\s+(?:your\s+)?(?:account|access)\s+(?:immediately\s+)?without\s+(?:prior\s+)?notice\b/i,
      /\bmay\s+(?:suspend|terminate)\s+(?:your\s+)?(?:account|service)\s+at\s+any\s+time\s+without\s+notice\b/i,
      /\bwithout\s+prior\s+warning\s+or\s+notice,\s*(?:we\s+may\s+)?(?:suspend|freeze|terminate)\b/i,
      /\bsole\s+discretion\s+to\s+(?:suspend|deactivate|freeze)\s+(?:your\s+)?account\b/i
    ],
    secondaryKeywords: ["sole discretion", "without liability", "immediate effect", "freeze"],
    negativePatterns: [
      /\bwill\s+provide\s+(?:at\s+least\s+)?\d+\s+days\s+(?:advance\s+)?notice\b/i
    ],
    baseConfidence: 0.92
  },

  // 6. TERMINATION RIGHTS
  {
    id: "RULE_TERMINATION_RIGHTS",
    categoryId: "TERMINATION_RIGHTS",
    category: "Account Governance",
    title: "Unilateral Termination at Will",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Provider may terminate the agreement or service at its sole discretion without cause.",
    explanation: "This provision indicates that the company may discontinue services or terminate your agreement at will, potentially without cause or compensation.",
    patterns: [
      /\bterminate\s+(?:this\s+agreement|your\s+access|the\s+service)\s+at\s+(?:our|its)\s+sole\s+discretion\b/i,
      /\bterminate\s+(?:at\s+any\s+time\s+)?with\s+or\s+without\s+cause\b/i,
      /\breserve\s+the\s+right\s+to\s+(?:discontinue|cease|terminate)\s+(?:the\s+service|this\s+agreement)\s+for\s+any\s+reason\b/i,
      /\btermination\s+without\s+(?:cause|liability)\b/i
    ],
    secondaryKeywords: ["without cause", "at will", "sole discretion", "discontinue"],
    negativePatterns: [
      /\byou\s+may\s+terminate\s+(?:at\s+any\s+time)?\b/i // user termination right is normal
    ],
    baseConfidence: 0.89
  },

  // 7. LIABILITY LIMITATIONS
  {
    id: "RULE_LIABILITY_LIMITATION",
    categoryId: "LIABILITY_LIMITATIONS",
    category: "Liability & Warranties",
    title: "Broad Limitation of Liability & Consequential Damages Waiver",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Disclaims liability for indirect, incidental, or consequential damages and heavily caps monetary recovery.",
    explanation: "This provision disclaims liability for indirect or consequential losses (such as lost profits or lost data) and caps the maximum damages you can recover to a nominal amount or recent fees paid.",
    patterns: [
      /\b(?:in\s+no\s+event|under\s+no\s+circumstances)\s+shall\s+(?:the\s+)?(?:company|provider|licensor)\s+be\s+liable\s+for\s+(?:any\s+)?(?:indirect|consequential|incidental|punitive|special)\s+damages\b/i,
      /\blimitation\s+of\s+liability\b/i,
      /\btotal\s+liability\s+(?:shall\s+not\s+exceed|capped\s+at)\s+(?:the\s+amount\s+paid|\$\d+|one\s+hundred\s+dollars)\b/i,
      /\bdisclaim(?:s|ed|er)?\s+(?:all\s+)?(?:implied\s+)?warranties\s+(?:including|of\s+merchantability)\b/i,
      /\bprovided\s+on\s+an\s+["']as\s+is["']\s+and\s+["']as\s+available["']\s+basis\b/i
    ],
    secondaryKeywords: ["consequential damages", "incidental damages", "lost profits", "liability cap", "as is"],
    negativePatterns: [],
    baseConfidence: 0.94
  },

  // 8. INDEMNIFICATION
  {
    id: "RULE_INDEMNIFICATION",
    categoryId: "INDEMNIFICATION",
    category: "Liability & Warranties",
    title: "Broad User Indemnification Obligation",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Requires you to indemnify, defend, and hold harmless the company against third-party claims, legal fees, and liabilities.",
    explanation: "This clause obligates you to defend the company and cover their legal costs, attorney fees, or damages if a claim arises from your use of the service.",
    patterns: [
      /\byou\s+agree\s+to\s+(?:defend,\s+)?indemnify(?:,\s+and\s+hold\s+harmless)?\s+(?:the\s+company|us|our\s+affiliates)\b/i,
      /\bindemnify\s+and\s+hold\s+harmless\b/i,
      /\bindemnification\s+obligations\b/i,
      /\bhold\s+(?:the\s+company|us|provider)\s+harmless\s+from\s+(?:any\s+)?(?:claims|liabilities|losses|damages|expenses|attorneys['']?\s+fees)\b/i
    ],
    secondaryKeywords: ["indemnify", "hold harmless", "attorneys' fees", "defense", "damages"],
    negativePatterns: [
      /\bcompany\s+agrees\s+to\s+indemnify\s+(?:you|user)\b/i // provider indemnifying user is a benefit
    ],
    baseConfidence: 0.95
  },

  // 9. PRIVACY / DATA SHARING
  {
    id: "RULE_DATA_SHARING",
    categoryId: "PRIVACY_DATA_SHARING",
    category: "Privacy & Data Rights",
    title: "Third-Party Data Sharing & Commercial Disclosure",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Authorizes sharing, licensing, or commercial distribution of personal or behavioral data with third parties.",
    explanation: "This clause notes that user information, usage telemetry, or identifiers may be shared with or sold to third-party commercial partners, affiliates, or advertising networks.",
    patterns: [
      /\bshare\s+(?:your\s+)?(?:personal\s+)?(?:data|information|details)\s+with\s+(?:third[- ]parties|third[- ]party\s+(?:advertising\s+partners|marketing\s+affiliates|partners|vendors)|advertising\s+partners|marketing\s+affiliates)\b/i,
      /\bdisclose\s+(?:personal\s+)?information\s+to\s+(?:third[- ]party\s+vendors|commercial\s+partners|advertisers)\b/i,
      /\bsale\s+(?:or\s+sharing\s+)?of\s+personal\s+(?:data|information)\b/i,
      /\bprovide\s+your\s+(?:data|information)\s+to\s+third\s+parties\s+for\s+(?:targeted\s+advertising|promotional\s+purposes)\b/i
    ],
    secondaryKeywords: ["third parties", "advertising partners", "commercial", "monetize", "analytics"],
    negativePatterns: [
      /\b(?:we\s+)?(?:do\s+not|will\s+not|shall\s+not|never)\s+(?:sell|share)\s+(?:your\s+)?(?:personal\s+)?(?:information|data)\b/i,
      /\b(?:will\s+not|shall\s+not|do\s+not|never)\s+share\b.*?\bwithout\s+(?:user\s+|your\s+|express\s+|prior\s+)?consent\b/i,
      /\bwe\s+respect\s+your\s+privacy\b/i, // contextual false positive check
      /\bsolely\s+with\s+essential\s+infrastructure\s+processors\b/i
    ],
    baseConfidence: 0.89
  },

  // 10. GOVERNING LAW & JURISDICTION
  {
    id: "RULE_GOVERNING_LAW",
    categoryId: "GOVERNING_LAW",
    category: "Dispute Resolution & Legal Rights",
    title: "Governing Law Specification",
    severity: SEVERITY_LEVELS.LOW,
    description: "Designates the governing state or national laws applicable to the agreement.",
    explanation: "This clause designates the governing state or country law that controls the interpretation of this agreement and any contractual claims.",
    patterns: [
      // Active governing law: "California law will govern these terms", "The laws of Delaware shall govern this agreement"
      /\b(?:the\s+laws\s+of\s+[A-Z][a-zA-Z\s]{1,30}|[A-Z][a-zA-Z\s]{1,30}?\s+law)\s+(?:will|shall)\s+govern\s+(?:these\s+terms|this\s+agreement|the\s+relationship|all\s+disputes?|any\s+disputes?|all\s+claims|any\s+claims)\b/i,
      // Passive with subject: "These terms are governed by the laws of California", "This agreement shall be governed by the laws of..."
      /\b(?:this\s+agreement|these\s+terms|all\s+disputes?|any\s+disputes?)\s+(?:shall\s+be|will\s+be|is|are)\s+governed\s+by\s+(?:and\s+construed\s+in\s+accordance\s+with\s+)?(?:the\s+)?laws\s+of\s+(?:the\s+state\s+of|the\s+country\s+of|the\s+commonwealth\s+of)?\s*[A-Z][a-zA-Z\s]{1,30}\b/i,
      // General passive: "...governed by and construed in accordance with the laws of [State]..."
      /\bgoverned\s+by\s+(?:and\s+construed\s+(?:in\s+accordance\s+with|under)\s+)?(?:the\s+)?laws\s+of\s+(?:the\s+state\s+of|the\s+country\s+of|the\s+commonwealth\s+of)?\s*[A-Z][a-zA-Z\s,]+\b/i,
      // Choice of law clause identifier
      /\b(?:choice\s+of\s+law|governing\s+law)\s+(?:clause|provision|shall\s+be)\b/i,
      // Exclusive court jurisdiction & venue patterns
      /\bexclusive\s+jurisdiction\s+(?:and\s+venue\s+)?of\s+(?:the\s+)?(?:(?:state\s+or\s+federal|federal\s+or\s+state|state|federal)\s+)?courts\s+(?:located\s+in|of)\b/i,
      /\bresolved\s+exclusively\s+in\s+the\s+(?:federal\s+or\s+state\s+|state\s+or\s+federal\s+)?courts\s+(?:located\s+in|of)\b/i,
      /\byou\s+(?:irrevocably\s+)?consent\s+to\s+(?:the\s+)?(?:personal|exclusive)\s+jurisdiction\s+(?:and\s+venue\s+)?(?:in|of)\b/i,
      /\bforum\s+selection\s+clause\b/i
    ],
    secondaryKeywords: ["governing law", "jurisdiction", "venue", "courts located in", "consent to jurisdiction", "laws of", "will govern"],
    negativePatterns: [],
    baseConfidence: 0.90
  },

  // 11. UNILATERAL TERMS CHANGES
  {
    id: "RULE_UNILATERAL_CHANGES",
    categoryId: "UNILATERAL_CHANGES",
    category: "Contract Modifications",
    title: "Unilateral Modification of Terms Without Direct Notice",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Provider reserves the right to modify terms at any time with continued use deemed as full acceptance.",
    explanation: "This clause states the company can alter or replace terms at its sole discretion, and that your continued use of the service constitutes agreement to the updated terms.",
    patterns: [
      /\bwe\s+reserve\s+the\s+right\s+to\s+(?:modify|update|change|amend|revise)\s+(?:these\s+terms|this\s+agreement)\s+at\s+any\s+time\b/i,
      /\bterms\s+may\s+be\s+(?:modified|updated)\s+without\s+(?:prior\s+)?notice\b/i,
      /\bcontinued\s+use\s+(?:of\s+the\s+service\s+)?(?:following|after)\s+(?:any\s+)?changes\s+(?:constitutes|shall\s+constitute)\s+(?:your\s+)?acceptance\b/i,
      /\bmodifications\s+(?:shall\s+be|become)\s+effective\s+immediately\s+upon\s+posting\b/i
    ],
    secondaryKeywords: ["continued use", "effective upon posting", "modify at any time", "deemed acceptance"],
    negativePatterns: [
      /\bwe\s+will\s+notify\s+you\s+at\s+least\s+30\s+days\s+in\s+advance\s+of\s+any\s+material\s+changes\b/i
    ],
    baseConfidence: 0.93
  },

  // 12. BINDING DISPUTE RESOLUTION
  {
    id: "RULE_DISPUTE_RESOLUTION",
    categoryId: "DISPUTE_RESOLUTION",
    category: "Dispute Resolution & Legal Rights",
    title: "Binding Pre-Dispute Informal Resolution & Time Limitations",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Imposes mandatory pre-dispute notice periods or shortened statutes of limitations on claims.",
    explanation: "This provision requires an informal dispute negotiation period or shortens the legal time window within which you are permitted to bring a claim.",
    patterns: [
      /\bany\s+claim\s+(?:or\s+cause\s+of\s+action\s+)?must\s+be\s+filed\s+within\s+(?:one\s+\(1\)\s+year|\d+\s+(?:months|year|days))\b/i,
      /\bmandatory\s+informal\s+dispute\s+resolution\s+process\b/i,
      /\bmust\s+(?:first\s+)?provide\s+(?:written\s+)?notice\s+of\s+dispute\s+before\s+filing\b/i,
      /\bshortened\s+statute\s+of\s+limitations\b/i
    ],
    secondaryKeywords: ["claim must be filed within", "notice of dispute", "informal resolution", "forever barred"],
    negativePatterns: [],
    baseConfidence: 0.88
  },

  // 13. CONTENT LICENSE
  {
    id: "RULE_CONTENT_LICENSE",
    categoryId: "CONTENT_LICENSE",
    category: "Intellectual Property & Content",
    title: "User-to-Service Content License Grant",
    severity: SEVERITY_LEVELS.MEDIUM,
    description: "Requires users to grant a broad operational license over all submitted feedback, suggestions, or uploaded media.",
    explanation: "This clause specifies that any feedback, comments, or content you submit becomes licensed to the service without compensation or attribution.",
    patterns: [
      /\bgrant\s+(?:to\s+us|to\s+the\s+company)\s+a\s+(?:non-exclusive|royalty-free)\s+(?:license\s+to\s+)?(?:use|host|store|reproduce|publish)\s+your\s+content\b/i,
      /\bfeedback\s+(?:or\s+suggestions\s+)?(?:shall\s+become|is)\s+(?:the\s+sole\s+property|licensed\s+without\s+compensation)\b/i,
      /\byou\s+retain\s+ownership,\s+but\s+grant\s+(?:us\s+)?a\s+license\b/i
    ],
    secondaryKeywords: ["user content", "feedback", "license grant", "royalty-free", "suggestions"],
    negativePatterns: [
      /\bthis\s+license\s+permits\s+use\s+of\s+the\s+software\b/i, // software license to user
      /\byou\s+are\s+granted\s+a\s+limited\s+license\s+to\s+access\b/i
    ],
    baseConfidence: 0.87
  },

  // 14. CANCELLATION / REFUND RESTRICTIONS
  {
    id: "RULE_REFUND_RESTRICTIONS",
    categoryId: "REFUND_RESTRICTIONS",
    category: "Subscriptions & Billing",
    title: "Strict No-Refund Policy & Cancellation Penalties",
    severity: SEVERITY_LEVELS.HIGH,
    description: "Disclaims all refunds, establishes non-refundable payments, or restricts prorated credits upon cancellation.",
    explanation: "This provision states that all purchases and subscription fees are non-refundable, with no prorated refunds or credits provided upon early cancellation.",
    patterns: [
      /\b(?:all\s+fees|payments|purchases)\s+are\s+non-refundable\b/i,
      /\bno\s+refunds\s+(?:or\s+credits\s+)?(?:will\s+be\s+provided|given|issued)\b/i,
      /\bnon-refundable\s+and\s+non-transferable\b/i,
      /\bcancellation\s+(?:fees|penalties|must\s+be\s+received\s+at\s+least\s+\d+\s+days\s+prior)\b/i,
      /\bno\s+prorated\s+(?:refunds|credits)\s+for\s+partial\s+(?:months|periods)\b/i
    ],
    secondaryKeywords: ["non-refundable", "no refunds", "cancellation fee", "prorated", "credits"],
    negativePatterns: [
      /\bfull\s+refund\s+guaranteed\s+within\b/i,
      /\b30-day\s+money-back\s+guarantee\b/i
    ],
    baseConfidence: 0.94
  }
];

/**
 * Returns a map of rule definitions indexed by ID.
 */
export const RULE_MAP = new Map(RULE_DEFINITIONS.map((r) => [r.id, r]));

/**
 * Returns rules filtered by category ID.
 * @param {string} categoryId
 * @returns {Array<Object>}
 */
export function getRulesByCategory(categoryId) {
  return RULE_DEFINITIONS.filter((r) => r.categoryId === categoryId);
}
