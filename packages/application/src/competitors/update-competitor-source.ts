import { DomainError, NotFoundError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import {
  COMPETITOR_COLLECTION_MODES,
  type CompetitorSourceRecord,
  type CompetitorStore,
} from "./types";
import { assertEnumValue, assertUuid, optionalText, requiredText } from "./validation";

export interface UpdateCompetitorSourceInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly sourceId: string;
  /** A new URL/identifier; absent leaves it unchanged. */
  readonly urlOrIdentifier?: string;
  /** A new note; `null` clears it, absent leaves it unchanged. */
  readonly rateLimitNote?: string | null;
  /** `manual` or `automated`; absent leaves the mode unchanged. */
  readonly collectionMode?: string;
}

/**
 * Edits one competitor source (`ADR-0010`/`DEC-149` follow-up): its
 * `urlOrIdentifier`, `rateLimitNote` and/or `collectionMode`. `collection_mode`
 * was fixed at registration; this path changes it.
 *
 * **Switching to `automated` is a terms decision, not a write.** It is allowed
 * only when the source's terms are already `approved`; otherwise the command
 * throws a message-only `DomainError` and points at
 * `approveCompetitorSourceTerms` (owner/admin at the route) — the database's
 * `competitor_source_automation_requires_approval_check` is the backstop.
 * Switching to `manual` is always allowed and leaves `terms_status` untouched.
 *
 * A changed URL must stay unique per organization: a clash is a message-only
 * `DomainError` (the `registerCompetitorSource` precedent), and a concurrent
 * loser re-reads by URL on a fresh transaction. A missing or cross-organization
 * source is a `NotFoundError`. An edit that changes nothing writes no fact. The
 * update and its audit fact commit or roll back together.
 */
export async function updateCompetitorSource(
  store: CompetitorStore,
  input: UpdateCompetitorSourceInput,
): Promise<CompetitorSourceRecord> {
  assertUuid(input.sourceId, "sourceId");

  const urlProvided = input.urlOrIdentifier !== undefined;
  const rateLimitProvided = input.rateLimitNote !== undefined;
  const modeProvided = input.collectionMode !== undefined;
  if (!urlProvided && !rateLimitProvided && !modeProvided) {
    throw new DomainError("no competitor source fields to update");
  }

  const requestedUrl = urlProvided
    ? requiredText(input.urlOrIdentifier ?? "", "urlOrIdentifier")
    : undefined;
  const requestedMode = modeProvided
    ? assertEnumValue(input.collectionMode ?? "", COMPETITOR_COLLECTION_MODES, "collectionMode")
    : undefined;

  let attemptedUrl: string | undefined;
  try {
    return await store.withTransaction(async (tx) => {
      const existing = await tx.lockCompetitorSource({
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
      if (existing === undefined) {
        throw new NotFoundError("competitor source not found in organization");
      }

      const urlOrIdentifier = requestedUrl ?? existing.urlOrIdentifier;
      const rateLimitNote = rateLimitProvided
        ? optionalText(input.rateLimitNote ?? null)
        : existing.rateLimitNote;
      const collectionMode = requestedMode ?? existing.collectionMode;

      if (urlOrIdentifier !== existing.urlOrIdentifier) {
        const clash = await tx.findCompetitorSourceByUrl({
          organizationId: input.organizationId,
          urlOrIdentifier,
        });
        if (clash !== undefined && clash.id !== existing.id) {
          throw new DomainError("competitor source already exists for this organization");
        }
      }

      if (collectionMode === "automated" && existing.termsStatus !== "approved") {
        throw new DomainError(
          "switching to automated requires approved terms; approve the source's terms first",
        );
      }

      if (
        urlOrIdentifier === existing.urlOrIdentifier &&
        rateLimitNote === existing.rateLimitNote &&
        collectionMode === existing.collectionMode
      ) {
        return existing;
      }

      attemptedUrl = urlOrIdentifier;
      const updated = await tx.updateCompetitorSource({
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        urlOrIdentifier,
        rateLimitNote,
        collectionMode,
        updatedBy: input.actorId,
      });
      if (updated === undefined) {
        throw new NotFoundError("competitor source not found in organization");
      }

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: COMPETITOR_AUDIT_ACTIONS.sourceUpdated,
        entityType: "competitor_source",
        entityId: updated.id,
        before: {
          url_or_identifier: existing.urlOrIdentifier,
          rate_limit_note: existing.rateLimitNote,
          collection_mode: existing.collectionMode,
        },
        after: {
          url_or_identifier: updated.urlOrIdentifier,
          rate_limit_note: updated.rateLimitNote,
          collection_mode: updated.collectionMode,
        },
      });

      return updated;
    });
  } catch (error) {
    // The recovery must run on a fresh transaction: a unique violation aborted
    // the failed one, so an in-transaction re-read would throw.
    if (attemptedUrl === undefined) {
      throw error;
    }
    const raced = await store.findCompetitorSourceByUrl({
      organizationId: input.organizationId,
      urlOrIdentifier: attemptedUrl,
    });
    if (raced !== undefined && raced.id !== input.sourceId) {
      throw new DomainError("competitor source already exists for this organization");
    }
    throw error;
  }
}
