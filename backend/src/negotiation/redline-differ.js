/**
 * Pure JavaScript Word-Level Redline Diff Engine for TOS Red Flag Scanner (Phase 7).
 *
 * Computes structured word/token-level differences (insertions, deletions, equality)
 * between original contract provisions and proposed balanced amendments.
 */

export const DIFF_TYPES = {
  EQUAL: "equal",
  DELETE: "delete",
  INSERT: "insert"
};

/**
 * Tokenizes text into words, punctuation, and whitespace sequences.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
function tokenizeWords(text = "") {
  if (typeof text !== "string") return [];
  const matches = text.match(/[\w]+|[^\w\s]|\s+/g);
  return matches || [];
}

/**
 * Counts non-whitespace words in a string.
 */
function countWords(str = "") {
  const matches = String(str).match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Computes word-level diff between original and updated text using Longest Common Subsequence (LCS).
 *
 * @param {string} oldText - Original contract clause
 * @param {string} newText - Proposed amendment clause
 * @returns {Array<{type: string, text: string}> & { diffChunks: Array, htmlDiff: string, stats: Object }}
 */
export function computeWordDiff(oldText = "", newText = "") {
  const oldTokens = tokenizeWords(oldText);
  const newTokens = tokenizeWords(newText);

  const m = oldTokens.length;
  const n = newTokens.length;

  let consolidated = [];

  if (m === 0 && n === 0) {
    consolidated = [];
  } else if (m === 0) {
    consolidated = [{ type: DIFF_TYPES.INSERT, text: newText }];
  } else if (n === 0) {
    consolidated = [{ type: DIFF_TYPES.DELETE, text: oldText }];
  } else if (oldText === newText) {
    consolidated = [{ type: DIFF_TYPES.EQUAL, text: oldText }];
  } else {
    // DP table for LCS
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldTokens[i - 1] === newTokens[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to build diff tokens
    const rawChunks = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
        rawChunks.push({ type: DIFF_TYPES.EQUAL, text: oldTokens[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rawChunks.push({ type: DIFF_TYPES.INSERT, text: newTokens[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        rawChunks.push({ type: DIFF_TYPES.DELETE, text: oldTokens[i - 1] });
        i--;
      }
    }

    rawChunks.reverse();

    // Consolidate consecutive chunks of the same type
    for (const chunk of rawChunks) {
      const last = consolidated[consolidated.length - 1];
      if (last && last.type === chunk.type) {
        last.text += chunk.text;
      } else {
        consolidated.push({ type: chunk.type, text: chunk.text });
      }
    }
  }

  // Calculate change stats
  let wordsAdded = 0;
  let wordsRemoved = 0;
  let wordsUnchanged = 0;

  for (const chunk of consolidated) {
    const wc = countWords(chunk.text);
    if (chunk.type === DIFF_TYPES.INSERT) wordsAdded += wc;
    else if (chunk.type === DIFF_TYPES.DELETE) wordsRemoved += wc;
    else if (chunk.type === DIFF_TYPES.EQUAL) wordsUnchanged += wc;
  }

  const htmlDiff = formatRedlineHtml(consolidated);
  const stats = {
    wordsAdded,
    wordsRemoved,
    wordsUnchanged,
    totalOriginalWords: countWords(oldText),
    totalProposedWords: countWords(newText)
  };

  // Attach properties to array to support both array operations and object-property access
  consolidated.diffChunks = consolidated;
  consolidated.htmlDiff = htmlDiff;
  consolidated.stats = stats;

  return consolidated;
}

/**
 * Renders diff chunks as safe HTML markup with deletions and insertions.
 *
 * @param {Array<{type: string, text: string}>} diffChunks
 * @returns {string} Safe HTML string
 */
export function formatRedlineHtml(diffChunks = []) {
  if (!Array.isArray(diffChunks)) return "";

  return diffChunks
    .map((chunk) => {
      const escaped = escapeHtml(chunk.text);
      if (chunk.type === DIFF_TYPES.DELETE) {
        return `<del class="diff-del">${escaped}</del>`;
      }
      if (chunk.type === DIFF_TYPES.INSERT) {
        return `<ins class="diff-ins">${escaped}</ins>`;
      }
      return `<span class="diff-eq">${escaped}</span>`;
    })
    .join("");
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
