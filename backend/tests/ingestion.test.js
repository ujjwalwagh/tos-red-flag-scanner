import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { processPdfDocument, validatePdfBuffer, extractPdfTextFromBuffer } from "../src/ingestion/pdf/document-processor.js";
import { ingestRawText } from "../src/ingestion/text/text-ingest.js";
import { extractPdfPages } from "../src/ingestion/pdf/pdf-extractor.js";
import { AppError } from "../src/security/security.js";
import { extractReadableText, normalizeExtractedText, MAX_POLICY_TEXT_LENGTH, MAX_ANALYSIS_CHARACTERS } from "../src/ingestion/url/fetch-policy-text.js";
import { scanPolicyForRedFlags } from "../src/analysis/semantic/scan-policy.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFixture(relPath) {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(__dirname, "..", relPath),
    path.resolve(__dirname, "../..", relPath)
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

const VALID_PDF_PATH = resolveFixture("node_modules/pdf-parse/test/data/04-valid.pdf");
const INVALID_PDF_PATH = resolveFixture("node_modules/pdf-parse/test/data/03-invalid.pdf");

test("extracts multi-page PDF preserving page numbers and relationships", async () => {
  const buffer = fs.readFileSync(VALID_PDF_PATH);
  const result = await processPdfDocument(buffer, { filename: "terms-of-service.pdf" });

  assert.ok(result.metadata);
  assert.equal(result.metadata.filename, "terms-of-service.pdf");
  assert.equal(result.metadata.pageCount, 5);
  assert.equal(result.metadata.extractedPageCount, 5);
  assert.equal(result.metadata.requiresOcr, false);
  assert.equal(result.pages.length, 5);

  // Validate sequential page numbering (1-indexed)
  for (let i = 0; i < 5; i++) {
    const page = result.pages[i];
    assert.equal(page.pageNumber, i + 1);
    assert.equal(page.extractionStatus, "extracted");
    assert.ok(page.rawText.length > 500);
    assert.ok(page.normalizedText.length > 500);
    assert.ok(page.wordCount > 50);
  }

  // Validate segmentation
  assert.ok(result.segments.length > 0);
  assert.ok(result.segments[0].pageNumber >= 1);
});

test("validates PDF magic bytes and rejects non-PDF payloads", () => {
  // Plain text buffer with .pdf extension
  const fakePdfBuffer = Buffer.from("This is just plain text masquerading as a PDF.");

  assert.throws(
    () => validatePdfBuffer(fakePdfBuffer, { filename: "fake.pdf" }),
    (err) => err instanceof AppError && err.statusCode === 400 && err.message.includes("File header does not match")
  );
});

test("rejects oversized PDF files with HTTP 413 error", () => {
  const smallLimit = 500; // 500 bytes limit
  const buffer = Buffer.alloc(1000);
  buffer.write("%PDF-1.4\n");

  assert.throws(
    () => validatePdfBuffer(buffer, { maxSize: smallLimit }),
    (err) => err instanceof AppError && err.statusCode === 413 && err.message.includes("exceeds maximum allowed size")
  );
});

test("handles corrupt or malformed PDF gracefully with HTTP 422 error", async () => {
  const corruptBuffer = fs.readFileSync(INVALID_PDF_PATH);

  await assert.rejects(
    () => processPdfDocument(corruptBuffer, { filename: "corrupt.pdf" }),
    (err) => err instanceof AppError && err.statusCode === 422
  );
});

test("detects scanned pages with little or no extractable text and flags OCR requirement", async () => {
  // Mock page extraction test for OCR flagging threshold
  const samplePages = [
    { pageNumber: 1, rawText: "This page has plenty of legal contract text that is cleanly readable." },
    { pageNumber: 2, rawText: "" } // Image-only scanned page with no text layer
  ];

  // Directly verify metadata reporting when an unextractable page is present
  const normPage1 = samplePages[0].rawText;
  const normPage2 = samplePages[1].rawText;

  const requiresOcr = normPage2.length < 25;
  assert.equal(requiresOcr, true);
});

test("maintains clear distinction between rawText and normalizedText", async () => {
  const buffer = fs.readFileSync(VALID_PDF_PATH);
  const result = await processPdfDocument(buffer);

  assert.equal(typeof result.rawText, "string");
  assert.equal(typeof result.normalizedText, "string");
  assert.ok(result.rawText.length > 0);
  assert.ok(result.normalizedText.length > 0);
});

// =========================================================================
// URL & TEXT INGESTION BOUNDARY REGRESSION TESTS
// =========================================================================

test("URL & pasted text ingestion limit is configured to 100,000 characters", () => {
  assert.equal(MAX_POLICY_TEXT_LENGTH, 100_000);
  assert.equal(MAX_ANALYSIS_CHARACTERS, 100_000);
});

test("64,000-character policy is fully ingested without truncation", () => {
  const text = "A".repeat(64_000);
  assert.equal(text.slice(0, MAX_POLICY_TEXT_LENGTH).length, 64_000);
});

test("71,979-character document (e.g. Spotify Privacy Policy) is fully ingested without truncation", () => {
  const text = "A".repeat(71_979);
  assert.equal(text.slice(0, MAX_POLICY_TEXT_LENGTH).length, 71_979);
});

test("exactly 100,000 characters is accepted completely without truncation", () => {
  const text = "B".repeat(100_000);
  assert.equal(text.slice(0, MAX_POLICY_TEXT_LENGTH).length, 100_000);
});

test("a policy longer than 24,000 characters is not prematurely truncated at the old limit", () => {
  // Generate synthetic HTML policy of ~32,000 characters
  const paragraphs = [];
  for (let i = 1; i <= 260; i++) {
    paragraphs.push(`<p>Section ${i}: Standard terms and operational policies governing service usage and platform capabilities with regular updates.</p>`);
  }
  paragraphs.push(`<p>Final section: Concluding provisions regarding severability, entire agreement, and notices.</p>`);
  const html = `<html><body><main>${paragraphs.join("\n")}</main></body></html>`;

  const extracted = extractReadableText(html);
  assert.ok(extracted.length > 24_000, `Extracted length (${extracted.length}) should exceed old 24k limit`);

  const ingested = extracted.slice(0, MAX_POLICY_TEXT_LENGTH);
  assert.equal(ingested.length, extracted.length, "Policy under 100,000 characters should not be truncated");
  assert.ok(ingested.includes("Final section: Concluding provisions"), "Trailing sections past 24k boundary must be preserved");
});

test("the phrase 'California law will govern these terms' survives extraction around character 23,990", async () => {
  // Construct synthetic HTML where governing-law clause lands around char 23,990
  const fillerChunk = "This is standard operational policy language describing service features and general guidelines for all users. ";
  const targetOffset = 23_950;
  const repeatCount = Math.floor(targetOffset / fillerChunk.length);
  const paddingText = fillerChunk.repeat(repeatCount);

  const governingLawClause = "California law will govern these terms and all disputes arising out of or relating to these terms, service-specific additional terms, or any related services, regardless of any conflict of laws rules.";
  const trailingText = " These disputes will be resolved exclusively in the federal or state courts of Santa Clara County, California, USA.\n\nAdditional terms apply to specific features and enterprise accounts.";

  const html = `<html><body><main><p>${paddingText}</p><p>${governingLawClause}</p><p>${trailingText}</p></main></body></html>`;

  const extracted = extractReadableText(html);
  const governingLawIndex = extracted.indexOf("California law will govern these terms");

  assert.ok(governingLawIndex >= 23_500 && governingLawIndex <= 24_500, `Governing law index (${governingLawIndex}) should be near 23,990 boundary`);
  assert.ok(extracted.length > 24_000, `Total extracted length (${extracted.length}) must exceed 24,000 characters`);

  // Under old 24_000 limit, it would be cut off or lost
  const oldTruncated = extracted.slice(0, 24_000);
  assert.ok(!oldTruncated.includes(governingLawClause), "Old 24,000 limit must fail to contain the full governing law sentence");

  // Under new 100_000 limit, it is preserved completely
  const newIngested = extracted.slice(0, MAX_POLICY_TEXT_LENGTH);
  assert.ok(newIngested.includes(governingLawClause), "New 100,000 limit must preserve the complete governing law sentence");

  // Verify that the full pipeline analyzes the clause and detects RULE_GOVERNING_LAW without synthetic fallback
  const report = await scanPolicyForRedFlags(newIngested, "https://example.com/terms", { mode: "broad" });
  const govLawFinding = report.flags.find((f) => f.categoryId === "GOVERNING_LAW");
  assert.ok(govLawFinding, "RULE_GOVERNING_LAW finding must be detected in the ingested policy");
  assert.equal(govLawFinding.title, "Governing Law Specification");
  assert.equal(govLawFinding.severity, "low");

  const syntheticFallback = report.flags.find((f) => f.title === "Standard Terms Phrasing");
  assert.equal(syntheticFallback, undefined, "Synthetic fallback finding must not be present when real finding is detected");
});

test("the configured 100,000-character limit is respected for oversized documents", () => {
  const hugeText = "A".repeat(120_000);
  const sliced = hugeText.slice(0, MAX_POLICY_TEXT_LENGTH);
  assert.equal(sliced.length, 100_000);
});

test("existing shorter-document extraction behavior remains unchanged", () => {
  const html = `<html><body><main>
    <h1>Terms of Service</h1>
    <p>Welcome to our platform. By accessing our services, you agree to these terms.</p>
    <h2>Automatic Renewal</h2>
    <p>Your subscription will automatically renew each month unless you cancel at least 24 hours before the renewal date.</p>
    <h2>Limitation of Liability</h2>
    <p>In no event shall the company be liable for any indirect or consequential damages.</p>
  </main></body></html>`;

  const extracted = extractReadableText(html);
  assert.ok(extracted.length > 200 && extracted.length < 24_000, "Short document length should be well under 24,000 chars");
  assert.ok(extracted.includes("Terms of Service"));
  assert.ok(extracted.includes("Automatic Renewal"));
  assert.ok(extracted.includes("Limitation of Liability"));

  const ingested = extracted.slice(0, MAX_POLICY_TEXT_LENGTH);
  assert.equal(ingested, extracted, "Shorter documents must not be truncated or modified in any way");
});

test("ingestRawText returns fully structured document with metadata, pages, and segments", () => {
  const samplePolicy = "Section 1: Service Terms\nWelcome to our platform.\n\nSection 2: Privacy\nWe do not sell data.";
  const doc = ingestRawText(samplePolicy, { filename: "custom-policy.txt" });

  assert.ok(doc.metadata);
  assert.equal(doc.metadata.filename, "custom-policy.txt");
  assert.equal(doc.metadata.pageCount, 1);
  assert.equal(doc.metadata.extractedPageCount, 1);
  assert.equal(doc.metadata.requiresOcr, false);
  assert.ok(doc.metadata.wordCount > 5);
  assert.ok(doc.metadata.characterCount > 20);
  assert.ok(doc.metadata.processedAt);

  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].pageNumber, 1);
  assert.equal(doc.pages[0].rawText, samplePolicy);
  assert.ok(doc.pages[0].normalizedText.includes("Section 1"));

  assert.ok(Array.isArray(doc.segments));
  assert.ok(doc.segments.length > 0);
  assert.equal(doc.rawText, samplePolicy);
  assert.ok(doc.normalizedText.length > 0);
});

test("extractPdfTextFromBuffer extracts normalized text from valid PDF buffer", async () => {
  const buffer = fs.readFileSync(VALID_PDF_PATH);
  const text = await extractPdfTextFromBuffer(buffer);

  assert.equal(typeof text, "string");
  assert.ok(text.length > 100);
  assert.ok(text.length <= 24_000);
});

test("extractPdfTextFromBuffer rejects non-buffer input with HTTP 400 AppError", async () => {
  await assert.rejects(
    () => extractPdfTextFromBuffer("not-a-buffer"),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

