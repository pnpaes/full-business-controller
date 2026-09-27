/**
 * Provider-agnostic LLM port (`ADR-0009`, `DEC-142`). The application layer asks
 * for one completion; the concrete transport (an OpenAI-compatible HTTP adapter,
 * a stub, a future vendor) lives in the runtime layer behind this interface, so
 * no vendor is hard-coded and the port never leaks provider details.
 *
 * The result carries the raw text plus the provider's token counts and its cost
 * estimate when it reports one. `costEstimate` is a decimal string (`DEC-024`,
 * never a float) or `null` when the provider does not price the call — the
 * runtime adapter is where a price table would be applied, not here.
 */
export interface LlmCompletionInput {
  readonly system: string;
  readonly user: string;
  /** Overrides the adapter's configured model for this one call. */
  readonly model?: string | undefined;
  readonly maxTokens?: number | undefined;
}

/** Provider-reported token usage; zero when the provider omits it. */
export interface LlmTokenCounts {
  readonly input: number;
  readonly output: number;
}

export interface LlmCompletionResult {
  readonly text: string;
  readonly tokenCounts: LlmTokenCounts;
  /** Provider cost estimate as a decimal string, or `null` when unknown. */
  readonly costEstimate: string | null;
}

export interface LlmPort {
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
}
