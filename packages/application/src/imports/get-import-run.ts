import {
  readConflicts,
  readDispositions,
  readIssues,
  type ImportDispositionRecord,
  type ImportMappingConflict,
  type ImportRowIssue,
} from "./diagnostics";
import type { ImportRunRecord, ImportStagingRowRecord, ImportStore } from "./types";

export interface ImportRunDetail {
  readonly run: ImportRunRecord;
  readonly rows: readonly ImportStagingRowRecord[];
  readonly issues: readonly ImportRowIssue[];
  readonly conflicts: readonly ImportMappingConflict[];
  readonly dispositions: readonly ImportDispositionRecord[];
}

/**
 * One run with its staging rows and the diagnostics written so far (`SALE-004`:
 * invalid rows stay visible in the review queue). Organization-scoped
 * (`DEC-061`); `undefined` for an unknown id or another tenant's run.
 */
export async function getImportRun(
  store: ImportStore,
  query: { readonly organizationId: string; readonly importRunId: string },
): Promise<ImportRunDetail | undefined> {
  const run = await store.findImportRun({
    organizationId: query.organizationId,
    importRunId: query.importRunId,
  });
  if (run === undefined || run.organizationId !== query.organizationId) {
    return undefined;
  }
  const rows = await store.listImportStagingRows({
    organizationId: query.organizationId,
    importRunId: run.id,
  });

  return {
    run,
    rows,
    issues: readIssues(run.diagnostics),
    conflicts: readConflicts(run.diagnostics),
    dispositions: readDispositions(run.diagnostics),
  };
}
