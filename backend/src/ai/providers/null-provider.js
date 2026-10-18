/**
 * Null AI Provider for TOS Red Flag Scanner (Phase 4).
 *
 * Used when no AI API key is configured in the environment.
 * Returns a clean "unavailable" result without making any network calls,
 * enabling graceful degradation to Phase 3 rule-based results only.
 *
 * This provider is selected automatically by the provider factory when
 * NVIDIA_API_KEY (or any future key) is absent from the environment.
 */

export class NullProvider {
  constructor() {
    this.name = "null";
  }

  /**
   * Returns an "unavailable" result immediately without any I/O.
   *
   * @returns {Promise<{ available: false, reason: string }>}
   */
  async analyzeClause(_clauseContext) {
    return { available: false, reason: "no_api_key_configured" };
  }

  /**
   * Returns an "unavailable" result for Q&A immediately without any I/O.
   *
   * @returns {Promise<{ available: false, reason: string }>}
   */
  async answerQuestion(_questionContext) {
    return { available: false, reason: "no_api_key_configured" };
  }
}
