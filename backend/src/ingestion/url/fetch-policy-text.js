import axios from "axios";
import * as cheerio from "cheerio";
import { AppError, validatePolicyUrl } from "../../security/security.js";

const MAX_DOWNLOAD_BYTES = 1_500_000;
const MAX_REDIRECT_HOPS = 4;
export const MAX_POLICY_TEXT_LENGTH = 64_000;

export async function fetchPolicyText(url) {
  let response = null;
  let currentUrl = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      response = await axios.get(currentUrl.toString(), {
        timeout: 12_000,
        responseType: "text",
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        maxRedirects: 0,
        headers: {
          "User-Agent":
            "ToS-Scanner/1.0 (+https://example.local) policy-analyzer bot",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
        },
        validateStatus: (status) => status >= 200 && status < 400
      });

      if (response.status >= 300 && response.status < 400) {
        if (hop === MAX_REDIRECT_HOPS) {
          throw new AppError(422, "Too many redirects while fetching policy URL.");
        }

        const location = String(response.headers.location || "").trim();
        if (!location) {
          throw new AppError(422, "Policy URL returned an invalid redirect.");
        }

        const redirectedUrl = new URL(location, currentUrl);
        currentUrl = await validatePolicyUrl(redirectedUrl.toString());
        continue;
      }

      break;
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      422,
      "Could not fetch this URL. Try a public Terms or Privacy page."
    );
  }

  if (!response) {
    throw new AppError(422, "Could not fetch this URL. Try a public Terms or Privacy page.");
  }

  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new AppError(422, "Unsupported content type. Expected HTML or plain text.");
  }

  const html = String(response.data || "");
  const extracted = extractReadableText(html);

  // Keep payload size predictable and avoid oversized analysis input.
  return extracted.slice(0, MAX_POLICY_TEXT_LENGTH);
}

export function extractReadableText(html) {
  if (!html || typeof html !== "string") return "";
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,canvas,footer nav,header nav,aside").remove();

  // Convert line breaks and preserve block spacing for headings and paragraphs
  $("br").replaceWith("\n");
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).prepend("\n\n").append("\n\n");
  });
  $("p, li, blockquote, tr").each((_, el) => {
    $(el).append("\n\n");
  });

  const text = $("main, article, body").first().text();
  return normalizeExtractedText(text);
}

export function normalizeExtractedText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function collapseWhitespace(value) {
  return normalizeExtractedText(value);
}
