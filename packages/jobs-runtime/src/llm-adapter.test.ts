import { describe, expect, it, vi } from "vitest";

import {
  computeLlmCostEstimate,
  createOpenAiCompatibleLlmAdapter,
  providerLabel,
} from "./llm-adapter";

const API_KEY = "sk-super-secret-key";
const API_URL = "https://api.example.ai/v1/chat/completions";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function recordingLogger(): {
  logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
  return { logger: { warn: vi.fn(), error: vi.fn() } };
}

describe("providerLabel", () => {
  it("uses the host, falling back to a generic label", () => {
    expect(providerLabel(API_URL)).toBe("api.example.ai");
    expect(providerLabel("not a url")).toBe("openai-compatible");
    expect(providerLabel(undefined)).toBe("openai-compatible");
  });
});

describe("computeLlmCostEstimate", () => {
  it("returns null when neither price is set (absent, null or blank)", () => {
    expect(computeLlmCostEstimate({ input: 1000, output: 500 }, {})).toBeNull();
    expect(
      computeLlmCostEstimate({ input: 1000, output: 500 }, { inputPer1M: null, outputPer1M: null }),
    ).toBeNull();
    expect(
      computeLlmCostEstimate({ input: 1000, output: 500 }, { inputPer1M: "", outputPer1M: "   " }),
    ).toBeNull();
  });

  it("prices both sides with exact decimal arithmetic", () => {
    // 1000/1e6 × 2.000000 + 500/1e6 × 4.000000 = 0.002 + 0.002
    expect(
      computeLlmCostEstimate(
        { input: 1000, output: 500 },
        { inputPer1M: "2.000000", outputPer1M: "4.000000" },
      ),
    ).toBe("0.0040");
  });

  it("prices only the side that is set (the unset side is zero)", () => {
    expect(
      computeLlmCostEstimate({ input: 1_000_000, output: 999_999 }, { inputPer1M: "2.5" }),
    ).toBe("2.5000");
    expect(
      computeLlmCostEstimate({ input: 999_999, output: 1_000_000 }, { outputPer1M: "2.5" }),
    ).toBe("2.5000");
  });

  it("treats an explicit zero price as set, not absent", () => {
    expect(
      computeLlmCostEstimate(
        { input: 1000, output: 500 },
        { inputPer1M: "0", outputPer1M: "0.000000" },
      ),
    ).toBe("0.0000");
  });

  it("rounds HALF_UP once at numeric(19,4)", () => {
    // 3,000,000 tokens × 0.000050 = 0.00015 → half rounds up
    expect(
      computeLlmCostEstimate({ input: 3_000_000, output: 0 }, { inputPer1M: "0.000050" }),
    ).toBe("0.0002");
    // 1 token × 0.000049 = 0.000000049 → rounds down
    expect(computeLlmCostEstimate({ input: 1, output: 0 }, { inputPer1M: "0.000049" })).toBe(
      "0.0000",
    );
  });

  it("treats a negative, fractional or non-finite token count as zero", () => {
    expect(
      computeLlmCostEstimate(
        { input: -5, output: Number.NaN },
        { inputPer1M: "2", outputPer1M: "2" },
      ),
    ).toBe("0.0000");
    expect(computeLlmCostEstimate({ input: 2.7, output: 0 }, { inputPer1M: "1" })).toBe("0.0000");
  });

  it("throws a DomainError on a malformed price", () => {
    expect(() =>
      computeLlmCostEstimate({ input: 1, output: 1 }, { inputPer1M: "1.1234567" }),
    ).toThrow();
    expect(() => computeLlmCostEstimate({ input: 1, output: 1 }, { inputPer1M: "-1" })).toThrow();
    expect(() => computeLlmCostEstimate({ input: 1, output: 1 }, { inputPer1M: "abc" })).toThrow();
  });
});

describe("createOpenAiCompatibleLlmAdapter", () => {
  it("parses a successful completion and sends the OpenAI-compatible body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 7, completion_tokens: 11 },
      }),
    );
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(adapter.configured).toBe(true);
    expect(adapter.provider).toBe("api.example.ai");
    expect(adapter.model).toBe("test-model");

    const result = await adapter.complete({ system: "sys", user: "usr" });

    expect(result).toEqual({
      text: "hello",
      tokenCounts: { input: 7, output: 11 },
      costEstimate: null,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(API_URL);
    const request = init as RequestInit;
    expect((request.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("test-model");
    expect(body["max_tokens"]).toBe(1024);
    expect(body["messages"]).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("attaches a cost estimate when a price table is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
    );
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      priceInputPer1M: "2.000000",
      priceOutputPer1M: "4.000000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.complete({ system: "s", user: "u" });
    expect(result.costEstimate).toBe("0.0040");
  });

  it("reports no cost estimate when the price table is blank or absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
    );
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      priceInputPer1M: "   ",
      priceOutputPer1M: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.complete({ system: "s", user: "u" });
    expect(result.costEstimate).toBeNull();
  });

  it("prices a response with no usage block as zero, not null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "x" } }] }),
    );
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      priceInputPer1M: "2.000000",
      priceOutputPer1M: "4.000000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.complete({ system: "s", user: "u" });
    expect(result.costEstimate).toBe("0.0000");
  });

  it("fails construction on a malformed price", () => {
    expect(() => createOpenAiCompatibleLlmAdapter({ priceInputPer1M: "1.1234567" })).toThrow();
    expect(() => createOpenAiCompatibleLlmAdapter({ priceOutputPer1M: "-1" })).toThrow();
  });

  it("defaults missing token usage to zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "x" } }] }),
    );
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.complete({ system: "s", user: "u" });
    expect(result.tokenCounts).toEqual({ input: 0, output: 0 });
  });

  it("throws a secret-free error on a non-2xx response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 500));
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(adapter.complete({ system: "s", user: "u" })).rejects.toThrow(
      "llm request failed with status 500",
    );
    await expect(adapter.complete({ system: "s", user: "u" })).rejects.not.toThrow(API_KEY);
  });

  it("throws on a malformed success body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [] }));
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: API_KEY,
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.complete({ system: "s", user: "u" })).rejects.toThrow(
      "llm response has no choices",
    );
  });

  it("fails closed without a request when unconfigured", async () => {
    const fetchImpl = vi.fn();
    const { logger } = recordingLogger();
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
    });

    expect(adapter.configured).toBe(false);
    await expect(adapter.complete({ system: "s", user: "u" })).rejects.toThrow(
      "llm adapter is not configured",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [context, message] = logger.warn.mock.calls[0]!;
    expect(JSON.stringify({ context, message })).not.toContain(API_KEY);
    expect(JSON.stringify({ context, message })).not.toContain(API_URL);
  });

  it("treats a blank value as absent", () => {
    const adapter = createOpenAiCompatibleLlmAdapter({
      apiUrl: API_URL,
      apiKey: "   ",
      model: "m",
    });
    expect(adapter.configured).toBe(false);
  });
});
