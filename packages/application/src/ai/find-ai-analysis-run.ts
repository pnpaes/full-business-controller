import { NotFoundError } from "@aquarela/domain";

import type { AiAnalysisRunReadStore, AiAnalysisRunRecord } from "./read-types";

/**
 * The provenance of one AI run (`ADR-0009`, `DEC-142`), organization-scoped
 * (`DEC-061`). An unknown id or one belonging to another organization is a
 * `NotFoundError` — indistinguishable from "does not exist" at the route, so the
 * read cannot be used to probe for another tenant's run ids.
 */
export async function findAiAnalysisRun(
  store: AiAnalysisRunReadStore,
  query: { readonly organizationId: string; readonly analysisRunId: string },
): Promise<AiAnalysisRunRecord> {
  const run = await store.findAiAnalysisRun(query.organizationId, query.analysisRunId);
  if (run === undefined) {
    throw new NotFoundError(`analysis run ${query.analysisRunId} not found in this organization`);
  }
  return run;
}
