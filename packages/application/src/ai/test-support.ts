import type { AuditInput } from "../auth";

import type {
  AiAnalysisRunCostQuery,
  AiAnalysisRunReadStore,
  AiAnalysisRunRecord,
  AiSuggestionReadStore,
  AiSuggestionRecord,
} from "./read-types";
import type {
  AiAdvisoryWriteStore,
  DecideAiSuggestionRecord,
  NewAiAnalysisRunRecord,
  NewAiSuggestionRecord,
} from "./write-types";

const COST_SCALE = 4;

/** A non-negative decimal string at 4 dp, by string maths (no floats). */
function parseCost(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(COST_SCALE) + BigInt(`${fraction}0000`.slice(0, COST_SCALE));
}

/** The inverse of {@link parseCost}: a decimal string at 4 dp. */
function formatCost(value: bigint): string {
  const factor = 10n ** BigInt(COST_SCALE);
  const fraction = (value % factor).toString().padStart(COST_SCALE, "0");
  return `${value / factor}.${fraction}`;
}

/**
 * In-memory store for the AI-advisory unit suite. It mirrors the observable
 * contract (org-scoped lookups, `proposed`-only decisions, the decision stamp)
 * closely enough to exercise the commands without a database; the postgres
 * adapter is covered by `ai-advisory.postgres.test.ts`. It implements the read
 * and write ports (`createPostgresAiAdvisoryStore` does the same).
 */
export class FakeAiAdvisoryStore
  implements AiAdvisoryWriteStore, AiSuggestionReadStore, AiAnalysisRunReadStore
{
  readonly runs: AiAnalysisRunRecord[] = [];
  readonly suggestions: AiSuggestionRecord[] = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: AiAdvisoryWriteStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  listAiSuggestions(query: {
    readonly organizationId: string;
    readonly state?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly AiSuggestionRecord[]> {
    const rows = this.suggestions
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          (query.state === undefined || row.state === query.state),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(query.offset, query.offset + query.limit);
    return Promise.resolve(rows);
  }

  findAiAnalysisRun(
    organizationId: string,
    analysisRunId: string,
  ): Promise<AiAnalysisRunRecord | undefined> {
    return Promise.resolve(
      this.runs.find((run) => run.organizationId === organizationId && run.id === analysisRunId),
    );
  }

  sumAiAnalysisRunCosts(query: AiAnalysisRunCostQuery): Promise<string> {
    let total = 0n;
    for (const run of this.runs) {
      if (run.organizationId !== query.organizationId) continue;
      if (run.createdAt.getTime() < query.since.getTime()) continue;
      if (run.costEstimate === null) continue;
      total += parseCost(run.costEstimate);
    }
    return Promise.resolve(formatCost(total));
  }

  findAiAnalysisRunById(
    organizationId: string,
    analysisRunId: string,
  ): Promise<AiAnalysisRunRecord | undefined> {
    return this.findAiAnalysisRun(organizationId, analysisRunId);
  }

  findAiSuggestionById(
    organizationId: string,
    suggestionId: string,
  ): Promise<AiSuggestionRecord | undefined> {
    return Promise.resolve(
      this.suggestions.find(
        (row) => row.organizationId === organizationId && row.id === suggestionId,
      ),
    );
  }

  createAiAnalysisRun(input: NewAiAnalysisRunRecord): Promise<AiAnalysisRunRecord> {
    const now = new Date();
    const record: AiAnalysisRunRecord = {
      id: this.nextId("run"),
      organizationId: input.organizationId,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      inputScope: input.inputScope ?? {},
      inputSnapshot: input.inputSnapshot ?? {},
      output: input.output ?? {},
      status: input.status ?? "pending",
      tokenCounts: input.tokenCounts ?? {},
      costEstimate: input.costEstimate ?? null,
      createdAt: now,
      createdBy: input.actorId,
      updatedAt: null,
      updatedBy: null,
      version: 1,
    };
    this.runs.push(record);
    return Promise.resolve(record);
  }

  createAiSuggestion(input: NewAiSuggestionRecord): Promise<AiSuggestionRecord> {
    const now = new Date();
    const record: AiSuggestionRecord = {
      id: this.nextId("suggestion"),
      organizationId: input.organizationId,
      analysisRunId: input.analysisRunId,
      scopeType: input.scopeType,
      scopeRef: input.scopeRef ?? null,
      suggestion: input.suggestion ?? {},
      state: "proposed",
      decidedBy: null,
      decidedAt: null,
      reason: null,
      createdAt: now,
      createdBy: input.actorId,
      updatedAt: null,
      updatedBy: null,
      version: 1,
    };
    this.suggestions.push(record);
    return Promise.resolve(record);
  }

  decideAiSuggestion(input: DecideAiSuggestionRecord): Promise<AiSuggestionRecord | undefined> {
    const index = this.suggestions.findIndex(
      (row) =>
        row.organizationId === input.organizationId &&
        row.id === input.suggestionId &&
        row.state === "proposed",
    );
    if (index === -1) {
      return Promise.resolve(undefined);
    }
    const updated: AiSuggestionRecord = {
      ...this.suggestions[index]!,
      state: input.state,
      reason: input.reason,
      decidedBy: input.actorId,
      decidedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: input.actorId,
    };
    this.suggestions[index] = updated;
    return Promise.resolve(updated);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
