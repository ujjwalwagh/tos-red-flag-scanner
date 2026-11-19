/**
 * LangChain Zod-based Structured Output Schemas for TOS Red Flag Scanner (Phase 8B.1).
 *
 * Provides typed, validated schemas for model output handling via .withStructuredOutput().
 * Replaces ad-hoc regex parsing and manual JSON extraction with standard Zod validation.
 */

import { z } from "zod";

/**
 * Zod schema defining the contract for evidence-grounded Q&A answers.
 * Mirrors the schema previously enforced in prompt instructions and backend controllers.
 */
export const qaAnswerSchema = z.object({
  answer: z
    .string()
    .min(1, "Answer string cannot be empty")
    .describe(
      "Plain-English answer directly grounded in the evidence, or an explicit statement that the document does not provide enough information"
    ),
  grounded: z
    .boolean()
    .describe(
      "true if the answer is directly supported by the supplied evidence; false if evidence is insufficient or question cannot be answered"
    ),
  confidence: z
    .number()
    .min(0, "Confidence cannot be below 0.0")
    .max(1, "Confidence cannot exceed 1.0")
    .describe("Confidence score between 0.0 and 1.0 representing certainty in the grounded answer"),
  relevantClauseIds: z
    .array(z.string())
    .default([])
    .describe(
      "List of exact clauseIds from the supplied evidence that directly support the answer. Empty array if grounded is false."
    )
});

/**
 * Minimal structured output schema for testing and demonstration.
 */
export const exampleStructuredSchema = z.object({
  summary: z
    .string()
    .min(1, "Summary must be non-empty")
    .describe("Brief summary of the evaluated text"),
  isCompliant: z
    .boolean()
    .describe("Whether the text is compliant with standard terms"),
  riskScore: z
    .number()
    .min(0, "Risk score must be at least 0")
    .max(10, "Risk score must be at most 10")
    .describe("Assessed risk score from 0 to 10")
});

/**
 * Generic validator for any Zod schema.
 *
 * @param {z.ZodTypeAny} schema
 * @param {unknown} data
 * @returns {{ success: boolean, data?: any, errors?: string[] }}
 */
export function validateStructuredOutput(schema, data) {
  if (!schema || typeof schema.safeParse !== "function") {
    return {
      success: false,
      errors: ["Invalid schema provided for validation"]
    };
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
  );
  return {
    success: false,
    errors
  };
}

/**
 * Validates data specifically against the qaAnswerSchema.
 *
 * @param {unknown} data
 * @returns {{ success: boolean, data?: any, errors?: string[] }}
 */
export function validateQaAnswer(data) {
  return validateStructuredOutput(qaAnswerSchema, data);
}
