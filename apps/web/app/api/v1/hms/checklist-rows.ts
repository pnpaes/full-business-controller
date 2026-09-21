import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_FREQUENCIES,
  CHECKLIST_ITEM_OUTCOMES,
  CHECKLIST_RUN_STATUSES,
  DEFAULT_CHECKLIST_RUN_LIMIT,
  DEFAULT_CHECKLIST_TEMPLATE_LIMIT,
  type ChecklistRunRecord,
  type ChecklistTemplateRecord,
} from "@aquarela/application";

import { isUuid } from "./hms-rows";

export { isUuid };

/**
 * Pure query/body parsing and response mapping for the HMS checklist routes
 * (`HMS-005`, `DEC-091`, `DEC-096`). Kept free of Next, DB and I/O imports so
 * the routes do the reads and hand the application results to the row mappers.
 *
 * Unlike the incident parsers — which defer every vocabulary to the command —
 * here the `category`/`frequency`/`status`/item-`outcome` sets are checked in
 * the parser against the same application constants the commands use, so a bad
 * vocabulary value is a 400 without touching the store. `items`/`results` are
 * jsonb arrays handed through untransformed (`DEC-096` keeps their shape
 * provisional); only their array-ness (and a result's `key`/`outcome`/`note`)
 * is checked here, the rest is the command's authority. The row mappers drop a
 * foreign-organization row defensively, like the other slices, even though the
 * application reads are already organization-scoped (`DEC-061`).
 */

const MAX_LIMIT = 200;
const MAX_NAME = 200;
const MAX_VOCAB = 32;
const MAX_INSTANT = 64;
const MAX_NOTES = 2000;

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

/** Parses `limit`/`offset`; `defaultLimit` is the application's page default. */
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
  // `offset` is bounded too (the same ceiling constant): without it a huge
  // value like `?offset=999999999999` would be passed straight to the store.
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

function readOptionalQueryBoolean(
  searchParams: URLSearchParams,
  key: string,
): boolean | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return "invalid";
}

function readText(body: Record<string, unknown>, key: string, max = MAX_VOCAB): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

type OptionalField<T> =
  { readonly ok: true; readonly present: boolean; readonly value: T } | { readonly ok: false };

/** Optional free text: absent → not present; null/blank → `null`; wrong type/over-long → invalid. */
function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_NOTES,
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
  max = MAX_VOCAB,
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

/** Optional boolean: absent → not present; any non-boolean → invalid. */
function readOptionalBoolean(body: Record<string, unknown>, key: string): OptionalField<boolean> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: false };
  }
  return typeof value === "boolean" ? { ok: true, present: true, value } : { ok: false };
}

/**
 * One jsonb element of `checklist_run.results` — `{ key, outcome, note? }`
 * (`DEC-096`). Mirrors `assertChecklistResults` so a bad `outcome` is a 400
 * before the store is touched; the command re-checks it as the authority.
 */
function isChecklistResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (typeof result.key !== "string" || result.key.trim().length === 0) {
    return false;
  }
  if (typeof result.outcome !== "string" || !CHECKLIST_ITEM_OUTCOMES.includes(result.outcome)) {
    return false;
  }
  return result.note === undefined || typeof result.note === "string";
}

function isChecklistResults(value: unknown): boolean {
  return Array.isArray(value) && value.every(isChecklistResult);
}

/** Optional jsonb array: absent → not present; a non-array → invalid. */
function readOptionalArray(
  body: Record<string, unknown>,
  key: string,
  isValid: (value: unknown) => boolean,
): OptionalField<unknown> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: undefined };
  }
  return isValid(value) ? { ok: true, present: true, value } : { ok: false };
}

/* --------------------------------- queries -------------------------------- */

export interface ChecklistTemplateListQuery {
  readonly category?: string;
  readonly active?: boolean;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedChecklistTemplateListQuery =
  { readonly ok: true; readonly query: ChecklistTemplateListQuery } | { readonly ok: false };

/** Parses the optional `category`/`active` filters and `limit`/`offset` paging. */
export function parseChecklistTemplateListQuery(
  searchParams: URLSearchParams,
): ParsedChecklistTemplateListQuery {
  const category = readTextFilter(searchParams, "category");
  if (category === "invalid") {
    return { ok: false };
  }
  const active = readOptionalQueryBoolean(searchParams, "active");
  if (active === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_CHECKLIST_TEMPLATE_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(category === undefined ? {} : { category }),
      ...(active === undefined ? {} : { active }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface ChecklistRunListQuery {
  readonly templateId?: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedChecklistRunListQuery =
  { readonly ok: true; readonly query: ChecklistRunListQuery } | { readonly ok: false };

/** Parses the optional `templateId`/`locationId`/`status` filters and `limit`/`offset` paging. */
export function parseChecklistRunListQuery(
  searchParams: URLSearchParams,
): ParsedChecklistRunListQuery {
  const templateId = readUuidFilter(searchParams, "templateId");
  const locationId = readUuidFilter(searchParams, "locationId");
  if (templateId === "invalid" || locationId === "invalid") {
    return { ok: false };
  }
  const status = readTextFilter(searchParams, "status");
  if (status === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_CHECKLIST_RUN_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(templateId === undefined ? {} : { templateId }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(status === undefined ? {} : { status }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

/* -------------------------------- bodies ---------------------------------- */

export interface CreateChecklistTemplateBody {
  readonly name: string;
  readonly category: string;
  readonly frequency: string;
  readonly items: unknown;
  /** Absent → the command keeps its `true` default. */
  readonly active?: boolean;
  readonly supersedesId?: string | null;
}

export type ParsedCreateChecklistTemplate =
  { readonly ok: true; readonly input: CreateChecklistTemplateBody } | { readonly ok: false };

/** `POST /checklist-templates` body: name, vocabularies, the item list and an optional revision link. */
export function parseCreateChecklistTemplateBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateChecklistTemplate {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readText(body, "name", MAX_NAME);
  const category = readText(body, "category", MAX_VOCAB);
  const frequency = readText(body, "frequency", MAX_VOCAB);
  if (name === null || category === null || frequency === null) {
    return { ok: false };
  }
  if (!CHECKLIST_CATEGORIES.includes(category) || !CHECKLIST_FREQUENCIES.includes(frequency)) {
    return { ok: false };
  }
  if (!Array.isArray(body["items"])) {
    return { ok: false };
  }

  const active = readOptionalBoolean(body, "active");
  const supersedesId = readOptionalUuid(body, "supersedesId");
  if (!active.ok || !supersedesId.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      name,
      category,
      frequency,
      items: body["items"],
      ...(active.present ? { active: active.value } : {}),
      ...(supersedesId.present ? { supersedesId: supersedesId.value } : {}),
    },
  };
}

export interface UpdateChecklistTemplateBody {
  readonly name?: string;
  readonly category?: string;
  readonly frequency?: string;
  readonly items?: unknown;
  readonly active?: boolean;
}

export type ParsedUpdateChecklistTemplate =
  { readonly ok: true; readonly input: UpdateChecklistTemplateBody } | { readonly ok: false };

/** `PATCH /checklist-templates/[id]` body: any subset of the mutable fields. */
export function parseUpdateChecklistTemplateBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateChecklistTemplate {
  if (body === undefined) {
    return { ok: false };
  }
  const name = readOptionalRequiredText(body, "name", MAX_NAME);
  const category = readOptionalRequiredText(body, "category", MAX_VOCAB);
  const frequency = readOptionalRequiredText(body, "frequency", MAX_VOCAB);
  if (!name.ok || !category.ok || !frequency.ok) {
    return { ok: false };
  }
  if (category.present && !CHECKLIST_CATEGORIES.includes(category.value)) {
    return { ok: false };
  }
  if (frequency.present && !CHECKLIST_FREQUENCIES.includes(frequency.value)) {
    return { ok: false };
  }
  const items = readOptionalArray(body, "items", Array.isArray);
  const active = readOptionalBoolean(body, "active");
  if (!items.ok || !active.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(name.present ? { name: name.value } : {}),
      ...(category.present ? { category: category.value } : {}),
      ...(frequency.present ? { frequency: frequency.value } : {}),
      ...(items.present ? { items: items.value } : {}),
      ...(active.present ? { active: active.value } : {}),
    },
  };
}

export interface RecordChecklistRunBody {
  readonly templateId: string;
  readonly locationId: string;
  readonly runAt: string;
  /** Absent → the command starts the run `in_progress`. */
  readonly status?: string;
  readonly results: unknown;
  readonly notes?: string | null;
}

export type ParsedRecordChecklistRun =
  { readonly ok: true; readonly input: RecordChecklistRunBody } | { readonly ok: false };

/** `POST /checklist-runs` body; `performedBy` is the session actor, filled by the route. */
export function parseRecordChecklistRunBody(
  body: Record<string, unknown> | undefined,
): ParsedRecordChecklistRun {
  if (body === undefined) {
    return { ok: false };
  }
  const templateId = readText(body, "templateId", 64);
  const locationId = readText(body, "locationId", 64);
  const runAt = readText(body, "runAt", MAX_INSTANT);
  if (
    templateId === null ||
    !isUuid(templateId) ||
    locationId === null ||
    !isUuid(locationId) ||
    runAt === null
  ) {
    return { ok: false };
  }
  if (!isChecklistResults(body["results"])) {
    return { ok: false };
  }
  const status = readOptionalRequiredText(body, "status", MAX_VOCAB);
  if (!status.ok || (status.present && !CHECKLIST_RUN_STATUSES.includes(status.value))) {
    return { ok: false };
  }
  const notes = readOptionalText(body, "notes", MAX_NOTES);
  if (!notes.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      templateId,
      locationId,
      runAt,
      results: body["results"],
      ...(status.present ? { status: status.value } : {}),
      ...(notes.present ? { notes: notes.value } : {}),
    },
  };
}

export interface UpdateChecklistRunBody {
  readonly status?: string;
  readonly results?: unknown;
  readonly notes?: string | null;
}

export type ParsedUpdateChecklistRun =
  { readonly ok: true; readonly input: UpdateChecklistRunBody } | { readonly ok: false };

/** `PATCH /checklist-runs/[id]` body: any subset of the mutable fields. */
export function parseUpdateChecklistRunBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateChecklistRun {
  if (body === undefined) {
    return { ok: false };
  }
  const status = readOptionalRequiredText(body, "status", MAX_VOCAB);
  if (!status.ok || (status.present && !CHECKLIST_RUN_STATUSES.includes(status.value))) {
    return { ok: false };
  }
  const results = readOptionalArray(body, "results", isChecklistResults);
  const notes = readOptionalText(body, "notes", MAX_NOTES);
  if (!results.ok || !notes.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      ...(status.present ? { status: status.value } : {}),
      ...(results.present ? { results: results.value } : {}),
      ...(notes.present ? { notes: notes.value } : {}),
    },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface ChecklistTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly frequency: string;
  readonly items: unknown;
  readonly active: boolean;
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one template to an HTTP row; `undefined` for a foreign-organization row. */
export function toChecklistTemplateRow(
  organizationId: string,
  template: ChecklistTemplateRecord,
): ChecklistTemplateRow | undefined {
  if (template.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    frequency: template.frequency,
    items: template.items,
    active: template.active,
    supersedesId: template.supersedesId,
    createdAt: template.createdAt,
    createdBy: template.createdBy,
  };
}

/** Maps template records to HTTP rows, dropping any foreign-organization template. */
export function toChecklistTemplateRows(
  organizationId: string,
  templates: readonly ChecklistTemplateRecord[],
): readonly ChecklistTemplateRow[] {
  const rows: ChecklistTemplateRow[] = [];
  for (const template of templates) {
    const row = toChecklistTemplateRow(organizationId, template);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface ChecklistRunRow {
  readonly id: string;
  readonly templateId: string;
  readonly locationId: string;
  readonly runAt: string;
  readonly performedBy: string;
  readonly status: string;
  readonly results: unknown;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Maps one run to an HTTP row; `undefined` for a foreign-organization row. */
export function toChecklistRunRow(
  organizationId: string,
  run: ChecklistRunRecord,
): ChecklistRunRow | undefined {
  if (run.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: run.id,
    templateId: run.templateId,
    locationId: run.locationId,
    runAt: run.runAt,
    performedBy: run.performedBy,
    status: run.status,
    results: run.results,
    notes: run.notes,
    createdAt: run.createdAt,
    createdBy: run.createdBy,
  };
}

/** Maps run records to HTTP rows, dropping any foreign-organization run. */
export function toChecklistRunRows(
  organizationId: string,
  runs: readonly ChecklistRunRecord[],
): readonly ChecklistRunRow[] {
  const rows: ChecklistRunRow[] = [];
  for (const run of runs) {
    const row = toChecklistRunRow(organizationId, run);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
