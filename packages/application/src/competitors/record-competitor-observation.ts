import { DomainError } from "@aquarela/domain";

import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import {
  COMPETITOR_COLLECTION_MODES,
  type CompetitorObservationRecord,
  type CompetitorStore,
} from "./types";
import {
  assertEnumValue,
  assertIsoInstant,
  assertOptionalUuid,
  assertUuid,
  optionalCurrency,
  optionalNonNegativePrice,
  optionalRecord,
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
  /** `ADR-0010`/`DEC-143`: the approved source this was captured from. */
  readonly competitorSourceId?: string | null;
  /** One of `COMPETITOR_COLLECTION_MODES`; `automated` only for an approved source. */
  readonly captureMethod?: string | null;
  readonly productCategory?: string | null;
  readonly season?: string | null;
  /** URL/capture time/method/content hash; `{}` when unknown. */
  readonly provenance?: Record<string, unknown> | null;
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
  assertOptionalUuid(input.competitorSourceId, "competitorSourceId");
  const captureMethod =
    input.captureMethod === null || input.captureMethod === undefined
      ? null
      : assertEnumValue(input.captureMethod, COMPETITOR_COLLECTION_MODES, "captureMethod");
  const productCategory = optionalText(input.productCategory);
  const season = optionalText(input.season);
  const provenance = optionalRecord(input.provenance, "provenance");

  return store.withTransaction(async (tx) => {
    const competitor = await tx.findCompetitor({
      organizationId: input.organizationId,
      competitorId: input.competitorId,
    });
    if (competitor === undefined) {
      throw new DomainError("competitor not found in organization");
    }

    // A supplied source must belong to this organization and, when it already
    // names a competitor, that link must match the observation's competitor —
    // otherwise the observation would cross-link two competitors.
    if (input.competitorSourceId !== null && input.competitorSourceId !== undefined) {
      const source = await tx.findCompetitorSource({
        organizationId: input.organizationId,
        sourceId: input.competitorSourceId,
      });
      if (source === undefined) {
        throw new DomainError("competitor source not found in organization");
      }
      if (source.competitorId !== null && source.competitorId !== input.competitorId) {
        throw new DomainError("competitor source belongs to a different competitor");
      }
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
      competitorSourceId: input.competitorSourceId ?? null,
      captureMethod,
      productCategory,
      season,
      provenance,
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
        competitor_source_id: created.competitorSourceId,
        capture_method: created.captureMethod,
        review_status: created.reviewStatus,
      },
    });

    return created;
  });
}
