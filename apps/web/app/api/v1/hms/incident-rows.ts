import type { CorrectiveActionRecord, IncidentRecord } from "@aquarela/application";

import { isUuid } from "./hms-rows";

import type { FileUploadPolicy } from "../../../../lib/file-upload";

export { isUuid };

/**
 * Upload policy and retention class for the incident-evidence consumer
 * (`DEC-134`): a scene photo or an attached report — JPEG, PNG, WebP or PDF —
 * capped at 10 MiB, the same set and cap as the maintenance-evidence consumer
 * (`DEC-133`), because both are HMS field evidence. These live here rather than
 * in the route module because a Next route file may only export HTTP handlers.
 */
export const HMS_INCIDENT_UPLOAD_POLICY: FileUploadPolicy = {
  allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  maxBytes: 10 * 1024 * 1024,
};
export const HMS_INCIDENT_RETENTION_POLICY = "hms_incident_evidence";

/**
 * Pure query/body parsing and response mapping for the HMS incident +
 * corrective-action routes (`HMS-003`/`HMS-004`, `DEC-090`). Kept free of Next,
 * DB and I/O imports so the routes do the reads and hand the application results
 * to the row mappers.
 *
 * The parsers do shape checks only (required text, UUIDs, `YYYY-MM-DD` days,
 * bounded paging): the `category`/`severity`/`status` vocabularies and the ISO
 * instants are the application commands' authority and surface as a
 * `DomainError` (400) with a readable message. A `YYYY-MM-DD` field is
 * calendar-checked here because the commands pass it straight to a Postgres
 * `date` column, where a malformed day would be a driver error (500). The row
 * mappers drop a foreign-organization row defensively, like the other slices,
 * even though the application reads are already organization-scoped
 * (`DEC-061`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_TITLE = 200;
const MAX_TEXT = 200;
const MAX_DESCRIPTION = 2000;
const MAX_VOCAB = 32;
const MAX_INSTANT = 64;

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

/** Parses `limit`/`offset`; shared shape for every list in this module. */
function readPaging(
  searchParams: URLSearchParams,
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
  return { ok: true, limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 };
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

function readTextFilter(
  searchParams: URLSearchParams,
  key: string,
  max = MAX_VOCAB,
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 && value.length <= max ? value : "invalid";
}

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** True when `value` is a real `YYYY-MM-DD` day (`date` column shaped). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type OptionalField<T> =
  | { readonly ok: true; readonly present: boolean; readonly value: T }
  | {
      readonly ok: false;
    };

/** Optional free text: absent → not present; null/blank → `null`; wrong type/over-long → invalid. */
function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string" || value.length > max) {
    return { ok: false };
  }
  const trimmed = value.trim();
  return { ok: true, present: true, value: trimmed.length === 0 ? null : trimmed };
}

/** Optional non-empty text (a patch field that must stay a string): blank → invalid. */
function readOptionalRequiredText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max
    ? { ok: true, present: true, value: trimmed }
    : { ok: false };
}

/** Optional uuid: absent → not present; null/blank → `null`; non-uuid → invalid. */
function readOptionalUuid(
  body: Record<string, unknown>,
  key: string,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, present: true, value: null };
  }
  return isUuid(trimmed) ? { ok: true, present: true, value: trimmed } : { ok: false };
}

/** Optional `YYYY-MM-DD`: absent → not present; null/blank → `null`; malformed → invalid. */
function readOptionalDate(
  body: Record<string, unknown>,
  key: string,
): OptionalField<string | null> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: null };
  }
  if (value === null) {
    return { ok: true, present: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, present: true, value: null };
  }
  return isDate(trimmed) ? { ok: true, present: true, value: trimmed } : { ok: false };
}

/* --------------------------------- queries -------------------------------- */

export interface IncidentListQuery {
  readonly status?: string;
  readonly locationId?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedIncidentListQuery =
  { readonly ok: true; readonly query: IncidentListQuery } | { readonly ok: false };

/** Parses the optional `status`/`locationId` filters and `limit`/`offset` paging. */
export function parseIncidentListQuery(searchParams: URLSearchParams): ParsedIncidentListQuery {
  const status = readTextFilter(searchParams, "status");
  if (status === "invalid") {
    return { ok: false };
  }
  const locationId = readUuidFilter(searchParams, "locationId");
  if (locationId === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(status === undefined ? {} : { status }),
      ...(locationId === undefined ? {} : { locationId }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface CorrectiveActionListQuery {
  readonly incidentId?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedCorrectiveActionListQuery =
  { readonly ok: true; readonly query: CorrectiveActionListQuery } | { readonly ok: false };

/** Parses the optional `incidentId`/`status`/`ownerId` filters and `limit`/`offset` paging. */
export function parseCorrectiveActionListQuery(
  searchParams: URLSearchParams,
): ParsedCorrectiveActionListQuery {
  const incidentId = readUuidFilter(searchParams, "incidentId");
  const ownerId = readUuidFilter(searchParams, "ownerId");
  if (incidentId === "invalid" || ownerId === "invalid") {
    return { ok: false };
  }
  const status = readTextFilter(searchParams, "status");
  if (status === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(incidentId === undefined ? {} : { incidentId }),
      ...(status === undefined ? {} : { status }),
      ...(ownerId === undefined ? {} : { ownerId }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateIncidentBody {
  readonly locationId: string;
  readonly category: string;
  readonly severity: string;
  readonly occurredAt: string;
  /** Absent → the route fills the report instant (now). */
  readonly reportedAt: string | null;
  readonly ownerId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string | null;
  readonly involvesPersonalData: boolean;
}

export type ParsedCreateIncident =
  { readonly ok: true; readonly input: CreateIncidentBody } | { readonly ok: false };

/** `POST /incidents` body: where, what, when, who owns it and the privacy flag. */
export function parseCreateIncidentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateIncident {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const category = readText(body, "category", MAX_VOCAB);
  const severity = readText(body, "severity", MAX_VOCAB);
  const occurredAt = readText(body, "occurredAt", MAX_INSTANT);
  const reportedAt = readText(body, "reportedAt", MAX_INSTANT);
  const title = readText(body, "title", MAX_TITLE);
  if (
    locationId === null ||
    !isUuid(locationId) ||
    category === null ||
    severity === null ||
    occurredAt === null ||
    title === null
  ) {
    return { ok: false };
  }

  const ownerId = readOptionalUuid(body, "ownerId");
  const description = readOptionalText(body, "description", MAX_DESCRIPTION);
  const dueDate = readOptionalDate(body, "dueDate");
  if (!ownerId.ok || !description.ok || !dueDate.ok) {
    return { ok: false };
  }

  const involvesPersonalData = body["involvesPersonalData"];
  if (typeof involvesPersonalData !== "boolean") {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      locationId,
      category,
      severity,
      occurredAt,
      reportedAt,
      ownerId: ownerId.value,
      title,
      description: description.value,
      dueDate: dueDate.value,
      involvesPersonalData,
    },
  };
}

export interface UpdateIncidentBody {
  readonly status?: string;
  readonly severity?: string;
  readonly ownerId?: string | null;
  readonly dueDate?: string | null;
  readonly title?: string;
  readonly description?: string | null;
}

export type ParsedUpdateIncident =
  { readonly ok: true; readonly input: UpdateIncidentBody } | { readonly ok: false };

/** `PATCH /incidents/[id]` body: any subset of the mutable fields. */
export function parseUpdateIncidentBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateIncident {
  if (body === undefined) {
    return { ok: false };
  }
  const status = readOptionalRequiredText(body, "status", MAX_VOCAB);
  const severity = readOptionalRequiredText(body, "severity", MAX_VOCAB);
  const title = readOptionalRequiredText(body, "title", MAX_TITLE);
  const ownerId = readOptionalUuid(body, "ownerId");
  const dueDate = readOptionalDate(body, "dueDate");
  const description = readOptionalText(body, "description", MAX_DESCRIPTION);
  if (!status.ok || !severity.ok || !title.ok || !ownerId.ok || !dueDate.ok || !description.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(status.present ? { status: status.value } : {}),
      ...(severity.present ? { severity: severity.value } : {}),
      ...(title.present ? { title: title.value } : {}),
      ...(ownerId.present ? { ownerId: ownerId.value } : {}),
      ...(dueDate.present ? { dueDate: dueDate.value } : {}),
      ...(description.present ? { description: description.value } : {}),
    },
  };
}

export interface CreateCorrectiveActionBody {
  readonly description: string;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
}

export type ParsedCreateCorrectiveAction =
  { readonly ok: true; readonly input: CreateCorrectiveActionBody } | { readonly ok: false };

/** `POST /incidents/[id]/corrective-actions` body; the incident link is the path id. */
export function parseCreateCorrectiveActionBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateCorrectiveAction {
  if (body === undefined) {
    return { ok: false };
  }
  const description = readText(body, "description", MAX_DESCRIPTION);
  if (description === null) {
    return { ok: false };
  }
  const ownerId = readOptionalUuid(body, "ownerId");
  const dueDate = readOptionalDate(body, "dueDate");
  if (!ownerId.ok || !dueDate.ok) {
    return { ok: false };
  }
  return { ok: true, input: { description, ownerId: ownerId.value, dueDate: dueDate.value } };
}

export interface UpdateCorrectiveActionBody {
  readonly status?: string;
  readonly ownerId?: string | null;
  readonly dueDate?: string | null;
  readonly description?: string;
}

export type ParsedUpdateCorrectiveAction =
  { readonly ok: true; readonly input: UpdateCorrectiveActionBody } | { readonly ok: false };

/** `PATCH /corrective-actions/[id]` body: any subset of the mutable fields. */
export function parseUpdateCorrectiveActionBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateCorrectiveAction {
  if (body === undefined) {
    return { ok: false };
  }
  const status = readOptionalRequiredText(body, "status", MAX_VOCAB);
  const description = readOptionalRequiredText(body, "description", MAX_DESCRIPTION);
  const ownerId = readOptionalUuid(body, "ownerId");
  const dueDate = readOptionalDate(body, "dueDate");
  if (!status.ok || !description.ok || !ownerId.ok || !dueDate.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(status.present ? { status: status.value } : {}),
      ...(description.present ? { description: description.value } : {}),
      ...(ownerId.present ? { ownerId: ownerId.value } : {}),
      ...(dueDate.present ? { dueDate: dueDate.value } : {}),
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface IncidentRow {
  readonly id: string;
  readonly locationId: string;
  readonly category: string;
  readonly severity: string;
  readonly occurredAt: string;
  readonly reportedAt: string;
  readonly reportedBy: string;
  readonly ownerId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string | null;
  readonly involvesPersonalData: boolean;
  readonly status: string;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one incident to an HTTP row; `undefined` for a foreign-organization row. */
export function toIncidentRow(
  organizationId: string,
  incident: IncidentRecord,
): IncidentRow | undefined {
  if (incident.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: incident.id,
    locationId: incident.locationId,
    category: incident.category,
    severity: incident.severity,
    occurredAt: incident.occurredAt,
    reportedAt: incident.reportedAt,
    reportedBy: incident.reportedBy,
    ownerId: incident.ownerId,
    title: incident.title,
    description: incident.description,
    dueDate: incident.dueDate,
    involvesPersonalData: incident.involvesPersonalData,
    status: incident.status,
    closedAt: incident.closedAt,
    createdAt: incident.createdAt,
    createdBy: incident.createdBy,
  };
}

/** Maps incident records to HTTP rows, dropping any foreign-organization incident. */
export function toIncidentRows(
  organizationId: string,
  incidents: readonly IncidentRecord[],
): readonly IncidentRow[] {
  const rows: IncidentRow[] = [];
  for (const incident of incidents) {
    const row = toIncidentRow(organizationId, incident);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface CorrectiveActionRow {
  readonly id: string;
  readonly incidentId: string | null;
  readonly monitoringReadingId: string | null;
  readonly description: string;
  readonly ownerId: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly completedAt: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one corrective action to an HTTP row; `undefined` for a foreign-organization row. */
export function toCorrectiveActionRow(
  organizationId: string,
  action: CorrectiveActionRecord,
): CorrectiveActionRow | undefined {
  if (action.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: action.id,
    incidentId: action.incidentId,
    monitoringReadingId: action.monitoringReadingId,
    description: action.description,
    ownerId: action.ownerId,
    dueDate: action.dueDate,
    status: action.status,
    completedAt: action.completedAt,
    verifiedBy: action.verifiedBy,
    verifiedAt: action.verifiedAt,
    createdAt: action.createdAt,
    createdBy: action.createdBy,
  };
}

/** Maps corrective-action records to HTTP rows, dropping any foreign-organization action. */
export function toCorrectiveActionRows(
  organizationId: string,
  actions: readonly CorrectiveActionRecord[],
): readonly CorrectiveActionRow[] {
  const rows: CorrectiveActionRow[] = [];
  for (const action of actions) {
    const row = toCorrectiveActionRow(organizationId, action);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
