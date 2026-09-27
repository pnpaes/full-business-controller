import { DomainError } from "@aquarela/domain";
import { AI_RUN_KIND, AI_RUN_STATUS } from "@aquarela/persistence";

import type { AiAdvisoryWriteStore, NewAiAnalysisRunRecord } from "./write-types";

/** A non-negative decimal string with at most 4 dp, or `null`/absent. */
const COST_PATTERN = /^\d+(\.\d{1,4})?$/;

export interface RecordAiAnalysisRunInput {
  readonly organizationId: string;
  /** The acting user; `null` for a system/scheduled run. */
  readonly actorId: string | null;
  readonly kind: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputScope?: Record<string, unknown>;
  readonly inputSnapshot?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  /** Defaults to `pending`. */
  readonly status?: string;
  readonly tokenCounts?: Record<string, unknown>;
  readonly costEstimate?: string | null;
}

export interface RecordAiAnalysisRunResult {
  readonly analysisRunId: string;
}

/**
 * Records one `ai_analysis_run` (`ADR-0009`, `DEC-142`). The run is
 * **append-only** provenance: provider, model, prompt version, frozen inputs and
 * output are stored together so a non-deterministic provider call stays
 * reproducible, and `input_snapshot` must exclude personal data (the caller's
 * responsibility; the command cannot inspect arbitrary JSON for that). The
 * vocabulary and cost bounds are validated here so a bad value is a
 * `DomainError`, with the database check as the backstop.
 */
export async function recordAiAnalysisRun(
  store: AiAdvisoryWriteStore,
  input: RecordAiAnalysisRunInput,
): Promise<RecordAiAnalysisRunResult> {
  const kind = input.kind;
  if (!(AI_RUN_KIND as readonly string[]).includes(kind)) {
    throw new DomainError(`kind must be one of ${AI_RUN_KIND.join(", ")}`);
  }

  const provider = input.provider.trim();
  if (provider.length === 0) {
    throw new DomainError("provider must not be empty");
  }
  const model = input.model.trim();
  if (model.length === 0) {
    throw new DomainError("model must not be empty");
  }
  const promptVersion = input.promptVersion.trim();
  if (promptVersion.length === 0) {
    throw new DomainError("promptVersion must not be empty");
  }

  const status = input.status ?? "pending";
  if (!(AI_RUN_STATUS as readonly string[]).includes(status)) {
    throw new DomainError(`status must be one of ${AI_RUN_STATUS.join(", ")}`);
  }

  const costEstimate = input.costEstimate ?? null;
  if (costEstimate !== null && !COST_PATTERN.test(costEstimate.trim())) {
    throw new DomainError("costEstimate must be a non-negative decimal with at most 4 decimals");
  }

  const record: NewAiAnalysisRunRecord = {
    organizationId: input.organizationId,
    kind,
    provider,
    model,
    promptVersion,
    status,
    costEstimate: costEstimate === null ? null : costEstimate.trim(),
    actorId: input.actorId,
    ...(input.inputScope === undefined ? {} : { inputScope: input.inputScope }),
    ...(input.inputSnapshot === undefined ? {} : { inputSnapshot: input.inputSnapshot }),
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.tokenCounts === undefined ? {} : { tokenCounts: input.tokenCounts }),
  };
  const created = await store.createAiAnalysisRun(record);
  return { analysisRunId: created.id };
}
