import test from "node:test";
import assert from "node:assert/strict";
import { segmentDocumentPages } from "../src/processing/segmentation/clause-segmenter.js";

test("segments text by numbered sections and headings", () => {
  const pages = [
    {
      pageNumber: 1,
      rawText: "1. INTRODUCTION\nWelcome to our platform.\n\n2. DISPUTE RESOLUTION AND ARBITRATION\nYou agree to resolve disputes by arbitration.",
      normalizedText: "1. INTRODUCTION\nWelcome to our platform.\n\n2. DISPUTE RESOLUTION AND ARBITRATION\nYou agree to resolve disputes by arbitration."
    }
  ];

  const segments = segmentDocumentPages(pages);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].pageNumber, 1);
  assert.equal(segments[0].title, "1. INTRODUCTION");
  assert.equal(segments[0].text, "Welcome to our platform.");

  assert.equal(segments[1].pageNumber, 1);
  assert.equal(segments[1].title, "2. DISPUTE RESOLUTION AND ARBITRATION");
  assert.equal(segments[1].clauseCategory, "arbitration");
});

test("infers clause categories accurately from content", () => {
  const pages = [
    {
      pageNumber: 2,
      rawText: "SECTION 5. LIMITATION OF LIABILITY\nIn no event shall the company be liable for indirect damages.",
      normalizedText: "SECTION 5. LIMITATION OF LIABILITY\nIn no event shall the company be liable for indirect damages."
    },
    {
      pageNumber: 3,
      rawText: "ARTICLE 8. PRIVACY AND DATA SHARING\nWe collect personal information and share cookies with third parties.",
      normalizedText: "ARTICLE 8. PRIVACY AND DATA SHARING\nWe collect personal information and share cookies with third parties."
    }
  ];

  const segments = segmentDocumentPages(pages);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].clauseCategory, "liability");
  assert.equal(segments[0].pageNumber, 2);

  assert.equal(segments[1].clauseCategory, "privacy");
  assert.equal(segments[1].pageNumber, 3);
});

test("preserves page numbers across multiple pages", () => {
  const pages = [
    {
      pageNumber: 1,
      rawText: "Page 1 Content block",
      normalizedText: "Page 1 Content block"
    },
    {
      pageNumber: 2,
      rawText: "Page 2 Content block",
      normalizedText: "Page 2 Content block"
    }
  ];

  const segments = segmentDocumentPages(pages);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].pageNumber, 1);
  assert.equal(segments[1].pageNumber, 2);
});
