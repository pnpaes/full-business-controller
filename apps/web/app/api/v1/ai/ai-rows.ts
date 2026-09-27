import { MAX_AI_SUGGESTION_LIMIT } from "@aquarela/application";
import { AI_SUGGESTION_STATE } from "@aquarela/persistence";

/**
 * Row shape and query parsing for the AI-advisory routes (`ADR-0009`,
 * `DEC-142`).
 *
 * The API-facing suggestion row **deliberately omits** the run's raw
 * `input_snapshot`, `output`, `token_counts` and `cost_estimate`: a snapshot may
 * carry business inputs a review UI does not need, and cost is operator-only.
 * The row exposes the review fields plus `runId`, so a caller can fetch the run
 * through the provenance read if authorized.
 */

export const DEFAULT_AI_SUGGESTIONS_LIMIT = 50;

/** The same strict 8-4-4-4-12 hex UUID the other routes accept. */
export const AI_SUGGESTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The review fields a route row exposes; the application record satisfies it. */
export interface AiSuggestionRowSource {
  readonly id: string;
  readonly state: string;
  readonly scopeType: string;
  readonly scopeRef: string | null;
  readonly suggestion: Record<string, unknown>;
  readonly analysisRunId: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

/** One suggestion as the API returns it (no raw snapshot/output/cost). */
export function toAiSuggestionRow(row: AiSuggestionRowSource): Record<string, unknown> {
  return {
    id: row.id,
    state: row.state,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    suggestion: row.suggestion,
    runId: row.analysisRunId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export function toAiSuggestionRows(
  rows: readonly AiSuggestionRowSource[],
): Record<string, unknown>[] {
  return rows.map(toAiSuggestionRow);
}

export interface AiSuggestionsListQuery {
  /** One of the `AI_SUGGESTION_STATE` vocabulary, exact match. */
  readonly state?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedAiSuggestionsListQuery =
  { readonly ok: true; readonly query: AiSuggestionsListQuery } | { readonly ok: false };

function readNonNegativeInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

/**
 * Parses the optional `state` filter and `limit`/`offset` paging. `limit` is
 * `1..MAX_AI_SUGGESTION_LIMIT` and `offset` is `0..MAX_AI_SUGGESTION_LIMIT`, so
 * a malformed or huge value is a 400 rather than reaching the store.
 */
export function parseAiSuggestionsQuery(
  searchParams: URLSearchParams,
): ParsedAiSuggestionsListQuery {
  const state = searchParams.get("state");
  if (state !== null && !(AI_SUGGESTION_STATE as readonly string[]).includes(state)) {
    return { ok: false };
  }

  const limit = readNonNegativeInteger(searchParams.get("limit"));
  const offset = readNonNegativeInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_AI_SUGGESTION_LIMIT)) {
    return { ok: false };
  }
  if (offset !== undefined && offset > MAX_AI_SUGGESTION_LIMIT) {
    return { ok: false };
  }

  return {
    ok: true,
    query: {
      ...(state === null ? {} : { state }),
      limit: limit ?? DEFAULT_AI_SUGGESTIONS_LIMIT,
      offset: offset ?? 0,
    },
  };
}

export type ParsedDecisionReason =
  { readonly ok: true; readonly reason: string } | { readonly ok: false };

/**
 * Reads the reject body `{ reason }`. A missing, non-string or blank reason is a
 * 400 (there is no silent rejection); the trim here is what the command then
 * re-checks, so the two agree.
 */
export function parseDecisionReason(body: unknown): ParsedDecisionReason {
  if (typeof body !== "object" || body === null) {
    return { ok: false };
  }
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false };
  }
  return { ok: true, reason: reason.trim() };
}
