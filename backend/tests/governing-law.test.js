import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSegment } from "../src/analysis/rule-engine/clause-analyzer.js";
import { RULE_DEFINITIONS } from "../src/analysis/rule-engine/rule-definitions.js";
import { normalizeCategoryId } from "../src/analysis/risk-categories.js";

// =========================================================================
// GOVERNING LAW & JURISDICTION DETECTION REGRESSION SUITE
// =========================================================================

test("1. 'California law will govern these terms' is recognized as governing-law wording", () => {
  const sentence = "California law will govern these terms and all disputes arising out of or relating to these terms.";
  const findings = analyzeSegment({ text: sentence, pageNumber: 1, segmentIndex: 0 });

  assert.equal(findings.length, 1);
  const f = findings[0];

  assert.equal(f.ruleId, "RULE_GOVERNING_LAW");
  assert.equal(f.categoryId, "GOVERNING_LAW");
  assert.equal(normalizeCategoryId(f.categoryId), "GOVERNING_LAW");
  assert.equal(f.title, "Governing Law Specification");
  assert.equal(f.severity, "LOW");
  assert.equal(f.evidence, sentence);
  assert.ok(f.explanation.includes("governing state or country law"));
});

test("2. 'This agreement shall be governed by the laws of California' is recognized", () => {
  const sentence = "This agreement shall be governed by the laws of California.";
  const findings = analyzeSegment({ text: sentence, pageNumber: 1, segmentIndex: 1 });

  assert.equal(findings.length, 1);
  const f = findings[0];

  assert.equal(f.ruleId, "RULE_GOVERNING_LAW");
  assert.equal(f.categoryId, "GOVERNING_LAW");
  assert.equal(f.title, "Governing Law Specification");
  assert.equal(f.severity, "LOW");
  assert.equal(f.evidence, sentence);
});

test("3. Existing supported governing-law and choice-of-law wording still works", () => {
  const sentence = "This agreement is governed by and construed in accordance with the laws of the State of Delaware.";
  const findings = analyzeSegment({ text: sentence, pageNumber: 1, segmentIndex: 2 });

  assert.equal(findings.length, 1);
  const f = findings[0];

  assert.equal(f.ruleId, "RULE_GOVERNING_LAW");
  assert.equal(f.categoryId, "GOVERNING_LAW");
  assert.equal(f.title, "Governing Law Specification");
  assert.equal(f.severity, "LOW");
  assert.equal(f.evidence, sentence);
});

test("4. A governing-law clause alone does NOT produce a mandatory-arbitration finding", () => {
  const clauses = [
    "California law will govern these terms and all disputes arising out of or relating to these terms.",
    "This agreement shall be governed by the laws of California.",
    "These terms are governed by the laws of the State of New York."
  ];

  for (const clause of clauses) {
    const findings = analyzeSegment({ text: clause });
    const arbitrationFinding = findings.find(
      (f) => f.ruleId === "RULE_ARBITRATION" || f.categoryId === "ARBITRATION"
    );
    assert.equal(
      arbitrationFinding,
      undefined,
      `Governing-law clause '${clause}' must not create an arbitration finding`
    );
  }
});

test("5. A governing-law clause alone does NOT produce an exclusive-court-jurisdiction finding", () => {
  const clause = "California law will govern these terms and all disputes arising out of or relating to these terms.";
  const findings = analyzeSegment({ text: clause });

  assert.equal(findings.length, 1);
  const f = findings[0];

  // Must not claim exclusive court jurisdiction or venue
  assert.equal(f.title, "Governing Law Specification");
  assert.notEqual(f.title, "Exclusive Court Jurisdiction & Venue");
  assert.ok(!f.title.toLowerCase().includes("exclusive"));
  assert.ok(!f.title.toLowerCase().includes("venue"));
  assert.ok(!f.explanation.toLowerCase().includes("exclusive court jurisdiction"));
  assert.ok(!f.explanation.toLowerCase().includes("distant venue"));
});

test("5b. Explicit exclusive court venue IS recognized with its proper title", () => {
  const venueClause = "Any legal action shall be brought in the exclusive jurisdiction of the federal or state courts located in New York.";
  const findings = analyzeSegment({ text: venueClause });

  assert.equal(findings.length, 1);
  const f = findings[0];

  assert.equal(f.ruleId, "RULE_GOVERNING_LAW");
  assert.equal(f.categoryId, "GOVERNING_LAW");
  assert.equal(f.title, "Exclusive Court Jurisdiction & Venue");
  assert.ok(f.explanation.includes("exclusive court jurisdiction"));
  assert.equal(f.severity, "LOW");
});

test("6. Unrelated text does NOT trigger the governing-law rule", () => {
  const unrelatedSamples = [
    "Our cloud platform runs on 100% renewable energy with automated daily backups.",
    "Users can upload photos, edit descriptions, and comment on public forum posts.",
    "We comply with California law regarding environmental standards for our office buildings.",
    "Federal courts across the nation review antitrust regulations.",
    "Setting and governing your privacy preferences is easy with our account dashboard.",
    "Nothing in these terms limits rights that cannot be waived by consumer contracts."
  ];

  for (const text of unrelatedSamples) {
    const findings = analyzeSegment({ text });
    const govLawFinding = findings.find((f) => f.categoryId === "GOVERNING_LAW");
    assert.equal(
      govLawFinding,
      undefined,
      `Unrelated text '${text}' must not trigger GOVERNING_LAW`
    );
  }
});

test("7. RULE_GOVERNING_LAW definition exports bounded patterns with LOW severity", () => {
  const rule = RULE_DEFINITIONS.find((r) => r.id === "RULE_GOVERNING_LAW");
  assert.ok(rule, "RULE_GOVERNING_LAW must be defined in RULE_DEFINITIONS");
  assert.equal(rule.categoryId, "GOVERNING_LAW");
  assert.equal(rule.severity, "LOW");
  assert.ok(Array.isArray(rule.patterns));
  assert.ok(rule.patterns.length >= 4);

  // Check pattern matching on Google terms phrasing
  const googleSentence = "California law will govern these terms and all disputes arising out of or relating to these terms, service-specific additional terms, or any related services, regardless of any conflict of laws.";
  const hasMatch = rule.patterns.some((p) => p.test(googleSentence));
  assert.ok(hasMatch, "RULE_GOVERNING_LAW patterns must match Google's active governing-law phrasing");
});
