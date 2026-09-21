import type { ImportRunRecord, ImportStore, ListImportRunsQuery } from "./types";

export interface ImportRunSummary {
  readonly run: ImportRunRecord;
  readonly stagedCount: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly errorCount: number;
  /** Approved dispositions recorded so far (`DEC-035`). */
  readonly dispositionCount: number;
}

function countOf(run: ImportRunRecord, key: string): number {
  const value = run.rowCounts[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Runs for one organization, newest first (the repository orders them), each
 * summarised for the import list screen. The counts come from `row_counts`
 * (written by the commands) and the disposition counts from one grouped
 * `import_disposition` table query (`DEC-083`); no per-run staging read is
 * issued, so the list stays one query.
 *
 * `limit` defaults to 50 and the API caps it at 200.
 */
export async function listImportRuns(
  store: ImportStore,
  query: ListImportRunsQuery,
): Promise<readonly ImportRunSummary[]> {
  const runs = await store.listImportRuns({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.source === undefined ? {} : { source: query.source }),
    limit: query.limit ?? 50,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
  const counts = await store.countImportDispositionsByRun({
    organizationId: query.organizationId,
    importRunIds: runs.map((run) => run.id),
  });
  const dispositionCounts = new Map(counts.map((entry) => [entry.importRunId, entry.count]));

  return runs.map((run) => ({
    run,
    stagedCount: countOf(run, "staged"),
    mappedCount: countOf(run, "mapped"),
    unmappedCount: countOf(run, "unmapped"),
    errorCount: countOf(run, "error"),
    dispositionCount: dispositionCounts.get(run.id) ?? 0,
  }));
}
