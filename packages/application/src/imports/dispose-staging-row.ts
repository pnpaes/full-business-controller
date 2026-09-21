import { DomainError } from "@aquarela/domain";

import { IMPORTS_AUDIT_ACTIONS } from "./actions";
import type { ImportStore } from "./types";
import { IMPORT_DISPOSITIONS, type ImportDispositionKind } from "./vocabularies";

export interface DisposeStagingRowInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  readonly stagingRowId: string;
  /** One of `DEC-035`'s approved dispositions: `unmapped`, `rejected`, `ignored`. */
  readonly disposition: ImportDispositionKind;
  /** Why the row was not posted; required for a `rejected` disposition. */
  readonly reason?: string;
}

export interface DisposeStagingRowResult {
  readonly importRunId: string;
  readonly stagingRowId: string;
  readonly disposition: string;
  readonly mappingState: string;
  readonly runStatus: string;
}

/** How each approved disposition is represented on the staging row. */
function mappingStateFor(disposition: ImportDispositionKind): {
  readonly mappingState: string;
  readonly errorCode: string | null;
} {
  switch (disposition) {
    case "ignored":
      return { mappingState: "ignored", errorCode: null };
    case "rejected":
      // `MAPPING_STATE` has no `rejected` value; `error` + a distinct error_code
      // is the available representation (recorded open point).
      return { mappingState: "error", errorCode: "rejected" };
    case "unmapped":
      return { mappingState: "unmapped", errorCode: null };
  }
}

/**
 * Records an approved disposition for a non-posted row (`SALE-007`, `DEC-035`):
 * the run cannot close while a non-posted row lacks one. The actor recording it
 * is the approval — the record (actor, timestamp, reason) is the
 * `import_disposition` row (`DEC-083`), exactly one per staging row and no
 * longer appended to `diagnostics.dispositions`.
 *
 * A row already linked to a posted sales line cannot be dispositioned:
 * correcting a posted row is an explicit reversal in slice 12, never a staging
 * edit (`DEC-025`). Posting does not exist in slice 11, so `linkedSalesLineId`
 * is always null today; the guard is here so it stays true when slice 12 lands.
 */
export async function disposeStagingRow(
  store: ImportStore,
  input: DisposeStagingRowInput,
): Promise<DisposeStagingRowResult> {
  if (!IMPORT_DISPOSITIONS.includes(input.disposition)) {
    throw new DomainError(`unknown disposition: ${input.disposition}`);
  }
  if (input.disposition === "rejected" && (input.reason ?? "").trim() === "") {
    throw new DomainError("a rejected disposition requires a reason");
  }

  return store.withTransaction(async (tx) => {
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }
    if (run.status !== "parsed" && run.status !== "needs_review" && run.status !== "validated") {
      throw new DomainError(`import run is not open for dispositions (status ${run.status})`);
    }

    const row = await tx.findImportStagingRow({
      organizationId: input.organizationId,
      importRunId: run.id,
      stagingRowId: input.stagingRowId,
    });
    if (row === undefined) {
      throw new DomainError("staging row not found in import run");
    }
    if (row.linkedSalesLineId !== null) {
      throw new DomainError("a posted row cannot be dispositioned; post a reversal instead");
    }

    const { mappingState, errorCode } = mappingStateFor(input.disposition);
    const created = await tx.createImportDisposition({
      stagingRowId: row.id,
      disposition: input.disposition,
      reason: input.reason ?? null,
      actorId: input.actorId,
    });
    if (!created) {
      throw new DomainError(
        "this staging row already has an approved disposition; dispositions cannot be recorded twice",
      );
    }
    await tx.updateImportStagingRow(row.id, { mappingState, errorCode });

    const at = new Date().toISOString();
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: IMPORTS_AUDIT_ACTIONS.rowDispositioned,
      entityType: "import_staging_row",
      entityId: row.id,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      after: { disposition: input.disposition, mapping_state: mappingState, at },
    });

    return {
      importRunId: run.id,
      stagingRowId: row.id,
      disposition: input.disposition,
      mappingState,
      runStatus: run.status,
    };
  });
}
