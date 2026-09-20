import type { SalesLineRecord, SalesTransactionRecord } from "@aquarela/application";

/**
 * Pure query/body parsing and response mapping for the row-12 sales routes.
 * Kept free of Next, DB and I/O imports so it can be unit-tested directly; the
 * routes do the reads and hand the resolved reference records (location/channel
 * labels, line counts) to the row mappers.
 *
 * Recorded row-12 open points that shape these helpers — deliberately **not**
 * resolved (the full list is in `packages/persistence/src/schema/sales.ts`):
 * (A1) the sales/consumption grain ambiguity (`DEC-009` daily-per-location vs a
 *      single `sales_line` `source_id`): a sales line has no location, so a
 *      transaction row carries the header's location and `lineCount` only;
 * (A4) `tax_code_id` vs `tax_rule_id` naming and the `applied_tax_rate`
 *      authority: the line row exposes `taxRuleId` and the captured
 *      `appliedTaxRate` verbatim, never re-deriving the rate (`DEC-045`);
 * (DEC-028) sales-line reversal is not implemented, so `reversalOfId` is
 *      surfaced as a stored fact and no reversal is offered;
 * the normalized staging-row shape is owned by row 11 (`NORMALIZED_SALES_FIELDS`)
 * and is only read by `postImportRun`, never by the web layer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;

/** Page size when the caller does not ask for one; mirrors the application default. */
const DEFAULT_LIMIT = 50;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function readPositiveInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

function readOptionalUuid(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && isUuid(value) ? value : "invalid";
}

function readOptionalQueryText(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= MAX_TEXT ? value : "invalid";
}

/* ------------------------------- list query ------------------------------- */

export interface SalesTransactionListQuery {
  readonly sourceSystem?: string;
  readonly locationId?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedSalesTransactionListQuery =
  { readonly ok: true; readonly query: SalesTransactionListQuery } | { readonly ok: false };

/** Parses the optional source/location filters and `limit`/`offset` paging. */
export function parseSalesTransactionListQuery(
  searchParams: URLSearchParams,
): ParsedSalesTransactionListQuery {
  const locationId = readOptionalUuid(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const sourceSystem = readOptionalQueryText(searchParams, "sourceSystem");
  if (sourceSystem === "invalid") {
    return { ok: false };
  }
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(sourceSystem === undefined ? {} : { sourceSystem }),
      ...(locationId === undefined ? {} : { locationId }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Optional free text: absent/null/blank → null; wrong type or over-long → invalid. */
function readOptionalBodyText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || value.length > max) {
    return { ok: false };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

export type ParsedPostImportRun =
  { readonly ok: true; readonly sourceSystem: string | null } | { readonly ok: false };

/**
 * `POST /import-runs/[id]/post` body: the optional `sales_transaction.source_system`
 * override. Absent means the run's own `source` label is used by the command;
 * there is no source-system column on `import_run` (recorded row-11 point).
 */
export function parsePostImportRunBody(
  body: Record<string, unknown> | undefined,
): ParsedPostImportRun {
  const sourceSystem = readOptionalBodyText(body ?? {}, "sourceSystem", 64);
  return sourceSystem.ok ? { ok: true, sourceSystem: sourceSystem.value } : { ok: false };
}

export interface PostTheoreticalConsumptionBody {
  readonly locationId: string;
  /** `yyyy-mm-dd`. */
  readonly occurredOn: string;
  /**
   * The storage area the components are drawn from. There is no WIP/source-draw
   * policy (recorded open point), so the caller supplies it.
   */
  readonly storageAreaId: string;
  readonly idempotencyKey: string | null;
  readonly allowNegativeOverride: boolean;
}

export type ParsedPostTheoreticalConsumption =
  { readonly ok: true; readonly input: PostTheoreticalConsumptionBody } | { readonly ok: false };

/**
 * `POST /consumption` body: the location, the business day and the draw storage
 * area. Shape/range only — the command re-checks the location/area, that the
 * area belongs to the location, and the ledger's stock rules.
 */
export function parsePostTheoreticalConsumptionBody(
  body: Record<string, unknown> | undefined,
): ParsedPostTheoreticalConsumption {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const storageAreaId = readText(body, "storageAreaId", 64);
  if (
    locationId === null ||
    !isUuid(locationId) ||
    storageAreaId === null ||
    !isUuid(storageAreaId)
  ) {
    return { ok: false };
  }
  const occurredOn = readText(body, "occurredOn", 32);
  if (occurredOn === null || !ISO_DATE.test(occurredOn)) {
    return { ok: false };
  }
  const idempotencyKey = readOptionalBodyText(body, "idempotencyKey");
  if (!idempotencyKey.ok) {
    return { ok: false };
  }
  const rawOverride = body.allowNegativeOverride;
  if (rawOverride !== undefined && typeof rawOverride !== "boolean") {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      locationId,
      occurredOn,
      storageAreaId,
      idempotencyKey: idempotencyKey.value,
      allowNegativeOverride: rawOverride === true,
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

/** A resolved display label (location/channel) for a transaction row. */
export interface SalesRefRecord {
  readonly code: string;
  readonly name: string;
}

export interface SalesRefs {
  readonly locations: ReadonlyMap<string, SalesRefRecord>;
  readonly channels: ReadonlyMap<string, SalesRefRecord>;
}

export const EMPTY_SALES_REFS: SalesRefs = { locations: new Map(), channels: new Map() };

export interface SalesTransactionRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly sourceSystem: string;
  readonly externalTransactionId: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly channelId: string | null;
  readonly channelCode: string | null;
  readonly channelName: string | null;
  readonly currency: string;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly lineCount: number;
  readonly importRunId: string | null;
}

/**
 * Maps transaction headers to HTTP rows, dropping any foreign-organization row
 * and resolving location/channel labels from the caller's org-checked refs.
 * `lineCounts` is the caller's per-transaction `sales_line` count (the header
 * carries no line count).
 */
export function toSalesTransactionRows(
  organizationId: string,
  transactions: readonly SalesTransactionRecord[],
  refs: SalesRefs,
  lineCounts: ReadonlyMap<string, number> = new Map(),
): readonly SalesTransactionRow[] {
  const rows: SalesTransactionRow[] = [];
  for (const transaction of transactions) {
    if (transaction.organizationId !== organizationId) {
      continue;
    }
    const location =
      transaction.locationId === null ? undefined : refs.locations.get(transaction.locationId);
    const channel =
      transaction.channelId === null ? undefined : refs.channels.get(transaction.channelId);
    rows.push({
      id: transaction.id,
      occurredAt: transaction.occurredAt,
      sourceSystem: transaction.sourceSystem,
      externalTransactionId: transaction.externalTransactionId,
      locationId: transaction.locationId,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      channelId: transaction.channelId,
      channelCode: channel?.code ?? null,
      channelName: channel?.name ?? null,
      currency: transaction.currency,
      grossAmount: transaction.grossAmount,
      netAmount: transaction.netAmount,
      taxAmount: transaction.taxAmount,
      discountAmount: transaction.discountAmount,
      refundAmount: transaction.refundAmount,
      lineCount: lineCounts.get(transaction.id) ?? 0,
      importRunId: transaction.importRunId,
    });
  }
  return rows;
}

export interface SalesLineRow {
  readonly id: string;
  readonly sku: string | null;
  readonly externalProductRef: string | null;
  readonly externalLineId: string | null;
  readonly productVariantId: string | null;
  readonly quantity: string;
  readonly unitPrice: string | null;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  /** numeric(9,6), captured verbatim (`DEC-045`); never re-derived. */
  readonly appliedTaxRate: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  /** `DEC-043` standalone/attached/included. */
  readonly optionKind: string;
  readonly mappingState: string;
  readonly parentLineId: string | null;
  readonly taxRuleId: string | null;
  readonly channelId: string | null;
  /** `DEC-028` reversal self-reference; reversal posting is not implemented. */
  readonly reversalOfId: string | null;
}

/** Maps sales lines to HTTP rows, dropping any foreign-organization line. */
export function toSalesLineRows(
  organizationId: string,
  lines: readonly SalesLineRecord[],
): readonly SalesLineRow[] {
  const rows: SalesLineRow[] = [];
  for (const line of lines) {
    if (line.organizationId !== organizationId) {
      continue;
    }
    rows.push({
      id: line.id,
      sku: line.sku,
      externalProductRef: line.externalProductRef,
      externalLineId: line.externalLineId,
      productVariantId: line.productVariantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      grossAmount: line.grossAmount,
      netAmount: line.netAmount,
      taxAmount: line.taxAmount,
      appliedTaxRate: line.appliedTaxRate,
      discountAmount: line.discountAmount,
      refundAmount: line.refundAmount,
      optionKind: line.optionKind,
      mappingState: line.mappingState,
      parentLineId: line.parentLineId,
      taxRuleId: line.taxRuleId,
      channelId: line.channelId,
      reversalOfId: line.reversalOfId,
    });
  }
  return rows;
}
