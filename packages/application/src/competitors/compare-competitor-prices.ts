import { MONEY_SCALE, divideRoundHalfUp, formatDecimal, parseDecimal } from "@aquarela/domain";

import type { CompetitorObservationRecord, CompetitorStore } from "./types";
import { assertIsoInstant, assertOptionalUuid } from "./validation";

/** Page size when the caller does not ask for one. */
export const DEFAULT_COMPETITOR_COMPARISON_LIMIT = 500;

/** The scale the price ratio is reported at (a dimensionless factor). */
const RATIO_SCALE = 6;

/** Why one reviewed observation could not be paired with our own price. */
export type CompetitorComparisonMissReason =
  | "no_item"
  | "no_competitor_price"
  | "no_product_variant"
  | "no_effective_price"
  | "currency_mismatch";

/** A reviewed observation paired with our own effective price for the same item. */
export interface CompetitorPriceComparison {
  readonly comparable: true;
  readonly observationId: string;
  readonly competitorId: string;
  readonly itemId: string;
  readonly externalName: string;
  /** `timestamptz`, ISO. */
  readonly observedAt: string;
  /** The competitor's price (`numeric(19,4)` decimal string). */
  readonly competitorPrice: string;
  readonly competitorCurrency: string | null;
  /** The unit both figures are compared in (the competitor's, else ours). */
  readonly currency: string | null;
  /** `competitorPrice - ourPrice`, `numeric(19,4)`. */
  readonly difference: string;
  /** `competitorPrice / ourPrice` at 6 dp; null when our price is zero. */
  readonly ratio: string | null;
  /** Whole days from our price's `effective_from` to the observation. */
  readonly dateGapDays: number;
  /** Our own effective price we compared against. */
  readonly ourPrice: string;
  /** Our gross price for the same version (informational). */
  readonly ourGrossPrice: string;
  /** The basis of `ourPrice`. The effective-price read resolves a `price_version`,
   * whose comparable figure is its net price. */
  readonly ourPriceBasis: "net";
  readonly ourPriceVersionId: string;
  readonly ourProductVariantId: string;
  /** `timestamptz`, ISO; when our price version became effective. */
  readonly ourPriceEffectiveFrom: string;
}

/** A reviewed observation that is reported as not comparable, with the reason. */
export interface CompetitorPriceComparisonMiss {
  readonly comparable: false;
  readonly reason: CompetitorComparisonMissReason;
  readonly observationId: string;
  readonly competitorId: string;
  readonly externalName: string;
  /** `timestamptz`, ISO. */
  readonly observedAt: string;
  readonly itemId: string | null;
}

export type CompetitorPriceComparisonRow =
  CompetitorPriceComparison | CompetitorPriceComparisonMiss;

export interface CompareCompetitorPricesQuery {
  readonly organizationId: string;
  /** Restrict to observations of this comparable item. */
  readonly itemId?: string;
  /** Restrict to observations of this competitor. */
  readonly competitorId?: string;
  /** Lower bound on `observedAt` (`>=`); ISO instant. */
  readonly from: string;
  /** Upper bound on `observedAt` (`<`); ISO instant — a half-open window. */
  readonly to: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Pairs each **reviewed** observation in the window with our own effective price
 * for the same `item_id` at the observation instant (`DEC-126`).
 *
 * Our price is resolved through the existing effective-price read: the
 * comparable `item_id` is bridged to its selling `product_variant` (via
 * `product_variant.finished_good_item_id`) and the effective `price_version` is
 * read at `observed_at` in the organization-wide exact scope (`null` location,
 * `null` channel — an observation carries neither). The comparable figure is the
 * version's **net** price; the gross price and the version's `effective_from`
 * travel with it.
 *
 * A row is reported as **not comparable** rather than guessed at when: the
 * observation names no `item_id` (`no_item`), carries no price
 * (`no_competitor_price`), maps to no variant (`no_product_variant`), has no
 * effective price version at that instant (`no_effective_price`), or is stated
 * in a different currency from ours (`currency_mismatch`). **Only reviewed
 * observations are read** — a pending or rejected observation never appears.
 *
 * Money is decimal only: the difference and ratio are computed from the
 * `numeric(19,4)` strings with the domain BigInt helpers, never floats.
 */
export async function compareCompetitorPrices(
  store: CompetitorStore,
  query: CompareCompetitorPricesQuery,
): Promise<readonly CompetitorPriceComparisonRow[]> {
  assertOptionalUuid(query.itemId, "itemId");
  assertOptionalUuid(query.competitorId, "competitorId");
  assertIsoInstant(query.from, "from");
  assertIsoInstant(query.to, "to");

  const organizationCurrency = await store.findOrganizationCurrency({
    organizationId: query.organizationId,
  });

  const observations = await store.listObservations({
    organizationId: query.organizationId,
    ...(query.competitorId === undefined ? {} : { competitorId: query.competitorId }),
    // The comparison is an intelligence read: it never widens beyond reviewed.
    status: "reviewed",
    from: query.from,
    to: query.to,
    limit: query.limit ?? DEFAULT_COMPETITOR_COMPARISON_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });

  const rows: CompetitorPriceComparisonRow[] = [];
  for (const observation of observations) {
    if (query.itemId !== undefined && observation.itemId !== query.itemId) {
      continue;
    }
    rows.push(await compareOne(store, query.organizationId, organizationCurrency, observation));
  }
  return rows;
}

function miss(
  observation: CompetitorObservationRecord,
  reason: CompetitorComparisonMissReason,
): CompetitorPriceComparisonMiss {
  return {
    comparable: false,
    reason,
    observationId: observation.id,
    competitorId: observation.competitorId,
    externalName: observation.externalName,
    observedAt: observation.observedAt,
    itemId: observation.itemId,
  };
}

async function compareOne(
  store: CompetitorStore,
  organizationId: string,
  organizationCurrency: string | undefined,
  observation: CompetitorObservationRecord,
): Promise<CompetitorPriceComparisonRow> {
  if (observation.itemId === null) {
    return miss(observation, "no_item");
  }
  if (observation.price === null) {
    return miss(observation, "no_competitor_price");
  }
  if (
    observation.currency !== null &&
    organizationCurrency !== undefined &&
    observation.currency !== organizationCurrency
  ) {
    return miss(observation, "currency_mismatch");
  }

  const variant = await store.findProductVariantForItem({
    organizationId,
    itemId: observation.itemId,
  });
  if (variant === undefined) {
    return miss(observation, "no_product_variant");
  }

  const price = await store.findEffectivePriceVersion({
    organizationId,
    productVariantId: variant.id,
    asOf: observation.observedAt,
  });
  if (price === undefined) {
    return miss(observation, "no_effective_price");
  }

  const ourUnits = parseDecimal(price.netPrice, MONEY_SCALE);
  const competitorUnits = parseDecimal(observation.price, MONEY_SCALE);
  const difference = formatDecimal(competitorUnits - ourUnits, MONEY_SCALE);
  const ratio =
    ourUnits === 0n
      ? null
      : formatDecimal(
          divideRoundHalfUp(competitorUnits * 10n ** BigInt(RATIO_SCALE), ourUnits),
          RATIO_SCALE,
        );
  const dateGapDays = Math.floor(
    (Date.parse(observation.observedAt) - Date.parse(price.effectiveFrom)) / 86_400_000,
  );

  return {
    comparable: true,
    observationId: observation.id,
    competitorId: observation.competitorId,
    itemId: observation.itemId,
    externalName: observation.externalName,
    observedAt: observation.observedAt,
    competitorPrice: observation.price,
    competitorCurrency: observation.currency,
    currency: observation.currency ?? organizationCurrency ?? null,
    difference,
    ratio,
    dateGapDays,
    ourPrice: price.netPrice,
    ourGrossPrice: price.grossPrice,
    ourPriceBasis: "net",
    ourPriceVersionId: price.priceVersionId,
    ourProductVariantId: price.productVariantId,
    ourPriceEffectiveFrom: price.effectiveFrom,
  };
}
