import { DomainError, NotFoundError } from "@aquarela/domain";

import type { AiAdvisoryWriteStore, NewAiSuggestionRecord } from "./write-types";

export interface RecordAiSuggestionInput {
  readonly organizationId: string;
  /** The acting user; `null` for a system/scheduled run. */
  readonly actorId: string | null;
  readonly analysisRunId: string;
  readonly scopeType: string;
  readonly scopeRef?: string | null;
  readonly suggestion?: Record<string, unknown>;
}

export interface RecordAiSuggestionResult {
  readonly suggestionId: string;
}

/**
 * Records one `ai_suggestion` for an existing run (`ADR-0009`, `DEC-142`). The
 * suggestion always starts `proposed` (the decision route is the only way to
 * move it), and the run must exist **in the same organization** — a run id from
 * another tenant is an indistinguishable `NotFoundError` rather than a foreign
 * FK write. Nothing here applies the suggestion; it is advisory input to a human
 * review.
 */
export async function recordAiSuggestion(
  store: AiAdvisoryWriteStore,
  input: RecordAiSuggestionInput,
): Promise<RecordAiSuggestionResult> {
  const scopeType = input.scopeType.trim();
  if (scopeType.length === 0) {
    throw new DomainError("scopeType must not be empty");
  }

  return store.withTransaction(async (tx) => {
    const run = await tx.findAiAnalysisRunById(input.organizationId, input.analysisRunId);
    if (run === undefined) {
      throw new NotFoundError(`analysis run ${input.analysisRunId} not found in this organization`);
    }

    const record: NewAiSuggestionRecord = {
      organizationId: input.organizationId,
      analysisRunId: input.analysisRunId,
      scopeType,
      actorId: input.actorId,
      scopeRef: input.scopeRef ?? null,
      ...(input.suggestion === undefined ? {} : { suggestion: input.suggestion }),
    };
    const created = await tx.createAiSuggestion(record);
    return { suggestionId: created.id };
  });
}
