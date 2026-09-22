import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql, type SQL } from "drizzle-orm";

import type { Database } from "../client";
import {
  channel,
  location,
  product,
  productVariant,
  salesLine,
  salesTransaction,
  wasteEvent,
} from "../schema";

/**
 * Sales & margin reporting reads (`RPT-001`–`RPT-003`, `ADR-0007`).
 *
 * On-demand, organization-scoped SQL over the canonical facts (`DEC-061`): no
 * aggregate table and no materialized view (the refresh job is gated on
 * `ADR-0004`, still `Proposed`). Every measure is a plain `numeric` sum returned
 * as text, so nothing is ever a float; the application read model shapes and
 * labels it.
 *
 * Metric definitions: `netSales` mirrors the domain `netSalesFromLine` source
 * preference (`coalesce(net_amount, gross − tax − discount − refund)`) inline —
 * the SQL group-by cannot call the domain function per line, so the two must
 * stay in step (`packages/domain/src/reporting.ts`). The two are not byte-equal
 * on a *blank* `net_amount`: `numeric` columns cannot store a blank, so the SQL
 * `coalesce` only collapses SQL `NULL`, while the domain treats a blank string
 * as absent. Stored data can only be `NULL` or a numeric, so the asymmetric edge
 * is unreachable from the database (the domain check guards callers).
 *
 * Rules:
 * - `sales_line.option_kind = 'included'` is excluded from revenue/margin
 *   (`SALE-011`): a zero-price included add-on line is retained for consumption
 *   but is not a sale. Its ledger consumption is excluded with it (the same
 *   `WHERE`), so the group's `ingredientCost` and `netSales` cover the same
 *   lines.
 * - **Variant resolution (`DEC-108` item 5, `DEC-109` item 4).** The
 *   `sales_line.product_variant_id` column is not written by the row-11 importer
 *   (the mapper keeps the resolved id only in `normalized.mapped_internal_entity_id`),
 *   so product/category grouping resolves a variant in a four-step chain:
 *   `sales_line.product_variant_id` when present → `sales_line.sku =
 *   product_variant.sku` within the organization (index `sales_line
 *   (organization_id, sku)`) → the effective `external_mapping` for the
 *   transaction's source (`internal_entity_type = 'product_variant'`, matched on
 *   sku or external id within `[effective_from, effective_to)`) → `null`, which
 *   groups as the `unmapped` bucket (never dropped). The resolved variant feeds
 *   both the `product` group-by and the `category`/`productVariantId` filters.
 * - A null resolved variant/category groups as one `unmapped` bucket (the caller
 *   labels it; the raw id stays null). When a non-null id joins to no name, the
 *   caller falls back to the id, never to the `Unmapped` label.
 * - Reversal lines are negated rows (`reverse-sales-line.ts`), so a plain sum
 *   nets them without a special case.
 * - `ingredientCost` is the moving-average value actually posted to the stock
 *   ledger for the line (`stock_movement.source_type = 'sales_line'`,
 *   `source_id = sales_line.id`, `value_delta` sign-corrected); `0` when no
 *   consumption was posted.
 *
 * `transactions` is returned as a decimal string (never a bare `::int`; the repo
 * returns counts as text and the adapter converts safely); the window-level
 * distinct count is computed ungrouped by `countSalesTransactions` so a
 * transaction spanning several groups is counted once, not once per group.
 */

/** The reporting grains (`DEC-032`); the runtime authority is the domain. */
export type SalesReportGrain = "day" | "week" | "month";

/** The dimensions a sales report groups by (`RPT-001`). */
export type SalesReportGroupBy = "location" | "channel" | "category" | "product" | "period";

/** The filters a sales report read shares. */
export interface SalesReportFilters {
  readonly organizationId: string;
  /** Inclusive lower bound on `sales_transaction.occurred_at`; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound on `sales_transaction.occurred_at`; an ISO instant. */
  readonly to: string;
  readonly grain: SalesReportGrain;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[];
  readonly channelId?: string;
  readonly category?: string;
  readonly productVariantId?: string;
}

export interface SummarizeSalesQuery extends SalesReportFilters {
  readonly groupBy: SalesReportGroupBy;
}

/** One aggregated group row; the dimension fields not grouped on are null. */
export interface SalesGroupAggregate {
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly productName: string | null;
  /** `product.product_kind`; a `product` group only, null otherwise. */
  readonly productKind: string | null;
  /** Distinct `sales_line.option_kind` values; a `product` group only, null otherwise. */
  readonly optionKinds: readonly string[] | null;
  readonly periodBucket: string;
  /** Distinct transactions in the group; a count as text (see the module header). */
  readonly transactions: string;
  readonly units: string;
  readonly grossSales: string;
  readonly netSales: string;
  readonly taxAmount: string;
  readonly discountAmount: string;
  readonly refundAmount: string;
  readonly ingredientCost: string;
}

export interface ListSalesLineRecordsQuery extends SalesReportFilters {
  readonly limit: number;
  readonly offset: number;
}

/** One drill-down sales line (`RPT-002`); money columns stay nullable as stored. */
export interface SalesLineRow {
  readonly id: string;
  readonly salesTransactionId: string;
  /** `timestamptz`, ISO. */
  readonly occurredAt: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly sku: string | null;
  readonly externalProductRef: string | null;
  readonly externalLineId: string | null;
  readonly optionKind: string;
  readonly quantity: string;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly ingredientCost: string;
  readonly reversalOfId: string | null;
}

/**
 * The grain bucket of an instant, matching the domain `periodBucket`: `day` ⇒
 * `YYYY-MM-DD`, `week` ⇒ ISO-8601 `YYYY-Www`, `month` ⇒ `YYYY-MM`, all UTC. The
 * `to_char` format is a literal inside the template (never a bind parameter) so
 * the expression renders identically in the SELECT and the GROUP BY — a
 * re-encoded parameter would not match and Postgres would reject the group.
 */
function bucketExpression(instant: SQL, grain: SalesReportGrain): SQL<string> {
  switch (grain) {
    case "day":
      return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
    case "week":
      return sql<string>`to_char(${instant} at time zone 'UTC', 'IYYY-"W"IW')`;
    case "month":
      return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM')`;
    default:
      throw new Error(`unknown sales report grain "${String(grain)}"`);
  }
}

/** `sales_line`'s channel, falling back to the transaction's (`DEC-045`). */
function channelExpression(): SQL<string | null> {
  return sql<string | null>`coalesce(${salesLine.channelId}, ${salesTransaction.channelId})`;
}

/**
 * The resolved product-variant id of a sales line: `product_variant_id` when the
 * importer wrote it, else the variant whose SKU matches the line's (org-scoped,
 * index `sales_line (organization_id, sku)`), else the effective
 * `external_mapping` for the transaction's source, else `null` (the `unmapped`
 * bucket). See the module header (`DEC-108` item 5, `DEC-109` item 4).
 *
 * The external fallback matches the mapper's own keys (`sku` then `external_id`,
 * `DEC-041`) and requires `internal_entity_type = 'product_variant'` so the id
 * is joined as a variant, not an item/channel. `external_mapping.entity_type`
 * and `internal_entity_type` are unconstrained free text (schema open point),
 * so the internal type is the guard; the effective window is half-open.
 *
 * ponytail: this is a correlated subquery per line, so the planner does extra
 * work rather than using a materialized mapping (declined here — no migration
 * and no aggregate, `ADR-0004`/`ADR-0007`); the upgrade path is a resolved
 * variant column written by the mapping step, or an indexed mapping lookup.
 */
function resolvedVariantIdExpression(): SQL<string | null> {
  return sql<string | null>`coalesce(
    ${salesLine.productVariantId},
    (
      select pv."id"
      from "product_variant" pv
      where pv."organization_id" = ${salesLine.organizationId}
        and ${salesLine.sku} is not null
        and pv."sku" = ${salesLine.sku}
      limit 1
    ),
    (
      select em."internal_entity_id"
      from "external_mapping" em
      where em."organization_id" = ${salesLine.organizationId}
        and em."source_system" = ${salesTransaction.sourceSystem}
        and em."internal_entity_type" = 'product_variant'
        and (
          (em."sku" is not null and em."sku" = ${salesLine.sku})
          or (em."external_id" = ${salesLine.externalProductRef})
        )
        and em."effective_from" <= ${salesTransaction.occurredAt}
        and (em."effective_to" is null or em."effective_to" > ${salesTransaction.occurredAt})
      order by em."effective_from" desc
      limit 1
    )
  )`;
}

/**
 * The shared `WHERE` predicates: org scope on both sides (`DEC-061`), the
 * inclusive `occurred_at` window, the `SALE-011` included-line exclusion and the
 * optional dimension filters. The category and product-variant filters use the
 * **resolved** variant chain (via the `product` join), so they agree with the
 * group-by. Callers that apply the category/variant filters must join
 * `product_variant` (on {@link resolvedVariantIdExpression}) and `product`.
 */
function filterConditions(query: SalesReportFilters): SQL[] {
  const conditions: SQL[] = [
    eq(salesLine.organizationId, query.organizationId),
    eq(salesTransaction.organizationId, query.organizationId),
    ne(salesLine.optionKind, "included"),
    gte(salesTransaction.occurredAt, new Date(query.from)),
    lte(salesTransaction.occurredAt, new Date(query.to)),
  ];
  if (query.locationIds !== undefined && query.locationIds.length > 0) {
    conditions.push(inArray(salesTransaction.locationId, [...query.locationIds]));
  }
  if (query.channelId !== undefined) {
    conditions.push(eq(channelExpression(), query.channelId));
  }
  if (query.category !== undefined) {
    conditions.push(eq(product.category, query.category));
  }
  if (query.productVariantId !== undefined) {
    conditions.push(eq(resolvedVariantIdExpression(), query.productVariantId));
  }
  return conditions;
}

/**
 * The ledger value posted for one `sales_line`, as a correlated scalar
 * subquery: the moving-average `value_delta` of its `sales_line`-sourced stock
 * movements, summed across components and sign-corrected (a consumption delta
 * is negative, so `-sum` is the cost). `0` when nothing was posted. The
 * correlated form mirrors `listWorkedHoursAssignments`'s latest-adjustment
 * subquery and avoids a CTE; `stock_movement_source_idx` covers it.
 */
function lineCostExpression(): SQL<string> {
  return sql<string>`(
    select coalesce(-sum(sm."value_delta"), 0)
    from "stock_movement" sm
    where sm."organization_id" = ${salesLine.organizationId}
      and sm."source_type" = 'sales_line'
      and sm."source_id" = ${salesLine.id}
  )`;
}

/**
 * Groups the window's sales lines by one dimension (`RPT-001`) and returns the
 * raw measures as decimal strings, one row per group key. `period` groups by the
 * grain bucket of `occurred_at`; every other dimension groups by its column and
 * carries the window-start bucket, so a row's `periodBucket` always names the
 * period the report covers.
 */
export async function summarizeSales(
  db: Database,
  query: SummarizeSalesQuery,
): Promise<readonly SalesGroupAggregate[]> {
  const transactionBucket = bucketExpression(sql`${salesTransaction.occurredAt}`, query.grain);
  const windowBucket = bucketExpression(sql`${new Date(query.from)}::timestamptz`, query.grain);
  const lineCost = lineCostExpression();

  const dimension = ((): {
    readonly select: Record<string, SQL | undefined>;
    readonly group: SQL[];
    readonly order: SQL[];
  } => {
    switch (query.groupBy) {
      case "location":
        return {
          select: {
            locationId: sql<string | null>`${salesTransaction.locationId}::text`,
            locationName: sql<string | null>`${location.name}`,
          },
          group: [sql`${salesTransaction.locationId}`, sql`${location.name}`],
          order: [sql`${location.name}`, sql`${salesTransaction.locationId}`],
        };
      case "channel":
        return {
          select: {
            channelId: sql<string | null>`${channelExpression()}::text`,
            channelName: sql<string | null>`${channel.name}`,
          },
          group: [channelExpression(), sql`${channel.name}`],
          order: [sql`${channel.name}`, channelExpression()],
        };
      case "category":
        return {
          select: { category: sql<string | null>`${product.category}` },
          group: [sql`${product.category}`],
          order: [sql`${product.category}`],
        };
      case "product":
        return {
          select: {
            productVariantId: sql<string | null>`${resolvedVariantIdExpression()}::text`,
            productName: sql<string | null>`${productVariant.name}`,
            category: sql<string | null>`${product.category}`,
            productKind: sql<string | null>`${product.productKind}`,
            optionKinds: sql<
              readonly string[] | null
            >`array_agg(distinct ${salesLine.optionKind} order by ${salesLine.optionKind})`,
          },
          // The product's own category/product_kind are constant per variant
          // (the variant belongs to one product), but PostgreSQL does not infer
          // that from the coalesce expression grouped on, so they join the
          // GROUP BY explicitly and add no extra groups.
          group: [
            resolvedVariantIdExpression(),
            sql`${productVariant.name}`,
            sql`${product.category}`,
            sql`${product.productKind}`,
          ],
          order: [sql`${productVariant.name}`, resolvedVariantIdExpression()],
        };
      case "period":
        return {
          select: { periodBucket: sql<string>`${transactionBucket}` },
          group: [transactionBucket],
          order: [transactionBucket],
        };
      default:
        throw new Error(`unknown sales report groupBy "${String(query.groupBy)}"`);
    }
  })();

  const rows = await db
    .select({
      locationId: dimension.select["locationId"] ?? sql<string | null>`null`,
      locationName: dimension.select["locationName"] ?? sql<string | null>`null`,
      channelId: dimension.select["channelId"] ?? sql<string | null>`null`,
      channelName: dimension.select["channelName"] ?? sql<string | null>`null`,
      category: dimension.select["category"] ?? sql<string | null>`null`,
      productVariantId: dimension.select["productVariantId"] ?? sql<string | null>`null`,
      productName: dimension.select["productName"] ?? sql<string | null>`null`,
      productKind: dimension.select["productKind"] ?? sql<string | null>`null`,
      optionKinds: dimension.select["optionKinds"] ?? sql<readonly string[] | null>`null`,
      periodBucket: dimension.select["periodBucket"] ?? windowBucket,
      transactions: sql<string>`count(distinct ${salesTransaction.id})::text`,
      units: sql<string>`sum(${salesLine.quantity})::text`,
      grossSales: sql<string>`sum(coalesce(${salesLine.grossAmount}, 0))::text`,
      // SQL `coalesce` collapses a NULL `net_amount` only; the domain
      // `netSalesFromLine` also treats a blank as absent. A `numeric` column
      // cannot hold a blank, so the two agree on all stored data.
      netSales: sql<string>`sum(coalesce(${salesLine.netAmount}, coalesce(${salesLine.grossAmount}, 0) - coalesce(${salesLine.taxAmount}, 0) - coalesce(${salesLine.discountAmount}, 0) - coalesce(${salesLine.refundAmount}, 0)))::text`,
      taxAmount: sql<string>`sum(coalesce(${salesLine.taxAmount}, 0))::text`,
      discountAmount: sql<string>`sum(coalesce(${salesLine.discountAmount}, 0))::text`,
      refundAmount: sql<string>`sum(coalesce(${salesLine.refundAmount}, 0))::text`,
      ingredientCost: sql<string>`sum(${lineCost})::text`,
    })
    .from(salesLine)
    .innerJoin(salesTransaction, eq(salesLine.salesTransactionId, salesTransaction.id))
    .leftJoin(location, eq(salesTransaction.locationId, location.id))
    .leftJoin(productVariant, eq(resolvedVariantIdExpression(), productVariant.id))
    .leftJoin(product, eq(productVariant.productId, product.id))
    .leftJoin(channel, eq(channelExpression(), channel.id))
    .where(and(...filterConditions(query)))
    .groupBy(...dimension.group)
    .orderBy(...dimension.order);

  return rows as readonly SalesGroupAggregate[];
}

/**
 * The window-level distinct transaction count (`F2`): one un-grouped
 * `count(distinct sales_transaction.id)` over the same filtered line set, so a
 * transaction that spans several groups is counted **once**. A grouped
 * `count(distinct ...)` cannot be summed into this (a transaction appears in each
 * of its groups), and PostgreSQL does not implement `DISTINCT` in window
 * functions, so this is a second, deliberately un-grouped query. It carries the
 * category/variant joins because `filterConditions` may reference them.
 */
export async function countSalesTransactions(
  db: Database,
  query: SalesReportFilters,
): Promise<string> {
  const rows = await db
    .select({ count: sql<string>`count(distinct ${salesTransaction.id})::text` })
    .from(salesLine)
    .innerJoin(salesTransaction, eq(salesLine.salesTransactionId, salesTransaction.id))
    .leftJoin(productVariant, eq(resolvedVariantIdExpression(), productVariant.id))
    .leftJoin(product, eq(productVariant.productId, product.id))
    .where(and(...filterConditions(query)));

  return rows[0]?.count ?? "0";
}

export interface SalesLineRecordPage {
  readonly rows: readonly SalesLineRow[];
  readonly truncated: boolean;
}

/**
 * The drill-down page (`RPT-002`): one row per sales line in the window, oldest
 * first (`occurred_at`, then id), with the same filters and resolved-variant
 * joins as `summarizeSales` and the line's ledger `ingredientCost`. Fetches one
 * row past `limit` so `truncated` is a conservative "more may exist" flag, never
 * a silent short page. The `SALE-011` included-line exclusion is applied here
 * too (the same `filterConditions`), so the drill-down shows only the lines the
 * summary measures.
 */
export async function listSalesLineRecords(
  db: Database,
  query: ListSalesLineRecordsQuery,
): Promise<SalesLineRecordPage> {
  const rows = await db
    .select({
      id: salesLine.id,
      salesTransactionId: salesLine.salesTransactionId,
      occurredAt: salesTransaction.occurredAt,
      locationId: salesTransaction.locationId,
      channelId: channelExpression(),
      category: product.category,
      productVariantId: sql<string | null>`${resolvedVariantIdExpression()}::text`,
      sku: salesLine.sku,
      externalProductRef: salesLine.externalProductRef,
      externalLineId: salesLine.externalLineId,
      optionKind: salesLine.optionKind,
      quantity: salesLine.quantity,
      grossAmount: salesLine.grossAmount,
      netAmount: salesLine.netAmount,
      taxAmount: salesLine.taxAmount,
      discountAmount: salesLine.discountAmount,
      refundAmount: salesLine.refundAmount,
      ingredientCost: lineCostExpression(),
      reversalOfId: salesLine.reversalOfId,
    })
    .from(salesLine)
    .innerJoin(salesTransaction, eq(salesLine.salesTransactionId, salesTransaction.id))
    .leftJoin(productVariant, eq(resolvedVariantIdExpression(), productVariant.id))
    .leftJoin(product, eq(productVariant.productId, product.id))
    .where(and(...filterConditions(query)))
    .orderBy(asc(salesTransaction.occurredAt), asc(salesLine.id))
    .limit(query.limit + 1)
    .offset(query.offset);

  const truncated = rows.length > query.limit;
  const page = truncated ? rows.slice(0, query.limit) : rows;
  return {
    rows: page.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    })),
    truncated,
  };
}

/** The filters a waste-by-product read shares. */
export interface WasteByProductVariantFilters {
  readonly organizationId: string;
  /** Inclusive lower bound on `waste_event.occurred_at`; an ISO instant. */
  readonly from: string;
  /** Inclusive upper bound on `waste_event.occurred_at`; an ISO instant. */
  readonly to: string;
  /** Empty/undefined = organization-wide (the repo convention). */
  readonly locationIds?: readonly string[];
}

/** One variant's summed waste over the window (`RPT-005`, `DEC-109` item 5). */
export interface WasteByProductVariantAggregate {
  readonly productVariantId: string;
  readonly quantity: string;
  /** The sum of valued events; SQL null when no event carried a value. */
  readonly value: string | null;
}

/**
 * The window's waste by product variant (`RPT-005`, `DEC-109` item 5): one row
 * per `waste_event.product_variant_id`, org- and location-scoped, over the
 * inclusive `occurred_at` window. An item-only waste event has a null variant
 * and is deliberately excluded — no item→product attribution rule exists, so
 * the annotation is joined only where the event names a variant.
 *
 * The quantity is summed across the variant's events **unit-blind**: the events
 * may carry different `unit_id`s, and no decision defines a normalisation, so
 * the sum is a recorded ceiling. ponytail: the ceiling is a unit-aware grouping
 * (`group by product_variant_id, unit_id`) or a conversion via the unit graph
 * once a rule exists. The value is summed over the events that carry one;
 * `null` when none did (never a silent 0 that reads as "valued at zero").
 *
 * **`DEC-068`.** `value` is the ledger's moving weighted average and is the only
 * implemented valuation (`value_method = 'moving_average'`); `cost_selection`,
 * `latest_price` and `manual` remain unimplemented, so their `value` is
 * excluded here rather than blended into the figure. `value_method` and a
 * contradicting `value` on the ledger entry stay a recorded ceiling (the
 * repository does not cross-check the two). `waste_event.currency` is not
 * cross-checked against the report's hard-coded `NOK` either — no multi-currency
 * decision exists yet.
 */
export async function sumWasteByProductVariant(
  db: Database,
  query: WasteByProductVariantFilters,
): Promise<readonly WasteByProductVariantAggregate[]> {
  const conditions: SQL[] = [
    eq(wasteEvent.organizationId, query.organizationId),
    // DEC-068: only moving_average valuation is implemented; summing another
    // method's `value` would blend an unimplemented valuation into the report.
    eq(wasteEvent.valueMethod, "moving_average"),
    isNotNull(wasteEvent.productVariantId),
    gte(wasteEvent.occurredAt, new Date(query.from)),
    lte(wasteEvent.occurredAt, new Date(query.to)),
  ];
  if (query.locationIds !== undefined && query.locationIds.length > 0) {
    conditions.push(inArray(wasteEvent.locationId, [...query.locationIds]));
  }

  const rows = await db
    .select({
      productVariantId: sql<string>`${wasteEvent.productVariantId}::text`,
      quantity: sql<string>`sum(${wasteEvent.quantity})::text`,
      value: sql<string | null>`sum(${wasteEvent.value})::text`,
    })
    .from(wasteEvent)
    .where(and(...conditions))
    .groupBy(wasteEvent.productVariantId)
    .orderBy(asc(wasteEvent.productVariantId));

  return rows as readonly WasteByProductVariantAggregate[];
}
