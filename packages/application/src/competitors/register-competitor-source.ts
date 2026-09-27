import { DomainError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import {
  COMPETITOR_COLLECTION_MODES,
  COMPETITOR_SOURCE_TYPES,
  type CompetitorSourceRecord,
  type CompetitorStore,
} from "./types";
import {
  assertEnumValue,
  assertIsoDate,
  assertOptionalUuid,
  optionalText,
  requiredText,
} from "./validation";

export interface RegisterCompetitorSourceInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly competitorName: string;
  /** Optional internal competitor link (deferred); a uuid when supplied. */
  readonly competitorId?: string | null;
  /** One of `COMPETITOR_SOURCE_TYPES`. */
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  /** One of `COMPETITOR_COLLECTION_MODES`. */
  readonly collectionMode: string;
  readonly rateLimitNote?: string | null;
  /** ISO date (`YYYY-MM-DD`) the source becomes active. */
  readonly activeFrom: string;
}

/**
 * Registers one competitor source (`ADR-0010`/`DEC-143`, `COMP-001`).
 *
 * **Automation is never enabled before approval.** An `automated` source is
 * created already `terms_status = 'approved'`, with the registering actor
 * recorded as `approved_by` and the instant as `approved_at`; the two facts (the
 * registration and the terms approval) are written separately so the
 * higher-bar decision is always its own audit event. The route gates that path
 * to `COMPETITOR_TERMS_ROLES` (owner/admin). A `manual` source opens `pending`
 * and is approved later through `approveCompetitorSourceTerms`.
 *
 * `(organizationId, urlOrIdentifier)` is unique: a duplicate is a message-only
 * `DomainError` (the `registerCompetitor` name-conflict precedent), and a
 * concurrent loser re-reads by URL on a fresh transaction.
 *
 * The row and its audit facts commit or roll back together.
 */
export async function registerCompetitorSource(
  store: CompetitorStore,
  input: RegisterCompetitorSourceInput,
): Promise<CompetitorSourceRecord> {
  const competitorName = requiredText(input.competitorName, "competitorName");
  const urlOrIdentifier = requiredText(input.urlOrIdentifier, "urlOrIdentifier");
  const sourceType = assertEnumValue(input.sourceType, COMPETITOR_SOURCE_TYPES, "sourceType");
  const collectionMode = assertEnumValue(
    input.collectionMode,
    COMPETITOR_COLLECTION_MODES,
    "collectionMode",
  );
  assertOptionalUuid(input.competitorId, "competitorId");
  const activeFrom = assertIsoDate(input.activeFrom, "activeFrom");
  const rateLimitNote = optionalText(input.rateLimitNote);

  const automated = collectionMode === "automated";
  const termsStatus = automated ? "approved" : "pending";
  const approvedBy = automated ? input.actorId : null;
  const approvedAt = automated ? new Date().toISOString() : null;

  let createAttempted = false;
  try {
    return await store.withTransaction(async (tx) => {
      const existing = await tx.findCompetitorSourceByUrl({
        organizationId: input.organizationId,
        urlOrIdentifier,
      });
      if (existing !== undefined) {
        throw new DomainError("competitor source already exists for this organization");
      }

      createAttempted = true;
      const created = await tx.createCompetitorSource({
        organizationId: input.organizationId,
        competitorName,
        competitorId: input.competitorId ?? null,
        sourceType,
        urlOrIdentifier,
        collectionMode,
        termsStatus,
        approvedBy,
        approvedAt,
        rateLimitNote,
        activeFrom,
        createdBy: input.actorId,
      });

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: COMPETITOR_AUDIT_ACTIONS.sourceRegistered,
        entityType: "competitor_source",
        entityId: created.id,
        after: {
          competitor_name: created.competitorName,
          source_type: created.sourceType,
          url_or_identifier: created.urlOrIdentifier,
          collection_mode: created.collectionMode,
          terms_status: created.termsStatus,
          active_from: created.activeFrom,
        },
      });

      if (automated) {
        await tx.writeAudit({
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: COMPETITOR_AUDIT_ACTIONS.sourceTermsApproved,
          entityType: "competitor_source",
          entityId: created.id,
          after: {
            terms_status: created.termsStatus,
            approved_by: created.approvedBy,
            approved_at: created.approvedAt,
          },
        });
      }

      return created;
    });
  } catch (error) {
    // The recovery must run on a fresh transaction: on Postgres the unique
    // violation aborted the failed one, so an in-transaction re-read would throw.
    if (!createAttempted) {
      throw error;
    }
    const raced = await store.findCompetitorSourceByUrl({
      organizationId: input.organizationId,
      urlOrIdentifier,
    });
    if (raced !== undefined) {
      throw new DomainError("competitor source already exists for this organization");
    }
    throw error;
  }
}
