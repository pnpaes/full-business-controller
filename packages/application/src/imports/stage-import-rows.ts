import { DomainError } from "@aquarela/domain";

import { IMPORTS_AUDIT_ACTIONS } from "./actions";
import type { ImportStore } from "./types";
import { isPlainObject } from "./validation";

export interface StageImportRowInput {
  /** 1-based row number in the source file; unique within the run. */
  readonly sourceRowNo: number;
  /** The row exactly as parsed from the file, before interpretation. */
  readonly raw: Readonly<Record<string, unknown>>;
  /** The profile's normalized projection; the raw row is never mutated. */
  readonly normalized: Readonly<Record<string, unknown>>;
}

export interface StageImportRowsInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  readonly rows: readonly StageImportRowInput[];
}

export interface StageImportRowsResult {
  readonly importRunId: string;
  readonly stagedCount: number;
  readonly status: string;
}

/**
 * Stages parsed rows into `import_staging_row` and moves the run to `parsed`
 * (`SALE-004`, step 3).
 *
 * **Every well-formed row is retained** (`SALE-004`): a row that is
 * semantically invalid is *not* dropped here — it is stored with its `raw` and
 * `normalized` jsonb and left for `validateImportRun` to mark with an
 * `error_code`. Only a structurally impossible row (not an object, or a
 * duplicate/absent `source_row_no`) is a caller error and is rejected before
 * the transaction.
 *
 * Staging is allowed only from `uploaded`; a run that has already been staged
 * is not re-staged, so a replayed call cannot duplicate rows.
 */
export async function stageImportRows(
  store: ImportStore,
  input: StageImportRowsInput,
): Promise<StageImportRowsResult> {
  const seen = new Set<number>();
  for (const row of input.rows) {
    if (!Number.isInteger(row.sourceRowNo) || row.sourceRowNo < 1) {
      throw new DomainError("sourceRowNo must be a positive integer");
    }
    if (seen.has(row.sourceRowNo)) {
      throw new DomainError(`duplicate sourceRowNo in the staged batch: ${row.sourceRowNo}`);
    }
    seen.add(row.sourceRowNo);
    if (!isPlainObject(row.raw) || !isPlainObject(row.normalized)) {
      throw new DomainError(`row ${row.sourceRowNo}: raw and normalized must be objects`);
    }
  }

  return store.withTransaction(async (tx) => {
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }
    if (run.status !== "uploaded") {
      throw new DomainError(`import run is not awaiting staging (status ${run.status})`);
    }

    for (const row of input.rows) {
      await tx.createImportStagingRow({
        importRunId: run.id,
        sourceRowNo: row.sourceRowNo,
        raw: row.raw,
        normalized: row.normalized,
        mappingState: "unmapped",
        errorCode: null,
        linkedSalesLineId: null,
      });
    }

    const updated = await tx.updateImportRun(run.id, {
      status: "parsed",
      rowCounts: { ...run.rowCounts, staged: input.rows.length },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: IMPORTS_AUDIT_ACTIONS.rowsStaged,
      entityType: "import_run",
      entityId: run.id,
      after: { staged: input.rows.length, status: updated.status },
    });

    return { importRunId: run.id, stagedCount: input.rows.length, status: updated.status };
  });
}
