import type { LlmCompletionInput, LlmCompletionResult, LlmPort } from "@aquarela/application";

/**
 * OpenAI-compatible chat-completions adapter for the `LlmPort` (`ADR-0009`,
 * `DEC-142`). It lives in the scheduler/worker runtime (`packages/jobs-runtime`)
 * rather than `apps/web` because the scheduled advisory job — the only caller —
 * runs in the scheduler process, which imports `@aquarela/application` but no
 * `apps/web` code (mirrors the `apps/web/lib/mail.ts` transport precedent).
 *
 * Fail-closed: unless `LLM_API_URL`, `LLM_API_KEY` and `LLM_MODEL` are all set,
 * `configured` is false, `complete` makes no request and logs one warning.
 *
 * Secrets: the API key is only ever placed in the request header. No log call or
 * thrown error here carries the key or the URL, so an adapter failure cannot
 * leak a credential into a run record or the log stream.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

/** The subset of a logger the adapter uses; keeps it decoupled from pino. */
export interface LlmLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface OpenAiCompatibleLlmAdapterOptions {
  readonly apiUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly logger?: LlmLogger | undefined;
}

export interface OpenAiCompatibleLlmAdapter extends LlmPort {
  /** True only when the URL, key and model are all present. */
  readonly configured: boolean;
  /** The provider label recorded on a run: the API URL's host, else a generic label. */
  readonly provider: string;
  /** The configured model, or `null` when unconfigured. */
  readonly model: string | null;
}

/** Trims a value and treats blank as absent, so `""` cannot enable the channel. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** The recorded provider label; never the full URL (a URL may embed credentials). */
export function providerLabel(apiUrl: string | undefined): string {
  if (apiUrl === undefined) {
    return "openai-compatible";
  }
  try {
    return new URL(apiUrl).host || "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}

function readTokenCount(usage: unknown, key: string): number {
  if (usage === null || typeof usage !== "object") {
    return 0;
  }
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** Reads one OpenAI-compatible completion, or throws a secret-free error. */
function readCompletion(payload: unknown): LlmCompletionResult {
  if (payload === null || typeof payload !== "object") {
    throw new Error("llm response was not a JSON object");
  }
  const record = payload as Record<string, unknown>;
  const choices = record["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("llm response has no choices");
  }
  const first = choices[0];
  const message =
    first !== null && typeof first === "object"
      ? (first as Record<string, unknown>)["message"]
      : undefined;
  const content =
    message !== null && typeof message === "object"
      ? (message as Record<string, unknown>)["content"]
      : undefined;
  if (typeof content !== "string") {
    throw new Error("llm response is missing choices[0].message.content");
  }
  const usage = record["usage"];
  return {
    text: content,
    tokenCounts: {
      input: readTokenCount(usage, "prompt_tokens"),
      output: readTokenCount(usage, "completion_tokens"),
    },
    // No pricing is applied here: the provider does not return a cost, so the
    // port reports `null` rather than inventing one.
    costEstimate: null,
  };
}

export function createOpenAiCompatibleLlmAdapter(
  options: OpenAiCompatibleLlmAdapterOptions = {},
): OpenAiCompatibleLlmAdapter {
  const apiUrl = present(options.apiUrl);
  const apiKey = present(options.apiKey);
  const model = present(options.model);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger;
  const configured = apiUrl !== undefined && apiKey !== undefined && model !== undefined;
  const provider = providerLabel(apiUrl);

  return {
    configured,
    provider,
    model: model ?? null,
    async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
      if (!configured) {
        logger?.warn(
          { provider },
          "llm adapter is not configured (LLM_API_URL, LLM_API_KEY and LLM_MODEL must all be set); no request sent",
        );
        throw new Error("llm adapter is not configured");
      }

      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: present(input.model) ?? model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`llm request failed with status ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("llm response was not valid JSON");
      }
      return readCompletion(payload);
    },
  };
}
