import axios from "axios";
import * as cheerio from "cheerio";
import { normalizeExtractedText } from "./src/ingestion/url/fetch-policy-text.js";
import { RULE_DEFINITIONS } from "./src/analysis/rule-engine/rule-definitions.js";

async function main() {
  const targetUrl = "https://policies.google.com/terms";

  // ==========================================
  // 1. FETCH GOOGLE TERMS
  // ==========================================
  console.log("=== HTTP FETCH ===");
  let response = null;
  let fetchSucceeded = false;
  let fetchError = null;

  try {
    response = await axios.get(targetUrl, {
      timeout: 15_000,
      headers: {
        "User-Agent": "ToS-Scanner/1.0 (+https://example.local) policy-analyzer bot",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
      },
      maxRedirects: 5
    });
    fetchSucceeded = response.status >= 200 && response.status < 400;
  } catch (err) {
    fetchSucceeded = false;
    fetchError = err;
  }

  if (!fetchSucceeded || !response) {
    console.log(`Request Succeeded: NO`);
    console.log(`Error: ${fetchError?.message || "Unknown network error"}`);
    if (response) {
      console.log(`HTTP Status: ${response.status}`);
    }
    console.log("\n=== DIAGNOSTIC CONCLUSION ===");
    console.log("Conclusion: A");
    console.log("Details: The policy text could not be fetched due to network or HTTP error.");
    return;
  }

  const httpStatus = response.status;
  const finalUrl = response.request?.res?.responseUrl || response.config?.url || targetUrl;

  console.log(`Target URL:        ${targetUrl}`);
  console.log(`HTTP Status:       ${httpStatus}`);
  console.log(`Final URL:         ${finalUrl}`);
  console.log(`Request Succeeded: YES`);

  // ==========================================
  // 2. EXTRACT THE POLICY TEXT
  // ==========================================
  console.log("\n=== EXTRACTED TEXT STATISTICS ===");
  const html = String(response.data || "");
  const $ = cheerio.load(html);

  // Remove irrelevant elements: script, style, navigation, header, footer, SVG, etc.
  $("script, style, noscript, svg, canvas, header, footer, nav, aside").remove();

  // Preserve meaningful headings and paragraph boundaries
  $("br").replaceWith("\n");
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).prepend("\n\n").append("\n\n");
  });
  $("p, li, blockquote, tr").each((_, el) => {
    $(el).append("\n\n");
  });

  const rawExtracted = $("main, article, body").first().text();
  const extractedText = normalizeExtractedText(rawExtracted);

  console.log(`Total Extracted Text Length: ${extractedText.length} characters`);
  const wordCount = extractedText.trim().split(/\s+/).filter(Boolean).length;
  console.log(`Estimated Word Count:       ${wordCount} words`);

  console.log("\n--- LAST 500 CHARACTERS ---");
  const last500 = extractedText.slice(-500);
  console.log(last500);

  // ==========================================
  // 3. FIRST 500 CHARACTERS
  // ==========================================
  console.log("\n=== FIRST 500 CHARACTERS ===");
  const first500 = extractedText.slice(0, 500);
  console.log(first500);

  // ==========================================
  // 4. SUBSTANTIVE PHRASE SEARCH
  // ==========================================
  console.log("\n=== SUBSTANTIVE PHRASE SEARCH ===");
  const targetPhrases = [
    "settling disputes",
    "arbitration",
    "limitation of liability",
    "terminate or suspend"
  ];

  function extractContextSnippet(text, matchIndex, matchLength, padding = 300) {
    const start = Math.max(0, matchIndex - padding);
    const end = Math.min(text.length, matchIndex + matchLength + padding);
    const before = text.slice(start, matchIndex).replace(/\s+/g, " ");
    const matched = text.slice(matchIndex, matchIndex + matchLength);
    const after = text.slice(matchIndex + matchLength, end).replace(/\s+/g, " ");
    return (start > 0 ? "..." : "") + before + " [" + matched + "] " + after + (end < text.length ? "..." : "");
  }

  const substantiveResults = {};

  for (const phrase of targetPhrases) {
    const lowerText = extractedText.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerPhrase);

    console.log(`\nPhrase: "${phrase}"`);
    if (matchIndex !== -1) {
      substantiveResults[phrase] = true;
      console.log(`Status:             FOUND`);
      console.log(`Character Position: ${matchIndex}`);
      console.log(`Context Snippet (up to 300 chars before/after):`);
      console.log(extractContextSnippet(extractedText, matchIndex, phrase.length, 300));
    } else {
      substantiveResults[phrase] = false;
      console.log(`Status:             NOT FOUND`);
    }
  }

  // ==========================================
  // 5. BROADER CLAUSE SEARCH
  // ==========================================
  console.log("\n=== BROADER CLAUSE SEARCH ===");
  const broaderVariations = [
    "dispute resolution",
    "courts",
    "liability",
    "termination",
    "suspend your access"
  ];

  const broaderResults = {};

  for (const variation of broaderVariations) {
    const lowerText = extractedText.toLowerCase();
    const lowerVar = variation.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerVar);

    console.log(`\nVariation: "${variation}"`);
    if (matchIndex !== -1) {
      // Count total matches
      let count = 0;
      let pos = matchIndex;
      while (pos !== -1) {
        count++;
        pos = lowerText.indexOf(lowerVar, pos + 1);
      }
      broaderResults[variation] = { found: true, count, position: matchIndex };
      console.log(`Status:             FOUND (${count} match${count > 1 ? "es" : ""})`);
      console.log(`First Position:     ${matchIndex}`);
      console.log(`Context Snippet:`);
      console.log(extractContextSnippet(extractedText, matchIndex, variation.length, 150));
    } else {
      broaderResults[variation] = { found: false, count: 0, position: -1 };
      console.log(`Status:             NOT FOUND`);
    }
  }

  // ==========================================
  // 6. GOVERNING-LAW RULE RESULTS
  // ==========================================
  console.log("\n=== GOVERNING-LAW RULE RESULTS ===");

  const govLawRule = RULE_DEFINITIONS.find((r) => r.id === "RULE_GOVERNING_LAW");
  const patterns = govLawRule?.patterns || [];

  console.log(`Governing-Law Rule ID: ${govLawRule?.id || "RULE_GOVERNING_LAW"}`);
  console.log(`Rule Title:            ${govLawRule?.title || "N/A"}`);
  console.log(`Category ID:           ${govLawRule?.categoryId || "N/A"}`);
  console.log(`Patterns Tested:       ${patterns.length}`);

  let matchedCount = 0;
  const matchedPatterns = [];
  const unmatchedPatterns = [];

  patterns.forEach((pattern, index) => {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(extractedText);
    if (match) {
      matchedCount++;
      matchedPatterns.push({ index: index + 1, pattern: pattern.toString(), match: match[0], position: match.index });
    } else {
      unmatchedPatterns.push({ index: index + 1, pattern: pattern.toString() });
    }
  });

  console.log(`Patterns Matched:      ${matchedCount}`);
  console.log(`Patterns Unmatched:    ${unmatchedPatterns.length}`);

  if (matchedPatterns.length > 0) {
    console.log("\nMatched Patterns:");
    matchedPatterns.forEach((m) => {
      console.log(`  [Pattern ${m.index}] ${m.pattern}`);
      console.log(`    Matched text: "${m.match}" at position ${m.position}`);
    });
  } else {
    console.log("\nMatched Patterns:      None");
  }

  console.log("\nUnmatched Patterns:");
  unmatchedPatterns.forEach((u) => {
    console.log(`  [Pattern ${u.index}] ${u.pattern}`);
  });

  // ==========================================
  // 7. DIAGNOSTIC CONCLUSION
  // ==========================================
  console.log("\n=== DIAGNOSTIC CONCLUSION ===");

  const anySubstantiveFound =
    substantiveResults["settling disputes"] ||
    broaderResults["courts"]?.found ||
    broaderResults["liability"]?.found;

  let conclusionLetter = "D";
  let conclusionExplanation = "";

  if (!fetchSucceeded) {
    conclusionLetter = "A";
    conclusionExplanation = "The policy text could not be fetched.";
  } else if (!extractedText || extractedText.length < 500 || !anySubstantiveFound) {
    conclusionLetter = "B";
    conclusionExplanation = "The policy was fetched, but substantive clauses were not extracted.";
  } else if (anySubstantiveFound && matchedCount === 0) {
    conclusionLetter = "C";
    conclusionExplanation =
      "The substantive clauses were extracted (e.g. 'settling disputes', governing law jurisdiction, and liability terms are present in the text), but the tested governing-law detection rules did not match.";
  } else if (anySubstantiveFound && matchedCount > 0) {
    conclusionLetter = "C";
    conclusionExplanation = "Substantive clauses were extracted and governing-law patterns matched.";
  } else {
    conclusionLetter = "D";
    conclusionExplanation = "The results are inconclusive.";
  }

  console.log(`Conclusion: ${conclusionLetter}`);
  console.log(`Summary:    ${conclusionExplanation}`);
  console.log("\nEvidence:");
  console.log(`1. HTTP Fetch: Success (Status ${httpStatus}) from ${finalUrl}.`);
  console.log(`2. Extraction: Succeeded (${extractedText.length} characters, ${wordCount} words).`);
  console.log(`3. Substantive Clauses in Text:`);
  console.log(`   - 'settling disputes': ${substantiveResults["settling disputes"] ? "Extracted at char " + extractedText.toLowerCase().indexOf("settling disputes") : "Not extracted"}`);
  console.log(`   - 'courts' (broader): ${broaderResults["courts"]?.found ? `Extracted (${broaderResults["courts"].count} occurrences)` : "Not extracted"}`);
  console.log(`   - 'liability' (broader): ${broaderResults["liability"]?.found ? `Extracted (${broaderResults["liability"].count} occurrences)` : "Not extracted"}`);
  console.log(`4. Rule Match: ${matchedCount}/${patterns.length} governing-law patterns matched Google's phrasing.`);
}

main().catch((err) => {
  console.error("Fatal error running diagnostic script:", err);
  process.exit(1);
});
