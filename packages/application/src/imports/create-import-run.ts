import { DomainError } from "@aquarela/domain";

import { IMPORTS_AUDIT_ACTIONS } from "./actions";
import type { ImportStore } from "./types";
import { assertIsoDate, isBlank } from "./validation";
import { DEFAULT_IMPORT_POSTING_POLICY, IMPORT_POSTING_POLICY } from "./vocabularies";

export interface CreateImportRunInput {
  readonly organizationId: string;
  readonly actorId: string;
  /** The source system the file came from (e.g. the POS export name). */
  readonly source: string;
  /** Opaque caller string: there is no import-profile table (recorded open point). */
  readonly profileVersion: string;
  /** Content hash of the uploaded file; the replay guard (`05_WORKFLOWS.md` step 2). */
  readonly fileHash: string;
  /** `date` (`yyyy-mm-dd`): the business period the file covers. */
  readonly periodStart: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodEnd: string;
  /**
   * Plain uuid (recorded open point: no `file` table exists yet). Stored
   * verbatim and never dereferenced.
   */
  readonly fileObjectId?: string | null;
  /** `IMPORT_POSTING_POLICY`; defaults to `allow_partial` (`DEC-025`). */
  readonly postingPolicy?: string;
}

export interface CreateImportRunResult {
  readonly importRunId: string;
  readonly status: string;
}

/**
 * Registers an uploaded file as a new run in `uploaded` (`SALE-004`, step 1–2).
 *
 * A duplicate `fileHash` **within the organization** is a replay of an existing
 * file (`05_WORKFLOWS.md` step 8: replaying must not duplicate sales), so it is
 * rejected with a `DomainError` naming the existing run rather than opening a
 * second run. The caller can then resume the existing run.
 *
 * There is no import-profile table, so `profileVersion` is an opaque string and
 * the posting policy is recorded in `diagnostics` (recorded open point,
 * `DEC-025` default `allow_partial`). No posting happens here or anywhere in
 * this slice.
 */
export async function createImportRun(
  store: ImportStore,
  input: CreateImportRunInput,
): Promise<CreateImportRunResult> {
  if (isBlank(input.source)) {
    throw new DomainError("source is required");
  }
  if (isBlank(input.profileVersion)) {
    throw new DomainError("profileVersion is required");
  }
  if (isBlank(input.fileHash)) {
    throw new DomainError("fileHash is required");
  }
  assertIsoDate(input.periodStart, "periodStart");
  assertIsoDate(input.periodEnd, "periodEnd");
  if (input.periodStart > input.periodEnd) {
    throw new DomainError("periodStart must not be after periodEnd");
  }
  const postingPolicy = input.postingPolicy ?? DEFAULT_IMPORT_POSTING_POLICY;
  if (!IMPORT_POSTING_POLICY.includes(postingPolicy)) {
    throw new DomainError(`unknown import posting policy: ${postingPolicy}`);
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.findImportRun({
      organizationId: input.organizationId,
      fileHash: input.fileHash,
    });
    if (existing !== undefined) {
      throw new DomainError(
        `duplicate import file hash (replay of existing import_run ${existing.id})`,
      );
    }

    const run = await tx.createImportRun({
      organizationId: input.organizationId,
      source: input.source.trim(),
      profileVersion: input.profileVersion.trim(),
      fileObjectId: input.fileObjectId ?? null,
      fileHash: input.fileHash.trim(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "uploaded",
      rowCounts: {},
      diagnostics: { posting_policy: postingPolicy },
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: IMPORTS_AUDIT_ACTIONS.runCreated,
      entityType: "import_run",
      entityId: run.id,
      after: {
        source: run.source,
        profile_version: run.profileVersion,
        file_hash: run.fileHash,
        period_start: run.periodStart,
        period_end: run.periodEnd,
        posting_policy: postingPolicy,
      },
    });

    return { importRunId: run.id, status: run.status };
  });
}
