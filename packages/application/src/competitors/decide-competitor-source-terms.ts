import { DomainError, NotFoundError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import type { CompetitorSourceRecord, CompetitorStore } from "./types";
import { assertUuid } from "./validation";

export interface DecideCompetitorSourceTermsInput {
  readonly organizationId: string;
  /** The named approver/rejecter; recorded as `approved_by`. */
  readonly actorId: string;
  readonly sourceId: string;
}

/**
 * Applies a per-source terms decision (`ADR-0010`/`DEC-143`, `COMP-001`): the
 * `approved`/`rejected` state plus the deciding actor and instant. This is a
 * **higher bar** than capturing an observation — the API restricts it to
 * `COMPETITOR_TERMS_ROLES` (owner/admin), where observation review stays with
 * the competitor write roles.
 *
 * `rejected` is refused on an `automated` source: the database would reject the
 * write anyway (`competitor_source_automation_requires_approval_check`), but the
 * command turns it into a message-only `DomainError` and points at deactivation,
 * which is the correct way to stop automated collection.
 *
 * A missing or cross-organization source is a `NotFoundError`. The decision and
 * its audit fact commit or roll back together.
 */
async function decide(
  store: CompetitorStore,
  input: DecideCompetitorSourceTermsInput,
  decision: "approved" | "rejected",
): Promise<CompetitorSourceRecord> {
  assertUuid(input.sourceId, "sourceId");

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockCompetitorSource({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (existing === undefined) {
      throw new NotFoundError("competitor source not found in organization");
    }
    if (decision === "rejected" && existing.collectionMode === "automated") {
      throw new DomainError(
        "an automated source requires approved terms; deactivate it instead of rejecting",
      );
    }

    const updated = await tx.updateCompetitorSourceTerms({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      termsStatus: decision,
      approvedBy: input.actorId,
      approvedAt: new Date().toISOString(),
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("competitor source not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action:
        decision === "approved"
          ? COMPETITOR_AUDIT_ACTIONS.sourceTermsApproved
          : COMPETITOR_AUDIT_ACTIONS.sourceTermsRejected,
      entityType: "competitor_source",
      entityId: updated.id,
      before: { terms_status: existing.termsStatus },
      after: {
        terms_status: updated.termsStatus,
        approved_by: updated.approvedBy,
        approved_at: updated.approvedAt,
      },
    });

    return updated;
  });
}

/** Approves one source's terms (owner/admin at the route). */
export function approveCompetitorSourceTerms(
  store: CompetitorStore,
  input: DecideCompetitorSourceTermsInput,
): Promise<CompetitorSourceRecord> {
  return decide(store, input, "approved");
}

/** Rejects one source's terms (owner/admin at the route); refused for `automated`. */
export function rejectCompetitorSourceTerms(
  store: CompetitorStore,
  input: DecideCompetitorSourceTermsInput,
): Promise<CompetitorSourceRecord> {
  return decide(store, input, "rejected");
}
