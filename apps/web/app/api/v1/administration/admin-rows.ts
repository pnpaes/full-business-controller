import {
  DEFAULT_AUDIT_EVENT_LIMIT,
  DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT,
  DEFAULT_UNIT_LIMIT,
  DEFAULT_USER_LIMIT,
  MAX_AUDIT_EVENT_LIMIT,
  MAX_DATA_QUALITY_EXCEPTION_LIMIT,
  MAX_UNIT_LIMIT,
  MAX_USER_LIMIT,
  type AuditEventRecord,
  type AuthRoleRecord,
  type AuthUserSummary,
  type DataQualityExceptionRecord,
  type MasterUnit,
} from "@aquarela/application";
import { UNIT_DIMENSIONS, type UnitDimension } from "@aquarela/domain";

/**
 * Pure query parsing and response mapping for the Administration read API.
 * Kept free of Next, DB and I/O imports so the routes do the reads and hand the
 * application records to these mappers, which pick the wire fields explicitly
 * (no accidental field leakage).
 */

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readOptionalText(searchParams: URLSearchParams, key: string): string | undefined {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** `undefined` = absent (default), `"invalid"` = present but not a valid integer. */
function readOptionalInt(
  searchParams: URLSearchParams,
  key: string,
): number | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number(value);
}

/** Bounds shared by every Administration page parser (`DEFAULT`/`MAX`). */
function parsePage(
  searchParams: URLSearchParams,
  defaultLimit: number,
  maxLimit: number,
): { readonly limit: number; readonly offset: number } | undefined {
  const limit = readOptionalInt(searchParams, "limit");
  const offset = readOptionalInt(searchParams, "offset");
  if (limit === "invalid" || offset === "invalid") {
    return undefined;
  }
  const resolvedLimit = limit ?? defaultLimit;
  if (resolvedLimit < 1 || resolvedLimit > maxLimit) {
    return undefined;
  }
  return { limit: resolvedLimit, offset: offset ?? 0 };
}

/* ---------------------------------- units --------------------------------- */

export interface UnitsQuery {
  readonly dimension?: UnitDimension;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedUnitsQuery =
  { readonly ok: true; readonly query: UnitsQuery } | { readonly ok: false };

/** Parses the optional `dimension` filter and the `limit`/`offset` page. */
export function parseUnitsQuery(searchParams: URLSearchParams): ParsedUnitsQuery {
  const page = parsePage(searchParams, DEFAULT_UNIT_LIMIT, MAX_UNIT_LIMIT);
  if (page === undefined) {
    return { ok: false };
  }
  const dimension = readOptionalText(searchParams, "dimension");
  if (dimension !== undefined && !UNIT_DIMENSIONS.includes(dimension as UnitDimension)) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(dimension === undefined ? {} : { dimension: dimension as UnitDimension }),
      limit: page.limit,
      offset: page.offset,
    },
  };
}

export interface UnitRow {
  readonly id: string;
  readonly code: string;
  readonly dimension: string;
  readonly isBase: boolean;
}

export function toUnitRow(unit: MasterUnit): UnitRow {
  return { id: unit.id, code: unit.code, dimension: unit.dimension, isBase: unit.isBase };
}

/* ----------------------------- data quality ------------------------------- */

export interface DataQualityQuery {
  readonly status?: string;
  readonly severity?: string;
  readonly entityType?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedDataQualityQuery =
  { readonly ok: true; readonly query: DataQualityQuery } | { readonly ok: false };

/** Parses the optional `status`/`severity`/`entityType` filters and the page. */
export function parseDataQualityQuery(searchParams: URLSearchParams): ParsedDataQualityQuery {
  const page = parsePage(
    searchParams,
    DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT,
    MAX_DATA_QUALITY_EXCEPTION_LIMIT,
  );
  if (page === undefined) {
    return { ok: false };
  }
  const status = readOptionalText(searchParams, "status");
  const severity = readOptionalText(searchParams, "severity");
  const entityType = readOptionalText(searchParams, "entityType");
  return {
    ok: true,
    query: {
      ...(status === undefined ? {} : { status }),
      ...(severity === undefined ? {} : { severity }),
      ...(entityType === undefined ? {} : { entityType }),
      limit: page.limit,
      offset: page.offset,
    },
  };
}

export interface DataQualityExceptionRow {
  readonly id: string;
  readonly ruleCode: string;
  readonly severity: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly detectedAt: string;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly resolution: string | null;
}

export function toDataQualityExceptionRow(
  record: DataQualityExceptionRecord,
): DataQualityExceptionRow {
  return {
    id: record.id,
    ruleCode: record.ruleCode,
    severity: record.severity,
    entityType: record.entityType,
    entityId: record.entityId,
    detectedAt: record.detectedAt,
    ownerId: record.ownerId,
    dueDate: record.dueDate,
    status: record.status,
    resolution: record.resolution,
  };
}

/* ---------------------------------- audit --------------------------------- */

export interface AuditQuery {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedAuditQuery =
  { readonly ok: true; readonly query: AuditQuery } | { readonly ok: false };

/** ISO instant (the port convention for `timestamptz` bounds). */
function readOptionalInstant(
  searchParams: URLSearchParams,
  key: string,
): string | undefined | "invalid" {
  const value = readOptionalText(searchParams, key);
  if (value === undefined) {
    return undefined;
  }
  return Number.isNaN(new Date(value).getTime()) ? "invalid" : value;
}

/** Parses the optional entity/action/actor and time filters plus the page. */
export function parseAuditQuery(searchParams: URLSearchParams): ParsedAuditQuery {
  const page = parsePage(searchParams, DEFAULT_AUDIT_EVENT_LIMIT, MAX_AUDIT_EVENT_LIMIT);
  if (page === undefined) {
    return { ok: false };
  }
  const entityType = readOptionalText(searchParams, "entityType");
  const action = readOptionalText(searchParams, "action");
  const entityId = readOptionalText(searchParams, "entityId");
  if (entityId !== undefined && !isUuid(entityId)) {
    return { ok: false };
  }
  const actorId = readOptionalText(searchParams, "actorId");
  if (actorId !== undefined && !isUuid(actorId)) {
    return { ok: false };
  }
  const from = readOptionalInstant(searchParams, "from");
  const to = readOptionalInstant(searchParams, "to");
  if (from === "invalid" || to === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(entityType === undefined ? {} : { entityType }),
      ...(entityId === undefined ? {} : { entityId }),
      ...(action === undefined ? {} : { action }),
      ...(actorId === undefined ? {} : { actorId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: page.limit,
      offset: page.offset,
    },
  };
}

export interface AuditEventRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityVersion: number | null;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly occurredAt: string;
}

/** The wire row for the audit list: identity and context, never the before/after diffs. */
export function toAuditEventRow(record: AuditEventRecord): AuditEventRow {
  return {
    id: record.id,
    actorId: record.actorId,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    entityVersion: record.entityVersion,
    reason: record.reason,
    requestId: record.requestId,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt,
  };
}

/* ------------------------------- users / roles ----------------------------- */

export interface UserRoleRow {
  readonly roleId: string;
  readonly code: string;
  readonly locationId: string | null;
}

export interface UserRow {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly totpEnabled: boolean;
  readonly lastLoginAt: string | null;
  readonly roles: readonly UserRoleRow[];
  readonly locationIds: readonly string[];
}

/** The wire row for a management user: identity, status and access — never credentials. */
export function toUserRow(summary: AuthUserSummary): UserRow {
  return {
    id: summary.id,
    displayName: summary.displayName,
    username: summary.username,
    email: summary.email,
    status: summary.status,
    totpEnabled: summary.totpEnabled,
    lastLoginAt: summary.lastLoginAt === null ? null : summary.lastLoginAt.toISOString(),
    roles: summary.roles.map(({ roleId, code, locationId }) => ({ roleId, code, locationId })),
    locationIds: [...summary.locationIds],
  };
}

export interface RoleRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
}

export function toRoleRow(role: AuthRoleRecord): RoleRow {
  return { id: role.id, code: role.code, name: role.name, description: role.description };
}

export interface UsersQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedUsersQuery =
  { readonly ok: true; readonly query: UsersQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` page of the user list. */
export function parseUsersQuery(searchParams: URLSearchParams): ParsedUsersQuery {
  const page = parsePage(searchParams, DEFAULT_USER_LIMIT, MAX_USER_LIMIT);
  if (page === undefined) {
    return { ok: false };
  }
  return { ok: true, query: { limit: page.limit, offset: page.offset } };
}

/** Upper bound on a replaced scope set, so one request cannot write unbounded rows. */
export const MAX_LOCATION_SCOPES = 200;
/** Longest accepted free-text reason on a status change. */
export const MAX_REASON_LENGTH = 500;

function readBodyString(
  body: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = body?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export interface ParsedRoleBody {
  readonly ok: true;
  readonly roleId: string;
  /** `null` = the organization-wide grant. */
  readonly locationId: string | null;
}

export type ParsedRoleBodyResult = ParsedRoleBody | { readonly ok: false };

/**
 * Parses `{ roleId, locationId? }`, the body shared by grant and revoke: both
 * name one role grant by role id plus an optional location. An absent, `null` or
 * empty `locationId` means the organization-wide grant.
 */
export function parseRoleBody(body: Record<string, unknown> | undefined): ParsedRoleBodyResult {
  const roleId = readBodyString(body, "roleId");
  if (roleId === undefined || !isUuid(roleId)) {
    return { ok: false };
  }
  const rawLocation = body?.["locationId"];
  if (rawLocation === undefined || rawLocation === null) {
    return { ok: true, roleId, locationId: null };
  }
  if (typeof rawLocation !== "string") {
    return { ok: false };
  }
  const locationId = rawLocation.trim();
  if (locationId.length === 0) {
    return { ok: true, roleId, locationId: null };
  }
  if (!isUuid(locationId)) {
    return { ok: false };
  }
  return { ok: true, roleId, locationId };
}

export interface ParsedLocationScopes {
  readonly ok: true;
  readonly locationIds: readonly string[];
}

export type ParsedLocationScopesResult = ParsedLocationScopes | { readonly ok: false };

/** Parses `{ locationIds: string[] }` — the whole scope, replacing what exists. */
export function parseLocationScopesBody(
  body: Record<string, unknown> | undefined,
): ParsedLocationScopesResult {
  const raw = body?.["locationIds"];
  if (!Array.isArray(raw) || raw.length > MAX_LOCATION_SCOPES) {
    return { ok: false };
  }
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !isUuid(value.trim())) {
      return { ok: false };
    }
    ids.push(value.trim());
  }
  return { ok: true, locationIds: [...new Set(ids)] };
}

export interface ParsedReason {
  readonly ok: true;
  readonly reason?: string;
}

export type ParsedReasonResult = ParsedReason | { readonly ok: false };

/** Parses the optional `reason` on disable/enable; absent is valid, over-long is not. */
export function parseOptionalReason(body: Record<string, unknown> | undefined): ParsedReasonResult {
  const raw = body?.["reason"];
  if (raw === undefined || raw === null) {
    return { ok: true };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const reason = raw.trim();
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false };
  }
  return reason.length === 0 ? { ok: true } : { ok: true, reason };
}
