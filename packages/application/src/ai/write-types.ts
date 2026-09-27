import type { AuditInput } from "../auth";

import type { AiAnalysisRunRecord, AiSuggestionRecord } from "./read-types";

/**
 * Write-side port for the AI-advisory review foundation (`ADR-0009`,
 * `DEC-142`). The port is a narrow read-then-write over `@aquarela/persistence`,
 * so the commands can be unit-tested against an in-memory fake.
 *
 * `ai_analysis_run` is append-only (there is no update method here: provenance
 * is a recorded fact). `ai_suggestion` changes only through `decideSuggestion`,
 * whose contract is the `proposed`-only state machine.
 */
export interface NewAiAnalysisRunRecord {
  readonly organizationId: string;
  readonly kind: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputScope?: Record<string, unknown>;
  readonly inputSnapshot?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly status?: string;
  readonly tokenCounts?: Record<string, unknown>;
  readonly costEstimate?: string | null;
  /** Stamped on `created_by`; `null` for a system/scheduled run. */
  readonly actorId: string | null;
}

export interface NewAiSuggestionRecord {
  readonly organizationId: string;
  readonly analysisRunId: string;
  readonly scopeType: string;
  readonly scopeRef?: string | null;
  readonly suggestion?: Record<string, unknown>;
  /** Stamped on `created_by`; `null` for a system/scheduled run. */
  readonly actorId: string | null;
}

export interface DecideAiSuggestionRecord {
  readonly organizationId: string;
  readonly suggestionId: string;
  /** The decided state (`approved` or `rejected`). */
  readonly state: string;
  readonly reason: string | null;
  /** Stamped on `decided_by`/`updated_by`. */
  readonly actorId: string;
}

export interface AiAdvisoryWriteStore {
  /**
   * Binds `fn` to one transaction so the decision and its audit row commit
   * together (and so the read-then-decide state check is consistent).
   */
  withTransaction<T>(fn: (store: AiAdvisoryWriteStore) => Promise<T>): Promise<T>;
  /** One organization-owned run by id, or `undefined` on a scoped miss. */
  findAiAnalysisRunById(
    organizationId: string,
    analysisRunId: string,
  ): Promise<AiAnalysisRunRecord | undefined>;
  /** One organization-owned suggestion by id, or `undefined` on a scoped miss. */
  findAiSuggestionById(
    organizationId: string,
    suggestionId: string,
  ): Promise<AiSuggestionRecord | undefined>;
  createAiAnalysisRun(input: NewAiAnalysisRunRecord): Promise<AiAnalysisRunRecord>;
  createAiSuggestion(input: NewAiSuggestionRecord): Promise<AiSuggestionRecord>;
  /**
   * Moves one **organization-owned, still-proposed** suggestion to its decided
   * state; `undefined` when the id is unknown, belongs to another organization
   * (`DEC-061`), or is no longer `proposed`.
   */
  decideAiSuggestion(input: DecideAiSuggestionRecord): Promise<AiSuggestionRecord | undefined>;
  /** Append-only audit fact; the caller must not pass snapshot/output secrets. */
  writeAudit(input: AuditInput): Promise<void>;
}
