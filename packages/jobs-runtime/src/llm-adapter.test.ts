import { describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleLlmAdapter, providerLabel } from "./llm-adapter";

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
