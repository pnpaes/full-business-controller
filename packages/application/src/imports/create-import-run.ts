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
  /**
   * The import profile's version label. Optional when the source has a profile
   * (`DEC-081`): the run then takes the profile's version, and a value that
   * differs from it is rejected. Required when no profile exists (`DEC-025`).
   */
  readonly profileVersion?: string;
  /** Content hash of the uploaded file; the replay guard (`05_WORKFLOWS.md` step 2). */
  readonly fileHash: string;
  /** `date` (`yyyy-mm-dd`): the business period the file covers. */
  readonly periodStart: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly periodEnd: string;
  /**
   * The uploaded file's `file_object` id, or `null`. A real FK since migration
   * `0035` (`DEC-085`); stored verbatim and never dereferenced here.
   */
  readonly fileObjectId?: string | null;
  /**
   * `IMPORT_POSTING_POLICY`; defaults to `allow_partial` (`DEC-025`) when the
   * source has no profile, otherwise must match the profile's policy.
   */
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
 * `DEC-081`: when the source has an `import_profile`, the run records its id and
 * takes the profile's posting policy and version; a caller-supplied policy or
 * version that conflicts with the profile is rejected rather than silently
 * ignored. With no profile the previous behaviour stands (`DEC-025`):
 * `profileVersion` is required and `postingPolicy` defaults to `allow_partial`.
 * No posting happens here or anywhere in this slice.
 */
export async function createImportRun(
  store: ImportStore,
  input: CreateImportRunInput,
): Promise<CreateImportRunResult> {
  if (isBlank(input.source)) {
    throw new DomainError("source is required");
  }
  if (isBlank(input.fileHash)) {
    throw new DomainError("fileHash is required");
  }
  assertIsoDate(input.periodStart, "periodStart");
  assertIsoDate(input.periodEnd, "periodEnd");
  if (input.periodStart > input.periodEnd) {
    throw new DomainError("periodStart must not be after periodEnd");
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

    const source = input.source.trim();
    const requestedPostingPolicy = input.postingPolicy?.trim();
    // The profile depends on the source, so it is resolved inside the
    // transaction alongside the policy/version checks.
    const profile = await tx.findImportProfile({ organizationId: input.organizationId, source });

    let postingPolicy: string;
    let profileVersion: string;
    let importProfileId: string | null;
    if (profile !== undefined) {
      if (
        requestedPostingPolicy !== undefined &&
        requestedPostingPolicy !== profile.postingPolicy
      ) {
        throw new DomainError(
          `postingPolicy ${requestedPostingPolicy} conflicts with import_profile ${profile.id} ` +
            `posting policy ${profile.postingPolicy}`,
        );
      }
      if (
        input.profileVersion !== undefined &&
        input.profileVersion.trim() !== profile.profileVersion
      ) {
        throw new DomainError(
          `profileVersion ${input.profileVersion} conflicts with import_profile ${profile.id} ` +
            `profile version ${profile.profileVersion}`,
        );
      }
      postingPolicy = profile.postingPolicy;
      profileVersion = profile.profileVersion;
      importProfileId = profile.id;
    } else {
      if (input.profileVersion === undefined || isBlank(input.profileVersion)) {
        throw new DomainError(
          `profileVersion is required when no import profile exists for source ${source}`,
        );
      }
      postingPolicy = requestedPostingPolicy ?? DEFAULT_IMPORT_POSTING_POLICY;
      if (!IMPORT_POSTING_POLICY.includes(postingPolicy)) {
        throw new DomainError(`unknown import posting policy: ${postingPolicy}`);
      }
      profileVersion = input.profileVersion.trim();
      importProfileId = null;
    }

    const run = await tx.createImportRun({
      organizationId: input.organizationId,
      source,
      importProfileId,
      profileVersion,
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
