/**
 * Read-side port for the AI-advisory review foundation (`ADR-0009`, `DEC-142`,
 * row 17). Two projections: one `ai_suggestion` row (the review queue) and one
 * `ai_analysis_run` row (the provenance behind a suggestion). Both are
 * organization-scoped (`DEC-061`): the query's `organizationId` is never
 * optional, so a caller cannot read another tenant's rows.
 *
 * The raw `input_snapshot`/`cost_estimate`/`output` fields are carried on the
 * run record for reproducibility but are deliberately **not** part of the
 * suggestion API row (the route row exposes no raw snapshot or cost).
 */
export interface AiAnalysisRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputScope: Record<string, unknown>;
  readonly inputSnapshot: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly status: string;
  readonly tokenCounts: Record<string, unknown>;
  /** `numeric(19,4)` crosses the port as a decimal string, or `null`. */
  readonly costEstimate: string | null;
  readonly createdAt: Date;
  readonly createdBy: string | null;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  readonly version: number;
}

export interface AiSuggestionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly analysisRunId: string;
  readonly scopeType: string;
  readonly scopeRef: string | null;
  readonly suggestion: Record<string, unknown>;
  readonly state: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly createdBy: string | null;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  readonly version: number;
}

/** Page size when the caller does not ask for one. */
export const DEFAULT_AI_SUGGESTION_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole queue in one page. */
export const MAX_AI_SUGGESTION_LIMIT = 200;

export interface ListAiSuggestionsQuery {
  readonly organizationId: string;
  /** One of the `AI_SUGGESTION_STATE` vocabulary, exact match. */
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AiSuggestionReadStore {
  /**
   * One bounded page of the organization's suggestions, newest first (then id).
   * `limit`/`offset` are applied by the store so a caller cannot pull the whole
   * queue; `listAiSuggestions` validates them against
   * `MAX_AI_SUGGESTION_LIMIT` first.
   */
  listAiSuggestions(query: {
    readonly organizationId: string;
    readonly state?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly AiSuggestionRecord[]>;
}

/** The organization-scoped month window a cost sum reads over. */
export interface AiAnalysisRunCostQuery {
  readonly organizationId: string;
  /** Inclusive lower bound (`created_at >= since`), e.g. the start of the UTC month. */
  readonly since: Date;
}

export interface AiAnalysisRunReadStore {
  /** One organization-owned run by id, or `undefined` on a scoped miss. */
  findAiAnalysisRun(
    organizationId: string,
    analysisRunId: string,
  ): Promise<AiAnalysisRunRecord | undefined>;
  /**
   * The sum of the organization's recorded `cost_estimate` values created at or
   * after `since` (the monthly-cost guard, `ADR-0009`). Always a decimal string;
   * `"0.0000"` when the window has no priced run. Organization-scoped
   * (`DEC-061`), so one tenant's spend never counts against another's limit.
   */
  sumAiAnalysisRunCosts(query: AiAnalysisRunCostQuery): Promise<string>;
}
