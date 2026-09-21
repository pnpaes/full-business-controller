import type {
  ImportRunPreview,
  ImportRunSummary,
  ImportStagingRowRecord,
  ImportValidationRules,
  MoneyTotals,
  StageImportRowInput,
} from "@aquarela/application";
import {
  IMPORT_DISPOSITIONS,
  IMPORT_POSTING_POLICY,
  IMPORT_STATUS,
  type ImportDispositionKind,
} from "@aquarela/application";

/**
 * Pure query/body parsing and response mapping for the import routes (slice 11,
 * `SALE-002`/`SALE-004`/`SALE-007`/`SALE-008`). Kept free of Next, DB and I/O
 * imports so it can be unit-tested directly; the routes do the reads and hand
 * the application results to the row mappers.
 *
 * Recorded, not resolved (no posting action is exposed here — posting is row 12,
 * owner-gated on `ADR-0008`):
 * - `fileObjectId` is a real FK to `file_object` (`DEC-085`, migration `0035`)
 *   but is never dereferenced here;
 * - `profileVersion` is **optional** (`DEC-081`): the run resolves its
 *   `import_profile` by source and takes the profile's version, so a caller
 *   value must match it (or be omitted); a source with no profile still needs
 *   one, and the run's profile — not the caller — supplies the base validation
 *   rules there;
 * - the posting policy is carried by the run's `import_profile` (`DEC-081`,
 *   falling back to the `DEC-025` default `allow_partial` when the source has
 *   no profile); it is still recorded in the run's `diagnostics` at create
 *   time;
 * - there is no tolerance configuration table, so no amount tolerance is applied
 *   or invented here (`DEC-026`/`DEC-035`); the preview residual is reported for
 *   visibility only.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_TEXT = 200;
const MAX_ROWS = 2000;
const MAX_RULE_FIELDS = 50;

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

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

/** Optional boolean: absent → false; wrong type → invalid. */
function readOptionalBoolean(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: boolean | undefined } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "boolean") {
    return { ok: false };
  }
  return { ok: true, value };
}

/** Optional string list: absent → undefined; a non-string entry or over-long field → invalid. */
function readOptionalTextList(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: readonly string[] | undefined } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > MAX_RULE_FIELDS) {
    return { ok: false };
  }
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { ok: false };
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT) {
      return { ok: false };
    }
    list.push(trimmed);
  }
  return { ok: true, value: list };
}

/* ------------------------------- list query ------------------------------- */

export interface ImportRunListQuery {
  readonly source?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedImportRunListQuery =
  { readonly ok: true; readonly query: ImportRunListQuery } | { readonly ok: false };

/** Parses the optional source/status filters and `limit`/`offset` paging. */
export function parseImportRunListQuery(searchParams: URLSearchParams): ParsedImportRunListQuery {
  const source = readOptionalQueryText(searchParams, "source");
  if (source === "invalid") {
    return { ok: false };
  }

  const rawStatus = searchParams.get("status");
  let status: string | undefined;
  if (rawStatus !== null) {
    const value = rawStatus.trim();
    if (!IMPORT_STATUS.includes(value)) {
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
      ...(source === undefined ? {} : { source }),
      ...(status === undefined ? {} : { status }),
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateImportRunBody {
  readonly source: string;
  /**
   * Optional (`DEC-081`): when the source has an `import_profile` the run takes
   * the profile's version, so a caller value must match it or be omitted; with
   * no profile the command requires one (`null` here is then a 400).
   */
  readonly profileVersion: string | null;
  readonly fileHash: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly fileObjectId: string | null;
  /** One of `IMPORT_POSTING_POLICY`, or null to take the `DEC-025` default. */
  readonly postingPolicy: string | null;
}

export type ParsedCreateImportRun =
  { readonly ok: true; readonly input: CreateImportRunBody } | { readonly ok: false };

/** `POST /runs` body: identity, content hash, period and optional policy/file id. */
export function parseCreateImportRunBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateImportRun {
  if (body === undefined) {
    return { ok: false };
  }
  const source = readText(body, "source");
  const fileHash = readText(body, "fileHash");
  if (source === null || fileHash === null) {
    return { ok: false };
  }

  const profileVersion = readOptionalBodyText(body, "profileVersion");
  if (!profileVersion.ok) {
    return { ok: false };
  }

  const periodStart = readText(body, "periodStart", 32);
  const periodEnd = readText(body, "periodEnd", 32);
  if (
    periodStart === null ||
    periodEnd === null ||
    !ISO_DATE.test(periodStart) ||
    !ISO_DATE.test(periodEnd) ||
    periodStart > periodEnd
  ) {
    return { ok: false };
  }

  const fileObjectId = readOptionalUuidBody(body, "fileObjectId");
  if (!fileObjectId.ok) {
    return { ok: false };
  }

  const postingPolicy = readOptionalBodyText(body, "postingPolicy");
  if (!postingPolicy.ok) {
    return { ok: false };
  }
  if (postingPolicy.value !== null && !IMPORT_POSTING_POLICY.includes(postingPolicy.value)) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      source,
      profileVersion: profileVersion.value,
      fileHash,
      periodStart,
      periodEnd,
      fileObjectId: fileObjectId.value,
      postingPolicy: postingPolicy.value,
    },
  };
}

export type ParsedStageRows =
  { readonly ok: true; readonly rows: readonly StageImportRowInput[] } | { readonly ok: false };

/**
 * `POST /runs/[id]/rows` body: the parsed rows. Shape only — the command
 * re-checks row numbers and object-ness and retains every well-formed row
 * (`SALE-004`: semantically invalid rows are staged and marked, never dropped).
 */
export function parseStageRowsBody(body: Record<string, unknown> | undefined): ParsedStageRows {
  if (body === undefined || !Array.isArray(body.rows)) {
    return { ok: false };
  }
  if (body.rows.length === 0 || body.rows.length > MAX_ROWS) {
    return { ok: false };
  }
  const rows: StageImportRowInput[] = [];
  for (const raw of body.rows) {
    if (!isPlainObject(raw)) {
      return { ok: false };
    }
    const sourceRowNo = raw.sourceRowNo;
    if (typeof sourceRowNo !== "number" || !Number.isInteger(sourceRowNo) || sourceRowNo < 1) {
      return { ok: false };
    }
    if (!isPlainObject(raw.raw) || !isPlainObject(raw.normalized)) {
      return { ok: false };
    }
    rows.push({ sourceRowNo, raw: raw.raw, normalized: raw.normalized });
  }
  return { ok: true, rows };
}

export type ParsedValidateImportRun =
  { readonly ok: true; readonly rules: ImportValidationRules } | { readonly ok: false };

/**
 * `POST /runs/[id]/validate` body: caller-supplied validation rules that
 * override the run's own (`DEC-081`). The run's resolved `import_profile`
 * supplies the base rules and the request's rules override them field by field,
 * so an absent/empty body means "profile rules only".
 */
export function parseValidateImportRunBody(
  body: Record<string, unknown> | undefined,
): ParsedValidateImportRun {
  if (body === undefined) {
    return { ok: true, rules: {} };
  }
  const requiredNormalizedFields = readOptionalTextList(body, "requiredNormalizedFields");
  const allowedLocationExternalIds = readOptionalTextList(body, "allowedLocationExternalIds");
  const expectedCurrency = readOptionalBodyText(body, "expectedCurrency", 16);
  const requireCurrency = readOptionalBoolean(body, "requireCurrency");
  const requireOccurredAt = readOptionalBoolean(body, "requireOccurredAt");
  const requireAmounts = readOptionalBoolean(body, "requireAmounts");
  if (
    !requiredNormalizedFields.ok ||
    !allowedLocationExternalIds.ok ||
    !expectedCurrency.ok ||
    !requireCurrency.ok ||
    !requireOccurredAt.ok ||
    !requireAmounts.ok
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    rules: {
      ...(requiredNormalizedFields.value === undefined
        ? {}
        : { requiredNormalizedFields: requiredNormalizedFields.value }),
      ...(allowedLocationExternalIds.value === undefined
        ? {}
        : { allowedLocationExternalIds: allowedLocationExternalIds.value }),
      ...(expectedCurrency.value === null ? {} : { expectedCurrency: expectedCurrency.value }),
      ...(requireCurrency.value === undefined ? {} : { requireCurrency: requireCurrency.value }),
      ...(requireOccurredAt.value === undefined
        ? {}
        : { requireOccurredAt: requireOccurredAt.value }),
      ...(requireAmounts.value === undefined ? {} : { requireAmounts: requireAmounts.value }),
    },
  };
}

export interface MapImportRowsBody {
  readonly sourceSystem: string | null;
  readonly entityType: string | null;
}

export type ParsedMapImportRows =
  { readonly ok: true; readonly input: MapImportRowsBody } | { readonly ok: false };

/** `POST /runs/[id]/map` body: optional source/entity-type narrowing of the mappings. */
export function parseMapImportRowsBody(
  body: Record<string, unknown> | undefined,
): ParsedMapImportRows {
  if (body === undefined) {
    return { ok: true, input: { sourceSystem: null, entityType: null } };
  }
  const sourceSystem = readOptionalBodyText(body, "sourceSystem");
  const entityType = readOptionalBodyText(body, "entityType");
  if (!sourceSystem.ok || !entityType.ok) {
    return { ok: false };
  }
  return { ok: true, input: { sourceSystem: sourceSystem.value, entityType: entityType.value } };
}

export interface DisposeStagingRowBody {
  readonly stagingRowId: string;
  readonly disposition: ImportDispositionKind;
  readonly reason: string | null;
}

export type ParsedDisposeStagingRow =
  { readonly ok: true; readonly input: DisposeStagingRowBody } | { readonly ok: false };

/**
 * `POST /runs/[id]/dispositions` body: the staging row and one approved
 * disposition (`DEC-035`). A `rejected` disposition requires a reason — the
 * command enforces it too; this is a boundary check, not the authority.
 */
export function parseDisposeStagingRowBody(
  body: Record<string, unknown> | undefined,
): ParsedDisposeStagingRow {
  if (body === undefined) {
    return { ok: false };
  }
  const stagingRowId = readText(body, "stagingRowId", 64);
  if (stagingRowId === null || !isUuid(stagingRowId)) {
    return { ok: false };
  }
  const disposition = readText(body, "disposition", 32);
  if (disposition === null || !(IMPORT_DISPOSITIONS as readonly string[]).includes(disposition)) {
    return { ok: false };
  }
  const reason = readOptionalBodyText(body, "reason", 500);
  if (!reason.ok) {
    return { ok: false };
  }
  if (disposition === "rejected" && reason.value === null) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      stagingRowId,
      disposition: disposition as ImportDispositionKind,
      reason: reason.value,
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface ImportRunRow {
  readonly id: string;
  readonly source: string;
  readonly profileVersion: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
  readonly stagedCount: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly errorCount: number;
  readonly dispositionCount: number;
  readonly fileHash: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps run summaries to HTTP rows, dropping any foreign-organization run. */
export function toImportRunRows(
  organizationId: string,
  summaries: readonly ImportRunSummary[],
): readonly ImportRunRow[] {
  const rows: ImportRunRow[] = [];
  for (const summary of summaries) {
    const run = summary.run;
    if (run.organizationId !== organizationId) {
      continue;
    }
    rows.push({
      id: run.id,
      source: run.source,
      profileVersion: run.profileVersion,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      stagedCount: summary.stagedCount,
      mappedCount: summary.mappedCount,
      unmappedCount: summary.unmappedCount,
      errorCount: summary.errorCount,
      dispositionCount: summary.dispositionCount,
      fileHash: run.fileHash,
      createdAt: run.createdAt,
      createdBy: run.createdBy,
    });
  }
  return rows;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * A short, human-readable summary of a staging row's `normalized` jsonb for the
 * review table. The keys are the ones this slice's import profiles write
 * (product/sku/external id, quantity, gross amount, occurred date, location);
 * unknown keys are ignored rather than interpreted.
 */
export function normalizedSummary(normalized: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  const product = text(normalized.product) ?? text(normalized.sku) ?? text(normalized.external_id);
  if (product !== null) {
    parts.push(product);
  }
  const variant = text(normalized.variant);
  if (variant !== null) {
    parts.push(variant);
  }
  const quantity = text(normalized.quantity);
  if (quantity !== null) {
    parts.push(`× ${quantity}`);
  }
  const amount = text(normalized.gross_amount) ?? text(normalized.line_total);
  if (amount !== null) {
    const currency = text(normalized.currency);
    parts.push(currency === null ? amount : `${amount} ${currency}`);
  }
  const occurredAt = text(normalized.occurred_at);
  if (occurredAt !== null) {
    parts.push(occurredAt.slice(0, 10));
  }
  const location = text(normalized.location_external_id);
  if (location !== null) {
    parts.push(location);
  }
  return parts.length === 0 ? "—" : parts.join(" · ");
}

export interface StagingRowRow {
  readonly id: string;
  readonly sourceRowNo: number;
  readonly mappingState: string;
  readonly errorCode: string | null;
  /** True once slice 12 has linked the row to a posted sales line (always false in slice 11). */
  readonly posted: boolean;
  readonly summary: string;
}

/** Maps a run's staging rows to HTTP rows (already organization-scoped by the run read). */
export function toStagingRowRows(
  rows: readonly ImportStagingRowRecord[],
): readonly StagingRowRow[] {
  return rows.map((row) => ({
    id: row.id,
    sourceRowNo: row.sourceRowNo,
    mappingState: row.mappingState,
    errorCode: row.errorCode,
    posted: row.linkedSalesLineId !== null,
    summary: normalizedSummary(row.normalized),
  }));
}

export interface PreviewJson {
  readonly importRunId: string;
  readonly status: string;
  readonly rowCount: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly ignoredCount: number;
  readonly erroredCount: number;
  readonly conflictCount: number;
  readonly undecidedCount: number;
  readonly sourceTotals: MoneyTotals | null;
  readonly postedTotals: MoneyTotals;
  readonly dispositionTotals: MoneyTotals;
  readonly residualTotals: MoneyTotals | null;
  readonly canClose: boolean;
}

/**
 * Maps the preview to a plain HTTP payload. `postedTotals` is always `{}` in
 * slice 11 — posting is row 12 (`ADR-0008`) — and the residual is therefore
 * `source - dispositions`, reported for visibility only.
 */
export function toPreviewJson(preview: ImportRunPreview): PreviewJson {
  return {
    importRunId: preview.importRunId,
    status: preview.status,
    rowCount: preview.rowCount,
    mappedCount: preview.mappedCount,
    unmappedCount: preview.unmappedCount,
    ignoredCount: preview.ignoredCount,
    erroredCount: preview.erroredCount,
    conflictCount: preview.conflictCount,
    undecidedCount: preview.undecidedRowIds.length,
    sourceTotals: preview.sourceTotals,
    postedTotals: preview.postedTotals,
    dispositionTotals: preview.dispositionTotals,
    residualTotals: preview.residualTotals,
    canClose: preview.canClose,
  };
}
