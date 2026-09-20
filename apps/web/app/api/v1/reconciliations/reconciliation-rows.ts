import type { ReconciliationRecord } from "@aquarela/application";
import { MONEY_SCALE, parseDecimal } from "@aquarela/domain";
import { RECONCILIATION_STATUS } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the row-12 reconciliation
 * routes. Kept free of Next, DB and I/O imports so it can be unit-tested
 * directly; the routes do the reads and hand the resolved records to the mapper.
 *
 * Recorded row-12 open points that shape these helpers — deliberately **not**
 * resolved (the full list is in `packages/persistence/src/schema/sales.ts` and
 * `packages/application/src/reconciliation/types.ts`):
 * (b) there is **no tolerance-configuration table** (`DEC-026`'s effective-dated
 *     FIN-owned config), so the body carries an explicit `tolerance` or an
 *     explicit `useDecisionDefaultTolerance` opt-in; a missing tolerance is
 *     never applied silently;
 * (i) there is no `settlement_status` vocabulary, so the settlement status is
 *     stored facts only;
 * (j) `reconciliation.scope_type` values are unresolved; the body accepts free
 *     text and the command writes the labels it owns (`import_run`,
 *     `settlement`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_NOTE = 2000;

/** Mirrors the application default page size. */
const DEFAULT_LIMIT = 50;

const STATUSES: readonly string[] = RECONCILIATION_STATUS;

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

/** A non-negative decimal at money scale, or null when the string is unusable. */
function readTolerance(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }
  try {
    return parseDecimal(value, MONEY_SCALE) < 0n ? null : value;
  } catch {
    return null;
  }
}

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

function readOptionalUuidBody(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length === 0
    ? { ok: true, value: null }
    : isUuid(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false };
}

function readOptionalDateBody(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length === 0
    ? { ok: true, value: null }
    : ISO_DATE.test(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false };
}

/** The tolerance/owner/due-date options shared by both reconcile commands. */
interface ReconcileOptions {
  readonly scopeType: string | null;
  readonly tolerance: string | null;
  readonly useDecisionDefaultTolerance: boolean;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
}

type ParsedReconcileOptions =
  { readonly ok: true; readonly options: ReconcileOptions } | { readonly ok: false };

function parseReconcileOptions(body: Record<string, unknown>): ParsedReconcileOptions {
  const scopeType = readOptionalBodyText(body, "scopeType");
  const ownerId = readOptionalUuidBody(body, "ownerId");
  const dueDate = readOptionalDateBody(body, "dueDate");
  if (!scopeType.ok || !ownerId.ok || !dueDate.ok) {
    return { ok: false };
  }

  let tolerance: string | null = null;
  const rawTolerance = body.tolerance;
  if (rawTolerance !== undefined && rawTolerance !== null) {
    tolerance = readTolerance(rawTolerance);
    if (tolerance === null) {
      return { ok: false };
    }
  }

  const rawDefault = body.useDecisionDefaultTolerance;
  if (rawDefault !== undefined && typeof rawDefault !== "boolean") {
    return { ok: false };
  }
  if (tolerance === null && rawDefault !== true) {
    // Never default silently (open point (b)): one of the two must be supplied.
    return { ok: false };
  }

  return {
    ok: true,
    options: {
      scopeType: scopeType.value,
      tolerance,
      useDecisionDefaultTolerance: rawDefault === true,
      ownerId: ownerId.value,
      dueDate: dueDate.value,
    },
  };
}

/* ------------------------------- list query ------------------------------- */

export interface ReconciliationListQuery {
  readonly status?: string;
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedReconciliationListQuery =
  { readonly ok: true; readonly query: ReconciliationListQuery } | { readonly ok: false };

/** Parses the optional status/scope filters and `limit`/`offset` paging. */
export function parseReconciliationListQuery(
  searchParams: URLSearchParams,
): ParsedReconciliationListQuery {
  const scopeId = readOptionalUuid(searchParams, "scopeId");
  if (scopeId === "invalid") {
    return { ok: false };
  }
  const scopeType = readOptionalQueryText(searchParams, "scopeType");
  if (scopeType === "invalid") {
    return { ok: false };
  }

  const rawStatus = searchParams.get("status");
  let status: string | undefined;
  if (rawStatus !== null) {
    const value = rawStatus.trim();
    if (!STATUSES.includes(value)) {
      return { ok: false };
    }
    status = value;
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
      ...(status === undefined ? {} : { status }),
      ...(scopeType === undefined ? {} : { scopeType }),
      ...(scopeId === undefined ? {} : { scopeId }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface ReconcileImportRunBody {
  readonly scopeType: string | null;
  readonly tolerance: string | null;
  readonly useDecisionDefaultTolerance: boolean;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
}

export type ParsedReconcileImportRun =
  { readonly ok: true; readonly input: ReconcileImportRunBody } | { readonly ok: false };

/** `POST /import-runs/[id]` body: the tolerance choice and optional owner/due date. */
export function parseReconcileImportRunBody(
  body: Record<string, unknown> | undefined,
): ParsedReconcileImportRun {
  const parsed = parseReconcileOptions(body ?? {});
  return parsed.ok ? { ok: true, input: parsed.options } : { ok: false };
}

export interface ReconcileSettlementBody extends ReconcileImportRunBody {
  readonly settlementId: string;
}

export type ParsedReconcileSettlement =
  { readonly ok: true; readonly input: ReconcileSettlementBody } | { readonly ok: false };

/** `POST /settlements` body: the settlement id plus the same tolerance options. */
export function parseReconcileSettlementBody(
  body: Record<string, unknown> | undefined,
): ParsedReconcileSettlement {
  if (body === undefined) {
    return { ok: false };
  }
  const settlementId = typeof body.settlementId === "string" ? body.settlementId.trim() : null;
  if (settlementId === null || !isUuid(settlementId)) {
    return { ok: false };
  }
  const parsed = parseReconcileOptions(body);
  return parsed.ok ? { ok: true, input: { settlementId, ...parsed.options } } : { ok: false };
}

export interface ResolveReconciliationBody {
  readonly status: string;
  readonly resolutionNote: string | null;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
}

export type ParsedResolveReconciliation =
  { readonly ok: true; readonly input: ResolveReconciliationBody } | { readonly ok: false };

/**
 * `POST /[id]/resolve` body: the target status, the note (required by the
 * command for `resolved`/`approved`) and the optional owner/due date.
 */
export function parseResolveReconciliationBody(
  body: Record<string, unknown> | undefined,
): ParsedResolveReconciliation {
  if (body === undefined) {
    return { ok: false };
  }
  const rawStatus = body.status;
  if (typeof rawStatus !== "string" || !STATUSES.includes(rawStatus.trim())) {
    return { ok: false };
  }
  const resolutionNote = readOptionalBodyText(body, "resolutionNote", MAX_NOTE);
  const ownerId = readOptionalUuidBody(body, "ownerId");
  const dueDate = readOptionalDateBody(body, "dueDate");
  if (!resolutionNote.ok || !ownerId.ok || !dueDate.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      status: rawStatus.trim(),
      resolutionNote: resolutionNote.value,
      ownerId: ownerId.value,
      dueDate: dueDate.value,
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface ReconciliationRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly expectedAmount: string;
  readonly actualAmount: string;
  readonly tolerance: string;
  readonly difference: string;
  readonly status: string;
  readonly resolutionNote: string | null;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps reconciliation rows to HTTP rows, dropping any foreign-organization row. */
export function toReconciliationRows(
  organizationId: string,
  reconciliations: readonly ReconciliationRecord[],
): readonly ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];
  for (const record of reconciliations) {
    if (record.organizationId !== organizationId) {
      continue;
    }
    rows.push({
      id: record.id,
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      expectedAmount: record.expectedAmount,
      actualAmount: record.actualAmount,
      tolerance: record.tolerance,
      difference: record.difference,
      status: record.status,
      resolutionNote: record.resolutionNote,
      ownerId: record.ownerId,
      dueDate: record.dueDate,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
  return rows;
}
