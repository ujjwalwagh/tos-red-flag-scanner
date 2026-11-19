/**
 * Token Generator Utility for TOS Red Flag Scanner (Phase 8C.3B).
 *
 * Generates a cryptographically secure 256-bit random hexadecimal token
 * for API Bearer authentication.
 *
 * Usage:
 *   node scripts/generate-token.mjs
 */

import crypto from "node:crypto";

const token = `tos_live_${crypto.randomBytes(32).toString("hex")}`;
console.log("\n=======================================================");
console.log("Generated Cryptographically Secure API Bearer Token:");
console.log("=======================================================");
console.log(token);
console.log("=======================================================");
console.log("INSTRUCTIONS:");
console.log("1. For Express API Bearer Authentication (client <-> backend):");
console.log("   API_BEARER_TOKEN=" + token);
console.log("   ENABLE_API_AUTH=true");
console.log("2. For Internal Service Authentication (backend <-> python microservice):");
console.log("   INTERNAL_AI_SERVICE_TOKEN=" + token);
console.log("3. NEVER commit this token to Git.");
console.log("4. NEVER hardcode this token in the Chrome extension source code.");
console.log("=======================================================\n");
