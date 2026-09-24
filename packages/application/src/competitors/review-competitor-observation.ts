import { DomainError, NotFoundError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import type { CompetitorObservationRecord, CompetitorStore } from "./types";
import { assertUuid } from "./validation";

/** The only two decisions the review gate accepts (`DEC-126`). */
export type CompetitorReviewDecision = "reviewed" | "rejected";

export interface ReviewCompetitorObservationInput {
  readonly organizationId: string;
  /** The named reviewer; recorded as `reviewed_by`. */
  readonly actorId: string;
  readonly observationId: string;
  readonly decision: CompetitorReviewDecision;
}

/**
 * Applies the one-shot review decision to a `pending` observation (`DEC-126`,
 * the `DEC-020` human-review gate). `pending → reviewed` admits the observation
 * as intelligence; `pending → rejected` records it as not intelligence. Either
 * way the named reviewer and the decision instant are recorded.
 *
 * The transition happens **once**: the row is locked, a non-`pending` status is
 * rejected with a message-only `DomainError` (no write, no audit fact), and the
 * store's `WHERE … review_status = 'pending'` guard means a racing second
 * decision loses even without the lock. A missing or cross-organization
 * observation is a `NotFoundError`.
 *
 * The decision and its `competitors.observation.reviewed`/`.rejected` audit fact
 * commit or roll back together.
 */
export async function reviewCompetitorObservation(
  store: CompetitorStore,
  input: ReviewCompetitorObservationInput,
): Promise<CompetitorObservationRecord> {
  assertUuid(input.observationId, "observationId");

  return store.withTransaction(async (tx) => {
    const existing = await tx.lockObservation({
      organizationId: input.organizationId,
      observationId: input.observationId,
    });
    if (existing === undefined) {
      throw new NotFoundError("competitor observation not found in organization");
    }
    if (existing.reviewStatus !== "pending") {
      throw new DomainError(
        `competitor observation is already ${existing.reviewStatus} and cannot be decided again`,
      );
    }

    const updated = await tx.updateObservationReview({
      organizationId: input.organizationId,
      observationId: input.observationId,
      status: input.decision,
      reviewedBy: input.actorId,
      reviewedAt: new Date().toISOString(),
    });
    if (updated === undefined) {
      // Lost the race against another reviewer: the row was no longer pending by
      // the time the guarded update ran. Same message as the observed case.
      throw new DomainError("competitor observation is no longer pending");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action:
        input.decision === "reviewed"
          ? COMPETITOR_AUDIT_ACTIONS.observationReviewed
          : COMPETITOR_AUDIT_ACTIONS.observationRejected,
      entityType: "competitor_observation",
      entityId: updated.id,
      before: { review_status: existing.reviewStatus },
      after: {
        review_status: updated.reviewStatus,
        reviewed_by: updated.reviewedBy,
        reviewed_at: updated.reviewedAt,
      },
    });

    return updated;
  });
}
