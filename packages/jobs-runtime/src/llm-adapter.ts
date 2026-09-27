import type { LlmCompletionInput, LlmCompletionResult, LlmPort } from "@aquarela/application";
import {
  divideRoundHalfUp,
  DomainError,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
} from "@aquarela/domain";

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
 * Cost: the provider reports token usage, not a price, so the operator-supplied
 * price table (`LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M`, both
 * optional) is applied by {@link computeLlmCostEstimate}. With no price set the
 * completion reports `costEstimate: null` and the advisory caps stay inert.
 *
 * Secrets: the API key is only ever placed in the request header. No log call or
 * thrown error here carries the key or the URL, so an adapter failure cannot
 * leak a credential into a run record or the log stream.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;

/** Prices are decimal strings at this scale (per 1,000,000 tokens). */
export const LLM_PRICE_SCALE = 6;

/**
 * The exact-numerator divisor: a price is currency per 10^6 tokens at
 * `LLM_PRICE_SCALE` (10^6), so `tokens × price` is a numerator at scale 12 and
 * one HALF_UP division by 10^(6 + LLM_PRICE_SCALE − MONEY_SCALE) = 10^8 lands it
 * at `MONEY_SCALE` (`numeric(19,4)`), with a single rounding at the end.
 */
const COST_DIVISOR = 10n ** BigInt(6 + LLM_PRICE_SCALE - MONEY_SCALE);

/** An operator-configured price table; each side is optional. */
export interface LlmPriceTable {
  readonly inputPer1M?: string | null | undefined;
  readonly outputPer1M?: string | null | undefined;
}

/** A finite, non-negative, integer token count; anything else counts as 0. */
function tokenCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** A price as integer units at `LLM_PRICE_SCALE`; blank or absent is `null`. */
function priceAtScale(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const price = parseDecimal(trimmed, LLM_PRICE_SCALE);
  if (price < 0n) {
    throw new DomainError(`a price must be non-negative, got "${trimmed}"`);
  }
  return price;
}

/** The arithmetic core: `null` only when neither side is priced. */
function costFromPrices(
  tokenCounts: { readonly input: number; readonly output: number },
  inputPrice: bigint | null,
  outputPrice: bigint | null,
): string | null {
  if (inputPrice === null && outputPrice === null) {
    return null;
  }
  const numerator =
    BigInt(tokenCount(tokenCounts.input)) * (inputPrice ?? 0n) +
    BigInt(tokenCount(tokenCounts.output)) * (outputPrice ?? 0n);
  return formatDecimal(divideRoundHalfUp(numerator, COST_DIVISOR), MONEY_SCALE);
}

/**
 * The cost estimate for one completion from an operator-configured price table
 * (`LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M`), or `null` when **no**
 * price is set. The `null` is the fail-safe: without prices the cost caps stay
 * inert rather than recording a fabricated figure.
 *
 * Decimal only, never floats: `cost = (inputTokens × inputPrice + outputTokens ×
 * outputPrice) / 10^6`, built as an exact integer numerator and rounded once
 * HALF_UP to `MONEY_SCALE` (`numeric(19,4)`).
 *
 * Each side is independent. A price that is explicitly set to `"0"` contributes
 * zero (the result is `"0.0000"`, not `null`), and when only one side is set the
 * unset side is priced at zero — a partial estimate of the sides that are
 * priced, never a fabricated one. A malformed price (non-decimal, negative, more
 * than {@link LLM_PRICE_SCALE} decimals, or beyond `numeric(19,6)`) throws a
 * `DomainError`.
 */
export function computeLlmCostEstimate(
  tokenCounts: { readonly input: number; readonly output: number },
  prices: LlmPriceTable,
): string | null {
  return costFromPrices(
    tokenCounts,
    priceAtScale(prices.inputPer1M),
    priceAtScale(prices.outputPer1M),
  );
}

/** The subset of a logger the adapter uses; keeps it decoupled from pino. */
export interface LlmLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface OpenAiCompatibleLlmAdapterOptions {
  readonly apiUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  /**
   * Per-1,000,000-token prices (`LLM_PRICE_INPUT_PER_1M` /
   * `LLM_PRICE_OUTPUT_PER_1M`), decimal strings at up to {@link LLM_PRICE_SCALE}
   * decimals. Both absent ⇒ every completion reports `costEstimate: null` and
   * the advisory cost caps stay inert; a malformed price fails construction.
   */
  readonly priceInputPer1M?: string | undefined;
  readonly priceOutputPer1M?: string | undefined;
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
  return typeof value === "number" ? tokenCount(value) : 0;
}

/** The raw read: pricing is applied by the caller from the configured table. */
type RawCompletion = Omit<LlmCompletionResult, "costEstimate">;

/** Reads one OpenAI-compatible completion, or throws a secret-free error. */
function readCompletion(payload: unknown): RawCompletion {
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
  };
}

export function createOpenAiCompatibleLlmAdapter(
  options: OpenAiCompatibleLlmAdapterOptions = {},
): OpenAiCompatibleLlmAdapter {
  const apiUrl = present(options.apiUrl);
  const apiKey = present(options.apiKey);
  const model = present(options.model);
  // Parse eagerly so a malformed price fails at construction — the scheduler's
  // boot — rather than on the first scheduled run.
  const inputPrice = priceAtScale(options.priceInputPer1M);
  const outputPrice = priceAtScale(options.priceOutputPer1M);
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
      const completion = readCompletion(payload);
      return {
        ...completion,
        costEstimate: costFromPrices(completion.tokenCounts, inputPrice, outputPrice),
      };
    },
  };
}
