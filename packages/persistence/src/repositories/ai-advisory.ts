import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import type { Database } from "../client";
import { aiAnalysisRun, aiSuggestion } from "../schema";

export type AiAnalysisRun = typeof aiAnalysisRun.$inferSelect;
export type NewAiAnalysisRun = typeof aiAnalysisRun.$inferInsert;
export type AiSuggestion = typeof aiSuggestion.$inferSelect;
export type NewAiSuggestion = typeof aiSuggestion.$inferInsert;

/*
 * `ADR-0009` / `DEC-142`: the AI-advisory repository. Both tables carry
 * `organization_id` directly, so every read and write that takes the
 * organization is scoped by it (`DEC-061`): a row in another organization is
 * invisible, and an org-scoped miss returns `undefined` rather than surfacing
 * another tenant's row.
 *
 * `ai_analysis_run` is append-only (the `0075` trigger); there is no update
 * path here by design. `ai_suggestion` is mutable only through
 * `decideAiSuggestion`, whose `where` pins `state = 'proposed'`, so the state
 * machine cannot be skipped (a second decision on a decided row is a no-op that
 * reports the scoped miss). The reason/decision checks and the vocabularies are
 * database-backed; the application validates first so a caller sees a
 * `DomainError`.
 */

export interface CreateAiAnalysisRunInput {
  readonly organizationId: string;
  readonly kind: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputScope?: Record<string, unknown>;
  readonly inputSnapshot?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  /** Defaults to `pending` at the database. */
  readonly status?: string;
  readonly tokenCounts?: Record<string, unknown>;
  readonly costEstimate?: string | null;
  /** `created_by`; `null` for a system/scheduled run (the column is nullable). */
  readonly actorId: string | null;
}

/** Creates one `ai_analysis_run` row (append-only). */
export async function createAiAnalysisRun(
  db: Database,
  input: CreateAiAnalysisRunInput,
): Promise<AiAnalysisRun> {
  const rows = await db
    .insert(aiAnalysisRun)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      ...(input.inputScope === undefined ? {} : { inputScope: input.inputScope }),
      ...(input.inputSnapshot === undefined ? {} : { inputSnapshot: input.inputSnapshot }),
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.tokenCounts === undefined ? {} : { tokenCounts: input.tokenCounts }),
      ...(input.costEstimate === undefined ? {} : { costEstimate: input.costEstimate }),
      createdBy: input.actorId,
    })
    .returning();
  return rows[0]!;
}

export interface FindAiAnalysisRunQuery {
  readonly organizationId: string;
  readonly analysisRunId: string;
}

/** One run by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findAiAnalysisRun(
  db: Database,
  query: FindAiAnalysisRunQuery,
): Promise<AiAnalysisRun | undefined> {
  const rows = await db
    .select()
    .from(aiAnalysisRun)
    .where(
      and(
        eq(aiAnalysisRun.id, query.analysisRunId),
        eq(aiAnalysisRun.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface SumAiAnalysisRunCostQuery {
  readonly organizationId: string;
  /** Inclusive lower bound (`created_at >= since`). */
  readonly since: Date;
}

/**
 * The organization's summed `cost_estimate` over the window, as a decimal string
 * (the monthly-cost guard, `ADR-0009`). `sum` ignores `null` costs, so an
 * unpriced run contributes nothing; an empty window sums to `"0"`. Organization
 * scoped (`DEC-061`), read-only — no migration.
 */
export async function sumAiAnalysisRunCosts(
  db: Database,
  query: SumAiAnalysisRunCostQuery,
): Promise<string> {
  const rows = await db
    .select({ total: sql<string | null>`sum(${aiAnalysisRun.costEstimate})` })
    .from(aiAnalysisRun)
    .where(
      and(
        eq(aiAnalysisRun.organizationId, query.organizationId),
        gte(aiAnalysisRun.createdAt, query.since),
      ),
    );
  return rows[0]?.total ?? "0";
}

export interface CreateAiSuggestionInput {
  readonly organizationId: string;
  readonly analysisRunId: string;
  readonly scopeType: string;
  readonly scopeRef?: string | null;
  readonly suggestion?: Record<string, unknown>;
  /** `created_by`; `null` for a system/scheduled run. */
  readonly actorId: string | null;
}

/** Creates one `ai_suggestion` row in its `proposed` default state. */
export async function createAiSuggestion(
  db: Database,
  input: CreateAiSuggestionInput,
): Promise<AiSuggestion> {
  const rows = await db
    .insert(aiSuggestion)
    .values({
      organizationId: input.organizationId,
      analysisRunId: input.analysisRunId,
      scopeType: input.scopeType,
      ...(input.scopeRef === undefined ? {} : { scopeRef: input.scopeRef }),
      ...(input.suggestion === undefined ? {} : { suggestion: input.suggestion }),
      createdBy: input.actorId,
    })
    .returning();
  return rows[0]!;
}

export interface FindAiSuggestionQuery {
  readonly organizationId: string;
  readonly suggestionId: string;
}

/** One suggestion by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findAiSuggestionById(
  db: Database,
  query: FindAiSuggestionQuery,
): Promise<AiSuggestion | undefined> {
  const rows = await db
    .select()
    .from(aiSuggestion)
    .where(
      and(
        eq(aiSuggestion.id, query.suggestionId),
        eq(aiSuggestion.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface DecideAiSuggestionInput {
  readonly organizationId: string;
  readonly suggestionId: string;
  readonly state: string;
  readonly reason: string | null;
  readonly actorId: string;
}

/**
 * Moves one **organization-owned, still-`proposed`** suggestion to
 * `approved`/`rejected` and stamps the decision pair. The `state = 'proposed'`
 * predicate is the state machine's authority: a concurrent or repeated decision
 * is an org-scoped miss (`undefined`), never a second overwrite.
 */
export async function decideAiSuggestion(
  db: Database,
  input: DecideAiSuggestionInput,
): Promise<AiSuggestion | undefined> {
  const rows = await db
    .update(aiSuggestion)
    .set({
      state: input.state,
      reason: input.reason,
      decidedBy: input.actorId,
      decidedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(aiSuggestion.id, input.suggestionId),
        eq(aiSuggestion.organizationId, input.organizationId),
        eq(aiSuggestion.state, "proposed"),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListAiSuggestionsQuery {
  readonly organizationId: string;
  readonly state?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's suggestions, newest first (then id), with the bounded
 * paging idiom (`$dynamic()`). The organization filter is never optional
 * (`DEC-061`); `list-ai-suggestions.ts` validates `limit`/`offset` first.
 */
export async function listAiSuggestions(
  db: Database,
  query: ListAiSuggestionsQuery,
): Promise<readonly AiSuggestion[]> {
  const where =
    query.state === undefined
      ? eq(aiSuggestion.organizationId, query.organizationId)
      : and(
          eq(aiSuggestion.organizationId, query.organizationId),
          eq(aiSuggestion.state, query.state),
        );
  const statement = db
    .select()
    .from(aiSuggestion)
    .where(where)
    .orderBy(desc(aiSuggestion.createdAt), asc(aiSuggestion.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
