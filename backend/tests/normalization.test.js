import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText, countWords, countCharacters } from "../src/processing/normalization/text-normalizer.js";

test("normalizes unicode and smart quotes to standard characters", () => {
  const input = "“Company” won\u2019t be liable \u2014 under any \u00ABterms\u00BB.";
  const normalized = normalizeText(input);

  assert.equal(normalized, '"Company" won\'t be liable - under any "terms".');
});

test("reconstructs hyphenated line-break words", () => {
  const input = "You enter into an agree-\nment and provide infor-\nmation to the service.";
  const normalized = normalizeText(input);

  assert.ok(normalized.includes("agreement"));
  assert.ok(normalized.includes("information"));
  assert.ok(!normalized.includes("agree-"));
});

test("preserves distinct paragraph breaks while unwrapping soft line wraps", () => {
  const input =
    "This is line one of first paragraph.\n" +
    "This is line two of first paragraph.\n\n" +
    "This is the second paragraph.\n" +
    "With its own continuous sentence.";

  const normalized = normalizeText(input);
  const paragraphs = normalized.split("\n\n");

  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0], "This is line one of first paragraph. This is line two of first paragraph.");
  assert.equal(paragraphs[1], "This is the second paragraph. With its own continuous sentence.");
});

test("preserves numbered lists within paragraphs", () => {
  const input = "Terms of Service:\n1. First rule\n2. Second rule\n3. Third rule";
  const normalized = normalizeText(input);

  assert.ok(normalized.includes("1. First rule\n2. Second rule\n3. Third rule"));
});

test("calculates word and character counts accurately", () => {
  const text = "Arbitration clause binds all parties to individual proceedings.";
  assert.equal(countWords(text), 8);
  assert.equal(countCharacters(text), text.length);

  assert.equal(countWords(""), 0);
  assert.equal(countCharacters(""), 0);
});

test("strictly preserves original legal terminology without alteration", () => {
  const legalJargon = "Notwithstanding the foregoing, user indemnifies and holds harmless the Licensor.";
  const normalized = normalizeText(legalJargon);

  assert.equal(normalized, legalJargon);
});
