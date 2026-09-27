import { DomainError, NotFoundError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import type { CompetitorSourceRecord, CompetitorStore } from "./types";
import { assertIsoDate, assertUuid } from "./validation";

export interface DeactivateCompetitorSourceInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly sourceId: string;
  /** ISO date (`YYYY-MM-DD`) the source stops being active. */
  readonly activeTo: string;
}

/**
 * Ends one source's active window by setting `active_to` (`ADR-0010`/`DEC-143`).
 * Deactivation is a range edit, not a delete: the source row and its observations
 * are kept (the append-only/soft-delete posture). `activeTo` must be strictly
 * after `activeFrom` (the `competitor_source_active_range_check`, surfaced here
 * as a `DomainError`). A missing or cross-organization source is a
 * `NotFoundError`; the update and its audit fact commit or roll back together.
 */
export async function deactivateCompetitorSource(
  store: CompetitorStore,
  input: DeactivateCompetitorSourceInput,
): Promise<CompetitorSourceRecord> {
  assertUuid(input.sourceId, "sourceId");
  const activeTo = assertIsoDate(input.activeTo, "activeTo");

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockCompetitorSource({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (existing === undefined) {
      throw new NotFoundError("competitor source not found in organization");
    }
    if (activeTo <= existing.activeFrom) {
      throw new DomainError("activeTo must be after activeFrom");
    }

    const updated = await tx.updateCompetitorSourceActiveTo({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      activeTo,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("competitor source not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COMPETITOR_AUDIT_ACTIONS.sourceDeactivated,
      entityType: "competitor_source",
      entityId: updated.id,
      before: { active_to: existing.activeTo },
      after: { active_to: updated.activeTo },
    });

    return updated;
  });
}
