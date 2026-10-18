/**
 * Architectural Interfaces & Type Contracts for TOS Red Flag Scanner.
 * Documents the standard contracts exchanged between ingestion, processing,
 * rule engine, AI semantic analysis, and API delivery.
 */

/**
 * @typedef {Object} DocumentMetadata
 * @property {string} filename - Sanitized filename of the uploaded document
 * @property {number} [fileSizeBytes] - Size in bytes
 * @property {number} pageCount - Total number of pages
 * @property {number} extractedPageCount - Pages with sufficient text extracted
 * @property {number[]} unextractablePages - Page numbers requiring OCR
 * @property {boolean} requiresOcr - Flag indicating scanned image presence
 * @property {string|null} ocrNotice - Human-readable guidance if OCR needed
 * @property {number} wordCount - Total word count
 * @property {number} characterCount - Total character count
 * @property {string} processedAt - ISO 8601 timestamp
 */

/**
 * @typedef {Object} DocumentPage
 * @property {number} pageNumber - 1-indexed page number
 * @property {string} rawText - Unmodified extracted text
 * @property {string} normalizedText - Cleaned, normalized text
 * @property {number} characterCount - Normalized character count
 * @property {number} wordCount - Word count
 * @property {"extracted"|"requires_ocr"} extractionStatus - Extraction health
 */

/**
 * @typedef {Object} ClauseSegment
 * @property {number} segmentIndex - Sequential index across the whole document
 * @property {number} pageNumber - Source page number
 * @property {string} title - Detected heading or title
 * @property {string} clauseCategory - Heuristic category tag
 * @property {string} text - Segment clause text
 * @property {number} wordCount - Segment word count
 * @property {number} charCount - Segment character count
 */

/**
 * @typedef {Object} AnalysisFinding
 * @property {string} findingId - Unique finding identifier
 * @property {string} ruleId - Associated rule ID or 'AI_DETECTION'
 * @property {string} categoryId - Categorization code (e.g. ARBITRATION)
 * @property {string} category - Display name for category
 * @property {string} title - Finding title
 * @property {"HIGH"|"MEDIUM"|"LOW"|"INFO"} severity - Potential user risk impact
 * @property {number} confidence - Score between 0.00 and 1.00
 * @property {string} explanation - Non-definitive, plain-English explanation
 * @property {string} evidence - Excerpt from the policy text
 * @property {number} pageNumber - Source page number
 * @property {number} segmentIndex - Source segment index
 * @property {boolean} [ruleDetected] - True if detected by deterministic rule
 * @property {boolean} [aiDetected] - True if detected or enriched by AI
 * @property {string} detectionMethod - 'rule_based' | 'ai_enhanced' | 'ai_only'
 */

export const INTERFACE_VERSION = "2.0.0";
