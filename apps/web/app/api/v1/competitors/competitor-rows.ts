import {
  COMPETITOR_COLLECTION_MODES,
  COMPETITOR_OBSERVATION_DEFAULT_STATUS,
  COMPETITOR_REVIEW_STATUSES,
  COMPETITOR_SOURCE_TYPES,
  DEFAULT_COMPETITOR_LIMIT,
  DEFAULT_COMPETITOR_OBSERVATION_LIMIT,
  DEFAULT_COMPETITOR_SOURCE_LIMIT,
  type CompetitorObservationRecord,
  type CompetitorRecord,
  type CompetitorSourceRecord,
} from "@aquarela/application";

/**
 * Pure query/body parsing and response mapping for the competitor routes
 * (`DEC-126`). Kept free of Next, DB and I/O imports so the routes do the reads
 * and hand the application results to the row mappers.
 *
 * The review-status vocabulary and the default status come from the application,
 * so the API cannot drift from the `competitor_review_status_check` values or
 * from the "reads default to reviewed" posture.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(?:\.\d{1,4})?$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const MAX_LIMIT = 200;
const MAX_TEXT = 2000;
const MAX_NAME = 200;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** True when `value` is a full ISO-8601 instant with a zone. */
function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/** True when `value` is an ISO calendar date (`YYYY-MM-DD`) that parses. */
function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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

function readPaging(
  searchParams: URLSearchParams,
  defaultLimit: number,
): { readonly ok: true; readonly limit: number; readonly offset: number } | { readonly ok: false } {
  const limit = readPositiveInteger(searchParams.get("limit"));
  const offset = readPositiveInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  if (offset !== undefined && offset > MAX_LIMIT) {
    return { ok: false };
  }
  return { ok: true, limit: limit ?? defaultLimit, offset: offset ?? 0 };
}

function readUuidFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return isUuid(value) ? value : "invalid";
}

function readInstantFilter(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return isIsoInstant(value) ? value : "invalid";
}

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Optional free text: absent/blank → `null`; over-long → invalid. */
function readOptionalText(
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

/** Optional uuid: absent/blank → `null`; non-uuid → invalid. */
function readOptionalUuid(
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
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return isUuid(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

/** Optional jsonb object: absent/`null` → `null`; a non-object → invalid. */
function readOptionalJsonObject(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: Record<string, unknown> | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** Optional one-of `<allowed>` text: absent/blank → `null`; a foreign value → invalid. */
function readOptionalEnum(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return allowed.includes(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

/** Optional non-negative decimal money: absent/blank → `null`; malformed/negative → invalid. */
function readOptionalMoney(
  body: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = body[key];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === "number") {
    // Reject a JSON number: money is never carried as a float (DEC-024).
    return { ok: false };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return MONEY.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

/** Optional ISO-4217 currency: absent/blank → `null`; non-3-letter → invalid. */
function readOptionalCurrency(
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
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return CURRENCY.test(trimmed) ? { ok: true, value: trimmed.toUpperCase() } : { ok: false };
}

/* --------------------------------- queries -------------------------------- */

export interface CompetitorListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedCompetitorListQuery =
  { readonly ok: true; readonly query: CompetitorListQuery } | { readonly ok: false };

export function parseCompetitorListQuery(searchParams: URLSearchParams): ParsedCompetitorListQuery {
  const paging = readPaging(searchParams, DEFAULT_COMPETITOR_LIMIT);
  return paging.ok
    ? { ok: true, query: { limit: paging.limit, offset: paging.offset } }
    : { ok: false };
}

export interface CompetitorSourceListQuery {
  /** `true` → open-ended; `false` → ended; absent → both. */
  readonly active?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedCompetitorSourceListQuery =
  { readonly ok: true; readonly query: CompetitorSourceListQuery } | { readonly ok: false };

/** Parses the source list filters; `active` is the literal `true`/`false`. */
export function parseCompetitorSourceListQuery(
  searchParams: URLSearchParams,
): ParsedCompetitorSourceListQuery {
  const activeRaw = searchParams.get("active");
  let active: boolean | undefined;
  if (activeRaw !== null) {
    const value = activeRaw.trim();
    if (value !== "true" && value !== "false") {
      return { ok: false };
    }
    active = value === "true";
  }
  const paging = readPaging(searchParams, DEFAULT_COMPETITOR_SOURCE_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(active === undefined ? {} : { active }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface ObservationListQuery {
  readonly competitorId?: string;
  /** One of `COMPETITOR_REVIEW_STATUSES`, or `all`. */
  readonly status?: string;
  /** ISO instant lower bound (`>=`). */
  readonly from?: string;
  /** ISO instant exclusive upper bound (`<`). */
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedObservationListQuery =
  { readonly ok: true; readonly query: ObservationListQuery } | { readonly ok: false };

/**
 * Parses the observation list filters. **No `status` means the default
 * `reviewed`** (the route passes `undefined` and the application applies it), so
 * a caller must ask explicitly for `pending`/`all`.
 */
export function parseObservationListQuery(
  searchParams: URLSearchParams,
): ParsedObservationListQuery {
  const competitorId = readUuidFilter(searchParams, "competitorId");
  if (competitorId === "invalid") {
    return { ok: false };
  }
  const statusRaw = searchParams.get("status");
  let status: string | undefined;
  if (statusRaw !== null) {
    const value = statusRaw.trim();
    if (value !== "all" && !(COMPETITOR_REVIEW_STATUSES as readonly string[]).includes(value)) {
      return { ok: false };
    }
    status = value;
  }
  const from = readInstantFilter(searchParams, "from");
  const to = readInstantFilter(searchParams, "to");
  if (from === "invalid" || to === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_COMPETITOR_OBSERVATION_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(competitorId === undefined ? {} : { competitorId }),
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface ComparisonQuery {
  readonly itemId?: string;
  readonly competitorId?: string;
  /** ISO instant lower bound (`>=`). */
  readonly from: string;
  /** ISO instant exclusive upper bound (`<`). */
  readonly to: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedComparisonQuery =
  { readonly ok: true; readonly query: ComparisonQuery } | { readonly ok: false };

/** Parses the comparison filters; `from`/`to` are required ISO instants. */
export function parseComparisonQuery(searchParams: URLSearchParams): ParsedComparisonQuery {
  const itemId = readUuidFilter(searchParams, "itemId");
  const competitorId = readUuidFilter(searchParams, "competitorId");
  if (itemId === "invalid" || competitorId === "invalid") {
    return { ok: false };
  }
  const from = readInstantFilter(searchParams, "from");
  const to = readInstantFilter(searchParams, "to");
  if (from === "invalid" || to === "invalid" || from === undefined || to === undefined) {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_COMPETITOR_OBSERVATION_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(itemId === undefined ? {} : { itemId }),
      ...(competitorId === undefined ? {} : { competitorId }),
      from,
      to,
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateCompetitorBody {
  readonly name: string;
  readonly notes: string | null;
}

export type ParsedCreateCompetitor =
  { readonly ok: true; readonly input: CreateCompetitorBody } | { readonly ok: false };

export function parseCreateCompetitorBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateCompetitor {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readText(body, "name", MAX_NAME);
  if (name === null) {
    return { ok: false };
  }
  const notes = readOptionalText(body, "notes");
  if (!notes.ok) {
    return { ok: false };
  }
  return { ok: true, input: { name, notes: notes.value } };
}

export interface RegisterCompetitorSourceBody {
  readonly competitorName: string;
  readonly competitorId: string | null;
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  readonly collectionMode: string;
  readonly rateLimitNote: string | null;
  readonly activeFrom: string;
}

export type ParsedRegisterCompetitorSource =
  { readonly ok: true; readonly input: RegisterCompetitorSourceBody } | { readonly ok: false };

/** `POST /competitors/sources` body: one source to register. */
export function parseRegisterCompetitorSourceBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterCompetitorSource {
  if (body === undefined) {
    return { ok: false };
  }
  const competitorName = readText(body, "competitorName", MAX_NAME);
  const urlOrIdentifier = readText(body, "urlOrIdentifier");
  if (competitorName === null || urlOrIdentifier === null) {
    return { ok: false };
  }
  const sourceType = readOptionalEnum(body, "sourceType", COMPETITOR_SOURCE_TYPES);
  const collectionMode = readOptionalEnum(body, "collectionMode", COMPETITOR_COLLECTION_MODES);
  if (
    !sourceType.ok ||
    !collectionMode.ok ||
    sourceType.value === null ||
    collectionMode.value === null
  ) {
    return { ok: false };
  }
  const activeFromRaw = body["activeFrom"];
  const activeFrom =
    typeof activeFromRaw === "string" && isIsoDate(activeFromRaw.trim())
      ? activeFromRaw.trim()
      : null;
  if (activeFrom === null) {
    return { ok: false };
  }
  const competitorId = readOptionalUuid(body, "competitorId");
  const rateLimitNote = readOptionalText(body, "rateLimitNote");
  if (!competitorId.ok || !rateLimitNote.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      competitorName,
      competitorId: competitorId.value,
      sourceType: sourceType.value,
      urlOrIdentifier,
      collectionMode: collectionMode.value,
      rateLimitNote: rateLimitNote.value,
      activeFrom,
    },
  };
}

export interface DeactivateCompetitorSourceBody {
  readonly activeTo: string;
}

export type ParsedDeactivateCompetitorSource =
  { readonly ok: true; readonly input: DeactivateCompetitorSourceBody } | { readonly ok: false };

/** `POST /competitors/sources/[id]/deactivate` body: the `active_to` date. */
export function parseDeactivateCompetitorSourceBody(
  body: Record<string, unknown> | undefined,
): ParsedDeactivateCompetitorSource {
  if (body === undefined) {
    return { ok: false };
  }
  const activeToRaw = body["activeTo"];
  const activeTo =
    typeof activeToRaw === "string" && isIsoDate(activeToRaw.trim()) ? activeToRaw.trim() : null;
  return activeTo === null ? { ok: false } : { ok: true, input: { activeTo } };
}

export interface RecordObservationBody {
  readonly competitorId: string;
  readonly observedAt: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly itemId: string | null;
  readonly externalName: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly offerNotes: string | null;
  readonly competitorSourceId: string | null;
  readonly captureMethod: string | null;
  readonly productCategory: string | null;
  readonly season: string | null;
  readonly provenance: Record<string, unknown> | null;
}

export type ParsedRecordObservation =
  { readonly ok: true; readonly input: RecordObservationBody } | { readonly ok: false };

/** `POST /competitors/observations` body: one captured observation (opens pending). */
export function parseRecordObservationBody(
  body: Record<string, unknown> | undefined,
): ParsedRecordObservation {
  if (body === undefined) {
    return { ok: false };
  }
  const competitorIdRaw = body["competitorId"];
  const competitorId =
    typeof competitorIdRaw === "string" && isUuid(competitorIdRaw.trim())
      ? competitorIdRaw.trim()
      : null;
  if (competitorId === null) {
    return { ok: false };
  }
  const observedAtRaw = body["observedAt"];
  const observedAt =
    typeof observedAtRaw === "string" && isIsoInstant(observedAtRaw.trim())
      ? observedAtRaw.trim()
      : null;
  if (observedAt === null) {
    return { ok: false };
  }
  const source = readText(body, "source");
  const externalName = readText(body, "externalName", MAX_NAME);
  if (source === null || externalName === null) {
    return { ok: false };
  }
  const sourceUrl = readOptionalText(body, "sourceUrl");
  const itemId = readOptionalUuid(body, "itemId");
  const price = readOptionalMoney(body, "price");
  const currency = readOptionalCurrency(body, "currency");
  const offerNotes = readOptionalText(body, "offerNotes");
  const competitorSourceId = readOptionalUuid(body, "competitorSourceId");
  const captureMethod = readOptionalEnum(body, "captureMethod", COMPETITOR_COLLECTION_MODES);
  const productCategory = readOptionalText(body, "productCategory");
  const season = readOptionalText(body, "season");
  const provenance = readOptionalJsonObject(body, "provenance");
  if (
    !sourceUrl.ok ||
    !itemId.ok ||
    !price.ok ||
    !currency.ok ||
    !offerNotes.ok ||
    !competitorSourceId.ok ||
    !captureMethod.ok ||
    !productCategory.ok ||
    !season.ok ||
    !provenance.ok
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      competitorId,
      observedAt,
      source,
      sourceUrl: sourceUrl.value,
      itemId: itemId.value,
      externalName,
      price: price.value,
      currency: currency.value,
      offerNotes: offerNotes.value,
      competitorSourceId: competitorSourceId.value,
      captureMethod: captureMethod.value,
      productCategory: productCategory.value,
      season: season.value,
      provenance: provenance.value,
    },
  };
}

export interface ReviewObservationBody {
  /** `reviewed` or `rejected`. */
  readonly decision: "reviewed" | "rejected";
}

export type ParsedReviewObservation =
  { readonly ok: true; readonly input: ReviewObservationBody } | { readonly ok: false };

/** `POST /competitors/observations/[id]/review` body: the one-shot decision. */
export function parseReviewObservationBody(
  body: Record<string, unknown> | undefined,
): ParsedReviewObservation {
  if (body === undefined) {
    return { ok: false };
  }
  const decision = body["decision"];
  return decision === "reviewed" || decision === "rejected"
    ? { ok: true, input: { decision } }
    : { ok: false };
}

/* ------------------------------ response rows ----------------------------- */

export interface CompetitorRow {
  readonly id: string;
  readonly name: string;
  readonly notes: string | null;
  readonly createdAt: string;
}

/** Maps one competitor to an HTTP row; `undefined` for a foreign-organization row. */
export function toCompetitorRow(
  organizationId: string,
  competitor: CompetitorRecord,
): CompetitorRow | undefined {
  if (competitor.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: competitor.id,
    name: competitor.name,
    notes: competitor.notes,
    createdAt: competitor.createdAt,
  };
}

export function toCompetitorRows(
  organizationId: string,
  competitors: readonly CompetitorRecord[],
): readonly CompetitorRow[] {
  const rows: CompetitorRow[] = [];
  for (const competitor of competitors) {
    const row = toCompetitorRow(organizationId, competitor);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface ObservationRow {
  readonly id: string;
  readonly competitorId: string;
  readonly observedAt: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly itemId: string | null;
  readonly externalName: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly offerNotes: string | null;
  readonly reviewStatus: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly competitorSourceId: string | null;
  readonly captureMethod: string | null;
  readonly productCategory: string | null;
  readonly season: string | null;
  readonly provenance: Record<string, unknown>;
  readonly createdAt: string;
}

/** Maps one observation to an HTTP row; `undefined` for a foreign-organization row. */
export function toObservationRow(
  organizationId: string,
  observation: CompetitorObservationRecord,
): ObservationRow | undefined {
  if (observation.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: observation.id,
    competitorId: observation.competitorId,
    observedAt: observation.observedAt,
    source: observation.source,
    sourceUrl: observation.sourceUrl,
    itemId: observation.itemId,
    externalName: observation.externalName,
    price: observation.price,
    currency: observation.currency,
    offerNotes: observation.offerNotes,
    reviewStatus: observation.reviewStatus,
    reviewedBy: observation.reviewedBy,
    reviewedAt: observation.reviewedAt,
    competitorSourceId: observation.competitorSourceId,
    captureMethod: observation.captureMethod,
    productCategory: observation.productCategory,
    season: observation.season,
    provenance: observation.provenance,
    createdAt: observation.createdAt,
  };
}

export interface CompetitorSourceRow {
  readonly id: string;
  readonly competitorName: string;
  readonly competitorId: string | null;
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  readonly collectionMode: string;
  readonly termsStatus: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rateLimitNote: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly version: number;
}

/** Maps one source to an HTTP row; `undefined` for a foreign-organization row. */
export function toCompetitorSourceRow(
  organizationId: string,
  source: CompetitorSourceRecord,
): CompetitorSourceRow | undefined {
  if (source.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: source.id,
    competitorName: source.competitorName,
    competitorId: source.competitorId,
    sourceType: source.sourceType,
    urlOrIdentifier: source.urlOrIdentifier,
    collectionMode: source.collectionMode,
    termsStatus: source.termsStatus,
    approvedBy: source.approvedBy,
    approvedAt: source.approvedAt,
    rateLimitNote: source.rateLimitNote,
    activeFrom: source.activeFrom,
    activeTo: source.activeTo,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    version: source.version,
  };
}

export function toCompetitorSourceRows(
  organizationId: string,
  sources: readonly CompetitorSourceRecord[],
): readonly CompetitorSourceRow[] {
  const rows: CompetitorSourceRow[] = [];
  for (const source of sources) {
    const row = toCompetitorSourceRow(organizationId, source);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export function toObservationRows(
  organizationId: string,
  observations: readonly CompetitorObservationRecord[],
): readonly ObservationRow[] {
  const rows: ObservationRow[] = [];
  for (const observation of observations) {
    const row = toObservationRow(organizationId, observation);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export { COMPETITOR_OBSERVATION_DEFAULT_STATUS };
