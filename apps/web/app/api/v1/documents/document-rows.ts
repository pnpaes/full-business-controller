import {
  DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT,
  DEFAULT_DOCUMENT_LIMIT,
  DEFAULT_DOCUMENT_VERSION_LIMIT,
  DOCUMENT_AUDIENCES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  type DocumentAcknowledgementRecord,
  type DocumentRecord,
  type DocumentVersionRecord,
} from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

export { isUuid };

/**
 * Pure query/body parsing and response mapping for the staff document library
 * routes (`DEC-088`, requirements `DOC-001`…`DOC-004`). Kept free of Next, DB
 * and I/O imports so the routes do the reads and hand the application results to
 * the row mappers.
 *
 * The parsers do shape checks only where the value would otherwise reach a
 * Postgres column directly: the `category`/`audience`/`status` vocabularies —
 * exported by the application — are checked against the same constants the
 * commands use, so a bad value is a 400 from the parser and never reaches the
 * store. `status` is additionally restricted to `"archived"` (the only status a
 * PATCH may set, `DEC-088`): a body carrying `draft`/`published` is a 400. The
 * row mappers drop a foreign-organization row defensively, like the other
 * slices, even though the application reads are already organization-scoped
 * (`DEC-061`).
 */

const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const MAX_VOCAB = 32;
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

/**
 * Parses and bounds `limit`/`offset`. `limit` is `1..MAX_LIMIT`, `offset` is
 * `0..MAX_LIMIT` (so a huge offset cannot be passed straight to the store);
 * `defaultLimit` is the matching application page default.
 */
export function readPaging(
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

/** Echoes the paging back into a list envelope (`{ ok: true, limit, offset, ... }`). */
export function writePaging(
  limit: number,
  offset: number,
): { readonly limit: number; readonly offset: number } {
  return { limit, offset };
}

/** Required trimmed text within `max`; blank, wrong type or over-long → `null`. */
export function readText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export type OptionalField<T> =
  { readonly ok: true; readonly present: boolean; readonly value: T } | { readonly ok: false };

/** A required value from a fixed vocabulary; a non-member is invalid. */
function readVocab(
  body: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string | null {
  const value = readText(body, key, MAX_VOCAB);
  return value !== null && values.includes(value) ? value : null;
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

/** Optional vocabulary member: absent → not present; a non-member/blank → invalid. */
function readOptionalVocab(
  body: Record<string, unknown>,
  key: string,
  values: readonly string[],
): OptionalField<string> {
  const value = body[key];
  if (value === undefined) {
    return { ok: true, present: false, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_VOCAB && values.includes(trimmed)
    ? { ok: true, present: true, value: trimmed }
    : { ok: false };
}

/** Optional uuid: absent → not present; null/blank → `null`; non-uuid → invalid. */
export function readOptionalUuid(
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

/** Optional free text: absent → not present; null/blank → `null`; over-long → invalid. */
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

/** Optional vocabulary filter against a query value; a non-member is invalid. */
function readVocabFilter(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[],
): string | undefined | "invalid" {
  const raw = searchParams.get(key);
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_VOCAB || !values.includes(value)) {
    return "invalid";
  }
  return value;
}

/* --------------------------------- queries -------------------------------- */

export interface DocumentListQuery {
  readonly category?: string;
  readonly audience?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedDocumentListQuery =
  { readonly ok: true; readonly query: DocumentListQuery } | { readonly ok: false };

/** Parses the optional `category`/`audience`/`status` filters and paging. */
export function parseDocumentListQuery(searchParams: URLSearchParams): ParsedDocumentListQuery {
  const category = readVocabFilter(searchParams, "category", DOCUMENT_CATEGORIES);
  if (category === "invalid") {
    return { ok: false };
  }
  const audience = readVocabFilter(searchParams, "audience", DOCUMENT_AUDIENCES);
  if (audience === "invalid") {
    return { ok: false };
  }
  const status = readVocabFilter(searchParams, "status", DOCUMENT_STATUSES);
  if (status === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_DOCUMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(category === undefined ? {} : { category }),
      ...(audience === undefined ? {} : { audience }),
      ...(status === undefined ? {} : { status }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

export interface DocumentVersionListQuery {
  readonly limit: number;
  readonly offset: number;
}

export type ParsedDocumentVersionListQuery =
  { readonly ok: true; readonly query: DocumentVersionListQuery } | { readonly ok: false };

/** Parses the `limit`/`offset` paging of a document's version list. */
export function parseDocumentVersionListQuery(
  searchParams: URLSearchParams,
): ParsedDocumentVersionListQuery {
  const paging = readPaging(searchParams, DEFAULT_DOCUMENT_VERSION_LIMIT);
  return paging.ok ? { ok: true, query: paging } : { ok: false };
}

export interface AcknowledgementListQuery {
  readonly documentVersionId?: string;
  readonly acknowledgedBy?: string;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedAcknowledgementListQuery =
  { readonly ok: true; readonly query: AcknowledgementListQuery } | { readonly ok: false };

/**
 * Parses the optional `documentVersionId`/`acknowledgedBy` filters and paging.
 * These are query-string filters; the route adds the path document as the
 * `documentId` scope of the read.
 */
export function parseAcknowledgementListQuery(
  searchParams: URLSearchParams,
): ParsedAcknowledgementListQuery {
  const documentVersionId = readUuidFilter(searchParams, "documentVersionId");
  if (documentVersionId === "invalid") {
    return { ok: false };
  }
  const acknowledgedBy = readUuidFilter(searchParams, "acknowledgedBy");
  if (acknowledgedBy === "invalid") {
    return { ok: false };
  }
  const paging = readPaging(searchParams, DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT);
  if (!paging.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    query: {
      ...(documentVersionId === undefined ? {} : { documentVersionId }),
      ...(acknowledgedBy === undefined ? {} : { acknowledgedBy }),
      limit: paging.limit,
      offset: paging.offset,
    },
  };
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

/* -------------------------------- bodies ---------------------------------- */

export interface CreateDocumentBody {
  readonly title: string;
  readonly category: string;
  readonly audience: string;
  readonly ownerId: string | null;
}

export type ParsedCreateDocument =
  { readonly ok: true; readonly input: CreateDocumentBody } | { readonly ok: false };

/** `POST /documents` body: the identity and audience of a new document. */
export function parseCreateDocumentBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateDocument {
  if (body === undefined) {
    return { ok: false };
  }
  const title = readText(body, "title");
  const category = readVocab(body, "category", DOCUMENT_CATEGORIES);
  const audience = readVocab(body, "audience", DOCUMENT_AUDIENCES);
  if (title === null || category === null || audience === null) {
    return { ok: false };
  }
  const ownerId = readOptionalUuid(body, "ownerId");
  if (!ownerId.ok) {
    return { ok: false };
  }
  return { ok: true, input: { title, category, audience, ownerId: ownerId.value } };
}

export interface UpdateDocumentBody {
  readonly title?: string;
  readonly category?: string;
  readonly audience?: string;
  readonly ownerId?: string | null;
  /** The only status a PATCH may set (`DEC-088`). */
  readonly status?: "archived";
}

export type ParsedUpdateDocument =
  { readonly ok: true; readonly input: UpdateDocumentBody } | { readonly ok: false };

/**
 * `PATCH /documents/[id]` body: any subset of the mutable metadata fields.
 * `status` is restricted to `"archived"` — publishing is the version command, so
 * any other status value is a 400 here rather than a command rejection.
 */
export function parseUpdateDocumentBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateDocument {
  if (body === undefined) {
    return { ok: false };
  }
  const title = readOptionalRequiredText(body, "title");
  const category = readOptionalVocab(body, "category", DOCUMENT_CATEGORIES);
  const audience = readOptionalVocab(body, "audience", DOCUMENT_AUDIENCES);
  const ownerId = readOptionalUuid(body, "ownerId");
  if (!title.ok || !category.ok || !audience.ok || !ownerId.ok) {
    return { ok: false };
  }

  const rawStatus = body["status"];
  let status: "archived" | undefined;
  if (rawStatus !== undefined) {
    if (rawStatus !== "archived") {
      return { ok: false };
    }
    status = "archived";
  }

  return {
    ok: true,
    input: {
      ...(title.present ? { title: title.value } : {}),
      ...(category.present ? { category: category.value } : {}),
      ...(audience.present ? { audience: audience.value } : {}),
      ...(ownerId.present ? { ownerId: ownerId.value } : {}),
      ...(status === undefined ? {} : { status }),
    },
  };
}

export interface CreateVersionBody {
  readonly fileObjectId: string | null;
  readonly notes: string | null;
}

export type ParsedCreateVersion =
  { readonly ok: true; readonly input: CreateVersionBody } | { readonly ok: false };

/** `POST /documents/[id]/versions` body: the optional file and notes of a new version. */
export function parseCreateVersionBody(
  body: Record<string, unknown> | undefined,
): ParsedCreateVersion {
  if (body === undefined) {
    return { ok: false };
  }
  const fileObjectId = readOptionalUuid(body, "fileObjectId");
  const notes = readOptionalText(body, "notes", MAX_NOTES);
  if (!fileObjectId.ok || !notes.ok) {
    return { ok: false };
  }
  return { ok: true, input: { fileObjectId: fileObjectId.value, notes: notes.value } };
}

export interface AcknowledgeBody {
  /** Absent → the command resolves the latest published version. */
  readonly documentVersionId?: string;
}

export type ParsedAcknowledge =
  { readonly ok: true; readonly input: AcknowledgeBody } | { readonly ok: false };

/** `POST /documents/[id]/acknowledgements` body: an optional explicit version. */
export function parseAcknowledgeBody(body: Record<string, unknown> | undefined): ParsedAcknowledge {
  if (body === undefined) {
    return { ok: false };
  }
  const documentVersionId = readOptionalUuid(body, "documentVersionId");
  if (!documentVersionId.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    input: documentVersionId.value === null ? {} : { documentVersionId: documentVersionId.value },
  };
}

/* ------------------------------ response rows ----------------------------- */

export interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly audience: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Maps one document to an HTTP row; `undefined` for a foreign-organization row. */
export function toDocumentRow(
  organizationId: string,
  document: DocumentRecord,
): DocumentRow | undefined {
  if (document.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    audience: document.audience,
    status: document.status,
    ownerId: document.ownerId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

/** Maps document records to HTTP rows, dropping any foreign-organization document. */
export function toDocumentRows(
  organizationId: string,
  documents: readonly DocumentRecord[],
): readonly DocumentRow[] {
  const rows: DocumentRow[] = [];
  for (const document of documents) {
    const row = toDocumentRow(organizationId, document);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface DocumentVersionRow {
  readonly id: string;
  readonly documentId: string;
  readonly version: number;
  readonly fileObjectId: string | null;
  readonly notes: string | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly createdAt: string;
}

/** Maps one version to an HTTP row; `undefined` for a foreign-organization row. */
export function toDocumentVersionRow(
  organizationId: string,
  version: DocumentVersionRecord,
): DocumentVersionRow | undefined {
  if (version.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: version.id,
    documentId: version.documentId,
    version: version.version,
    fileObjectId: version.fileObjectId,
    notes: version.notes,
    publishedAt: version.publishedAt,
    publishedBy: version.publishedBy,
    createdAt: version.createdAt,
  };
}

/** Maps version records to HTTP rows, dropping any foreign-organization version. */
export function toDocumentVersionRows(
  organizationId: string,
  versions: readonly DocumentVersionRecord[],
): readonly DocumentVersionRow[] {
  const rows: DocumentVersionRow[] = [];
  for (const version of versions) {
    const row = toDocumentVersionRow(organizationId, version);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

export interface AcknowledgementRow {
  readonly id: string;
  readonly documentVersionId: string;
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
}

/** Maps one acknowledgement to an HTTP row; `undefined` for a foreign-organization row. */
export function toAcknowledgementRow(
  organizationId: string,
  acknowledgement: DocumentAcknowledgementRecord,
): AcknowledgementRow | undefined {
  if (acknowledgement.organizationId !== organizationId) {
    return undefined;
  }
  return {
    id: acknowledgement.id,
    documentVersionId: acknowledgement.documentVersionId,
    acknowledgedBy: acknowledgement.acknowledgedBy,
    acknowledgedAt: acknowledgement.acknowledgedAt,
  };
}

/** Maps acknowledgement records to HTTP rows, dropping any foreign-organization row. */
export function toAcknowledgementRows(
  organizationId: string,
  acknowledgements: readonly DocumentAcknowledgementRecord[],
): readonly AcknowledgementRow[] {
  const rows: AcknowledgementRow[] = [];
  for (const acknowledgement of acknowledgements) {
    const row = toAcknowledgementRow(organizationId, acknowledgement);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}
