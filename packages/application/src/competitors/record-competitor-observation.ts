import { DomainError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import type { CompetitorObservationRecord, CompetitorStore } from "./types";
import {
  assertIsoInstant,
  assertOptionalUuid,
  assertUuid,
  optionalCurrency,
  optionalNonNegativePrice,
  optionalText,
  requiredText,
} from "./validation";

export interface RecordCompetitorObservationInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly competitorId: string;
  /** `timestamptz`, ISO-8601 instant. */
  readonly observedAt: string;
  /** Free text: a receipt, a menu photo, a website, a staff note. */
  readonly source: string;
  readonly sourceUrl?: string | null;
  /** Our comparable (`item.id`), or null when the offer maps to nothing we sell. */
  readonly itemId?: string | null;
  /** What the competitor calls this offer. */
  readonly externalName: string;
  readonly price?: string | null;
  readonly currency?: string | null;
  readonly offerNotes?: string | null;
}

/**
 * Records one competitor observation (`DEC-126`). The observation **always opens
 * `pending`** — capture is not a review, so the review gate (`DEC-020`) is the
 * only way it can later be read as intelligence.
 *
 * Validated before the write: the competitor must exist **in this organization**
 * (`findCompetitor`, `DEC-061`), `observedAt` must be an ISO instant, the
 * `source` and `externalName` must be non-blank (trimmed), the optional `itemId`
 * must be a uuid, the optional `price` must be a non-negative `numeric(19,4)`
 * decimal (canonicalised, never a float) and the optional `currency` a 3-letter
 * code (upper-cased). Text fields are trimmed; a blank optional text becomes
 * `null`.
 *
 * The row and its `competitors.observation.recorded` audit fact commit or roll
 * back together.
 */
export async function recordCompetitorObservation(
  store: CompetitorStore,
  input: RecordCompetitorObservationInput,
): Promise<CompetitorObservationRecord> {
  assertUuid(input.competitorId, "competitorId");
  assertIsoInstant(input.observedAt, "observedAt");
  const source = requiredText(input.source, "source");
  const externalName = requiredText(input.externalName, "externalName");
  const sourceUrl = optionalText(input.sourceUrl);
  const offerNotes = optionalText(input.offerNotes);
  assertOptionalUuid(input.itemId, "itemId");
  const price = optionalNonNegativePrice(input.price, "price");
  const currency = optionalCurrency(input.currency);

  return store.withTransaction(async (tx) => {
    const competitor = await tx.findCompetitor({
      organizationId: input.organizationId,
      competitorId: input.competitorId,
    });
    if (competitor === undefined) {
      throw new DomainError("competitor not found in organization");
    }

    const created = await tx.createObservation({
      organizationId: input.organizationId,
      competitorId: input.competitorId,
      observedAt: input.observedAt,
      source,
      sourceUrl,
      itemId: input.itemId ?? null,
      externalName,
      price,
      currency,
      offerNotes,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COMPETITOR_AUDIT_ACTIONS.observationRecorded,
      entityType: "competitor_observation",
      entityId: created.id,
      after: {
        competitor_id: created.competitorId,
        observed_at: created.observedAt,
        source: created.source,
        item_id: created.itemId,
        external_name: created.externalName,
        price: created.price,
        currency: created.currency,
        review_status: created.reviewStatus,
      },
    });

    return created;
  });
}
