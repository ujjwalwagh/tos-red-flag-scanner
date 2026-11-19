/**
 * Phase 9.4.1 — Gemini AI Provider Tests.
 *
 * Verifies GeminiProvider adapter contract, error shielding, timeout safety,
 * response normalization, provider factory resolution, and NullProvider fallback.
 * All tests use in-process mock HTTP servers without external network calls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { GeminiProvider, buildPrompt } from "../src/ai/providers/gemini-provider.js";
import { NullProvider } from "../src/ai/providers/null-provider.js";
import { createAiProvider } from "../src/ai/provider-factory.js";
import { AiAnalysisService } from "../src/ai/ai-service.js";

// Helper to spawn a temporary mock HTTP server for deterministic Gemini API mocking
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

const SAMPLE_ANALYSIS_DATA = {
  categoryId: "ARBITRATION",
  category: "Arbitration & Dispute Resolution",
  title: "Mandatory Binding Arbitration",
  severity: "HIGH",
  semanticAssessment: "Forces all claims into private binding arbitration.",
  plainEnglish: "You cannot take this company to court or join a class action.",
  whyItMatters: "Eliminates your right to a jury trial and collective legal action.",
  confidence: 0.95
};

test("GeminiProvider: initializes correctly with default and custom options", () => {
  const defaultProvider = new GeminiProvider();
  assert.equal(defaultProvider.name, "gemini");
  assert.equal(defaultProvider.model, 'gemini-2.5-pro');
  assert.equal(defaultProvider.timeout, 25000);
  assert.equal(defaultProvider.apiKey, "");

  const customProvider = new GeminiProvider({
    apiKey: "test_custom_key",
    model: "gemini-1.5-pro",
    timeout: 12000,
    baseUrl: "http://localhost:9999/v1"
  });
  assert.equal(customProvider.name, "gemini");
  assert.equal(customProvider.apiKey, "test_custom_key");
  assert.equal(customProvider.model, "gemini-1.5-pro");
  assert.equal(customProvider.timeout, 12000);
  assert.equal(customProvider.baseUrl, "http://localhost:9999/v1");
});

test("GeminiProvider: returns unavailable when no API key is provided", async () => {
  const provider = new GeminiProvider({ apiKey: "" });
  const result = await provider.analyzeClause({
    clauseText: "You agree to resolve all disputes by binding arbitration."
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, "no_api_key_configured");
});

test("GeminiProvider: parses and normalizes a valid Gemini API response", async () => {
  let receivedHeaderKey = null;
  let receivedBody = null;

  const mock = await createMockServer((req, res) => {
    receivedHeaderKey = req.headers["x-goog-api-key"];
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(SAMPLE_ANALYSIS_DATA) }],
                role: "model"
              },
              finishReason: "STOP"
            }
          ]
        })
      );
    });
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_gemini_api_key",
      baseUrl: mock.url
    });

    const result = await provider.analyzeClause({
      clauseText: "You agree to resolve all disputes through individual binding arbitration."
    });

    assert.equal(result.available, true);
    assert.deepEqual(result.data, SAMPLE_ANALYSIS_DATA);
    assert.equal(receivedHeaderKey, "test_gemini_api_key");
    assert.ok(receivedBody.contents?.[0]?.parts?.[0]?.text);
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: parses JSON wrapped in markdown code fences", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "```json\n" + JSON.stringify(SAMPLE_ANALYSIS_DATA) + "\n```" }],
              role: "model"
            },
            finishReason: "STOP"
          }
        ]
      })
    );
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_key",
      baseUrl: mock.url
    });

    const result = await provider.analyzeClause({ clauseText: "Arbitration clause text" });
    assert.equal(result.available, true);
    assert.equal(result.data.categoryId, "ARBITRATION");
    assert.equal(result.data.plainEnglish, SAMPLE_ANALYSIS_DATA.plainEnglish);
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: handles HTTP errors (401, 429, 500) gracefully without throwing", async () => {
  const testCases = [
    { status: 401, expectedReason: "auth_error" },
    { status: 429, expectedReason: "rate_limited" },
    { status: 500, expectedReason: "provider_server_error" }
  ];

  for (const tc of testCases) {
    const mock = await createMockServer((req, res) => {
      res.writeHead(tc.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Simulated error ${tc.status}` } }));
    });

    try {
      const provider = new GeminiProvider({ apiKey: "key", baseUrl: mock.url });
      const result = await provider.analyzeClause({ clauseText: "Test clause" });
      assert.equal(result.available, false);
      assert.equal(result.reason, tc.expectedReason);
    } finally {
      await mock.close();
    }
  }
});

test("GeminiProvider: handles request timeout safely", async () => {
  const mock = await createMockServer((req, res) => {
    // Intentionally delay longer than provider timeout
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [] }));
    }, 300);
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_key",
      baseUrl: mock.url,
      timeout: 50
    });

    const result = await provider.analyzeClause({ clauseText: "Timeout test" });
    assert.equal(result.available, false);
    assert.equal(result.reason, "timeout");
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: handles malformed and empty model outputs without throwing", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "This is completely unstructured non-JSON narrative output." }],
              role: "model"
            }
          }
        ]
      })
    );
  });

  try {
    const provider = new GeminiProvider({ apiKey: "test_key", baseUrl: mock.url });
    const result = await provider.analyzeClause({ clauseText: "Testing non-JSON response" });
    assert.equal(result.available, false);
    assert.equal(result.reason, "malformed_model_response");
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: handles safety finishReason rejection cleanly", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            finishReason: "SAFETY"
          }
        ]
      })
    );
  });

  try {
    const provider = new GeminiProvider({ apiKey: "test_key", baseUrl: mock.url });
    const result = await provider.analyzeClause({ clauseText: "Unsafe clause" });
    assert.equal(result.available, false);
    assert.equal(result.reason, "model_blocked_safety");
  } finally {
    await mock.close();
  }
});

test("ProviderFactory: resolves GeminiProvider when explicitly requested with key", () => {
  const provider = createAiProvider({
    provider: "gemini",
    apiKey: "test_gemini_key"
  });

  assert.equal(provider.name, "gemini");
  assert.equal(provider instanceof GeminiProvider, true);
  assert.equal(provider.apiKey, "test_gemini_key");
});

test("ProviderFactory: resolves GeminiProvider when enabled via enableGemini with geminiApiKey", () => {
  const provider = createAiProvider({
    enableGemini: true,
    geminiApiKey: "custom_gemini_key",
    geminiModel: "gemini-1.5-pro"
  });

  assert.equal(provider.name, "gemini");
  assert.equal(provider instanceof GeminiProvider, true);
  assert.equal(provider.apiKey, "custom_gemini_key");
  assert.equal(provider.model, "gemini-1.5-pro");
});

test("ProviderFactory: falls back to NullProvider when Gemini key is missing or empty", () => {
  const provider = createAiProvider({
    provider: "gemini",
    apiKey: ""
  });

  assert.equal(provider.name, "null");
  assert.equal(provider instanceof NullProvider, true);
});

test("ProviderFactory: disabled Gemini feature flag does not select Gemini", () => {
  const provider = createAiProvider({
    enableGemini: false,
    geminiApiKey: "gemini_key_present"
  });

  assert.equal(provider.name, "null");
  assert.equal(provider instanceof NullProvider, true);
});

test("ProviderFactory: preserves NVIDIA provider as default when NVIDIA_API_KEY is provided", () => {
  const originalAiProvider = process.env.AI_PROVIDER;
  const originalGeminiEnabled = process.env.ENABLE_GEMINI_PROVIDER;
  try {
    delete process.env.AI_PROVIDER;
    delete process.env.ENABLE_GEMINI_PROVIDER;
    const provider = createAiProvider({
      apiKey: "nvidia_test_key"
    });

    assert.equal(provider.name, "nvidia");
  } finally {
    if (originalAiProvider !== undefined) process.env.AI_PROVIDER = originalAiProvider;
    if (originalGeminiEnabled !== undefined) process.env.ENABLE_GEMINI_PROVIDER = originalGeminiEnabled;
  }
});

test("AiAnalysisService: operates seamlessly with GeminiProvider", async () => {
  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(SAMPLE_ANALYSIS_DATA) }],
              role: "model"
            },
            finishReason: "STOP"
          }
        ]
      })
    );
  });

  try {
    const gemini = new GeminiProvider({
      apiKey: "test_key",
      baseUrl: mock.url
    });

    const service = new AiAnalysisService({ provider: gemini });
    const segments = [
      {
        segmentIndex: 0,
        pageNumber: 1,
        text: "You agree to resolve all controversies solely through private binding arbitration."
      }
    ];

    const result = await service.analyzeSegments(segments, []);
    assert.equal(result.available, true);
    assert.equal(result.segmentsAnalyzed, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].categoryId, "ARBITRATION");
    assert.equal(result.findings[0].plainEnglish, SAMPLE_ANALYSIS_DATA.plainEnglish);
  } finally {
    await mock.close();
  }
});

test("GeminiProvider / buildPrompt: remains valid when retrievedEvidence is empty or absent", () => {
  const promptEmpty = buildPrompt({
    clauseText: "All disputes must be submitted to arbitration.",
    existingCategory: "ARBITRATION",
    existingTitle: "Mandatory Arbitration",
    existingSeverity: "HIGH",
    retrievedEvidence: []
  });

  assert.ok(promptEmpty.includes("All disputes must be submitted to arbitration."));
  assert.ok(promptEmpty.includes("Mandatory Arbitration"));
  assert.equal(promptEmpty.includes("Retrieved Supporting Evidence From Document:"), false);

  const promptUndefined = buildPrompt({
    clauseText: "All disputes must be submitted to arbitration."
  });
  assert.equal(promptUndefined.includes("Retrieved Supporting Evidence From Document:"), false);
});

test("GeminiProvider / buildPrompt: appends Retrieved Supporting Evidence From Document when provided", () => {
  const evidence = [
    {
      clause_id: "clause_2",
      text: "You waive any right to bring claims as a class representative or class member.",
      section: "Class Action Waiver"
    },
    {
      clause_id: "clause_5",
      text: "Arbitration hearings will take place in Delaware.",
      section: "Venue"
    }
  ];

  const prompt = buildPrompt({
    clauseText: "Disputes shall be settled by binding individual arbitration.",
    existingCategory: "ARBITRATION",
    existingTitle: "Arbitration Clause",
    existingSeverity: "HIGH",
    retrievedEvidence: evidence
  });

  assert.ok(prompt.includes("Retrieved Supporting Evidence From Document:"));
  assert.ok(prompt.includes("Class Action Waiver"));
  assert.ok(prompt.includes("You waive any right to bring claims as a class representative or class member."));
  assert.ok(prompt.includes("Arbitration hearings will take place in Delaware."));
  assert.ok(prompt.includes("Return ONLY a JSON object"));
});

test("GeminiProvider: transmits prompt containing retrieved evidence to Gemini endpoint", async () => {
  let capturedPayload = null;

  const mock = await createMockServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      capturedPayload = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(SAMPLE_ANALYSIS_DATA) }],
                role: "model"
              },
              finishReason: "STOP"
            }
          ]
        })
      );
    });
  });

  try {
    const provider = new GeminiProvider({ apiKey: "test_rag_key", baseUrl: mock.url });
    const result = await provider.analyzeClause({
      clauseText: "You agree to resolve disputes by arbitration.",
      retrievedEvidence: [
        { text: "No class arbitrations are permitted under any circumstances." }
      ]
    });

    assert.equal(result.available, true);
    assert.deepEqual(result.data, SAMPLE_ANALYSIS_DATA);
    const sentText = capturedPayload?.contents?.[0]?.parts?.[0]?.text || "";
    assert.ok(sentText.includes("Retrieved Supporting Evidence From Document:"));
    assert.ok(sentText.includes("No class arbitrations are permitted under any circumstances."));
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: seamlessly fails over to fallback candidate model when primary model returns 503 high demand", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    if (requestedEndpoints.length === 1) {
      // First model request returns 503 high demand
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 503, message: "This model is experiencing high demand." } }));
    } else {
      // Subsequent fallback candidate succeeds
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "Yes, subscriptions renew automatically until cancelled.",
                      grounded: true,
                      confidence: 0.95,
                      relevantClauseIds: ["c_1"]
                    })
                  }
                ],
                role: "model"
              },
              finishReason: "STOP"
            }
          ]
        })
      );
    }
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_fallback_key",
      model: "gemini-2.5-pro",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "Does my subscription renew?",
      retrievedEvidence: [{ clauseId: "c_1", text: "Subscriptions renew automatically each month." }]
    });

    assert.equal(result.available, true);
    assert.equal(result.data.grounded, true);
    assert.ok(result.data.answer.includes("renew automatically"));
    assert.equal(requestedEndpoints.length, 2, "Must attempt primary model then fall back to candidate");
    assert.ok(requestedEndpoints[0].includes("gemini-2.5-pro"));
    assert.ok(requestedEndpoints[1].includes("gemini-flash-latest"));
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: primary-model HTTP 429 triggers secondary candidate gemini-flash-lite-latest and returns available answer", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    if (requestedEndpoints.length === 1) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (rate limited)." } }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "To cancel your subscription, visit your account page and select Cancel.",
                      grounded: true,
                      confidence: 0.95,
                      relevantClauseIds: ["c_cancel"]
                    })
                  }
                ],
                role: "model"
              },
              finishReason: "STOP"
            }
          ]
        })
      );
    }
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_429_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "How can I cancel my subscription?",
      retrievedEvidence: [{ clauseId: "c_cancel", text: "You may cancel your subscription at any time." }]
    });

    assert.equal(result.available, true);
    assert.equal(result.data.grounded, true);
    assert.ok(result.data.answer.includes("account page"));
    assert.equal(requestedEndpoints.length, 2, "Primary 429 must trigger secondary candidate");
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"), "Primary attempt must be gemini-flash-latest");
    assert.ok(requestedEndpoints[1].includes("gemini-flash-lite-latest"), "Secondary attempt must be gemini-flash-lite-latest");
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: reaches secondary candidate when earlier candidate encounters 404 or timeout", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    if (requestedEndpoints.length === 1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Model not found." } }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "Yes, you will be billed after free trial.",
                      grounded: true,
                      confidence: 0.9,
                      relevantClauseIds: ["c_trial"]
                    })
                  }
                ],
                role: "model"
              },
              finishReason: "STOP"
            }
          ]
        })
      );
    }
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_404_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "Will I be charged after trial?",
      retrievedEvidence: [{ clauseId: "c_trial", text: "Trial converts to paid subscription automatically." }]
    });

    assert.equal(result.available, true);
    assert.equal(result.data.grounded, true);
    assert.equal(requestedEndpoints.length, 2);
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"));
    assert.ok(requestedEndpoints[1].includes("gemini-flash-lite-latest"));
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: duplicate candidate names are attempted only once", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: 503, message: "Model unavailable." } }));
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_dedupe_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "How do I cancel?",
      retrievedEvidence: [{ clauseId: "c_cancel", text: "You can cancel in account settings." }]
    });

    assert.equal(result.available, false);
    assert.equal(requestedEndpoints.length, 2, "Must attempt primary then secondary without duplicating primary");
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"));
    assert.ok(requestedEndpoints[1].includes("gemini-flash-lite-latest"));
    const uniqueEndpoints = new Set(requestedEndpoints);
    assert.equal(uniqueEndpoints.size, requestedEndpoints.length, "No candidate name must be attempted twice");
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: returns safe unavailable result when both candidates fail", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: 429, message: "Resource exhausted on all models." } }));
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "test_all_fail_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "Will I be charged?",
      retrievedEvidence: [{ clauseId: "c_1", text: "Paid subscriptions renew automatically." }]
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, "rate_limited");
    assert.equal(requestedEndpoints.length, 2, "Must safely fail after attempting both candidates");
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"));
    assert.ok(requestedEndpoints[1].includes("gemini-flash-lite-latest"));
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: authentication errors retain existing behavior without cycling candidates", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: 401, message: "API key invalid." } }));
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "bad_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "How do I cancel?",
      retrievedEvidence: [{ clauseId: "c_1", text: "Cancel via settings." }]
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, "auth_error");
    assert.equal(requestedEndpoints.length, 1, "Auth error must abort immediately without trying secondary candidate");
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"));
  } finally {
    await mock.close();
  }
});

test("GeminiProvider: invalid request errors retain existing behavior without cycling candidates", async () => {
  const requestedEndpoints = [];

  const mock = await createMockServer((req, res) => {
    requestedEndpoints.push(req.url);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: 400, message: "Invalid argument." } }));
  });

  try {
    const provider = new GeminiProvider({
      apiKey: "valid_key",
      model: "gemini-flash-latest",
      baseUrl: mock.url
    });

    const result = await provider.answerQuestion({
      question: "How do I cancel?",
      retrievedEvidence: [{ clauseId: "c_1", text: "Cancel via settings." }]
    });

    assert.equal(result.available, false);
    assert.equal(result.reason, "invalid_request");
    assert.equal(requestedEndpoints.length, 1, "Invalid request must abort immediately without trying secondary candidate");
    assert.ok(requestedEndpoints[0].includes("gemini-flash-latest"));
  } finally {
    await mock.close();
  }
});
