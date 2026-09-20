import type { InventoryLocationRecord, InventoryStorageAreaRecord } from "@aquarela/application";
import { STORAGE_AREA_KIND } from "@aquarela/persistence";

/**
 * Pure query/body parsing and response mapping for the storage-area routes.
 * `registerStorageArea` (application) remains the authority on the duplicate
 * code and transit rules; this module only validates shape and vocabulary.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 200;

export type ParsedStorageAreaQuery =
  { readonly ok: true; readonly locationId?: string } | { readonly ok: false };

export function parseStorageAreaQuery(searchParams: URLSearchParams): ParsedStorageAreaQuery {
  const raw = searchParams.get("locationId");
  if (raw === null) {
    return { ok: true };
  }
  const value = raw.trim();
  if (value.length === 0 || !UUID.test(value)) {
    return { ok: false };
  }
  return { ok: true, locationId: value };
}

export interface RegisterStorageAreaInput {
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isTransit: boolean;
}

export type ParsedRegisterStorageArea =
  { readonly ok: true; readonly input: RegisterStorageAreaInput } | { readonly ok: false };

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/**
 * Validates a registration body. `kind` must be in the persistence vocabulary
 * (the same list the column check enforces) and `isTransit` may only be true on
 * a `virtual_transit` location — the command re-checks that against the location
 * row, so the route never trusts the client's transit claim.
 */
export function parseRegisterStorageAreaBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterStorageArea {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const code = readText(body, "code", 60);
  const name = readText(body, "name", 120);
  if (locationId === null || !UUID.test(locationId) || code === null || name === null) {
    return { ok: false };
  }
  const kind = readText(body, "kind", 40);
  if (kind === null || !(STORAGE_AREA_KIND as readonly string[]).includes(kind)) {
    return { ok: false };
  }
  const transitRaw = body.isTransit;
  if (transitRaw !== undefined && typeof transitRaw !== "boolean") {
    return { ok: false };
  }
  return {
    ok: true,
    input: { locationId, code, name, kind, isTransit: transitRaw === true },
  };
}

export interface StorageAreaRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isTransit: boolean;
}

function orgOwned<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

/** Maps storage areas to HTTP rows, resolving the location code and org-checking it. */
export function toStorageAreaRows(
  organizationId: string,
  areas: readonly InventoryStorageAreaRecord[],
  locations: ReadonlyMap<string, InventoryLocationRecord>,
): readonly StorageAreaRow[] {
  const rows: StorageAreaRow[] = [];
  for (const area of areas) {
    if (area.organizationId !== organizationId) {
      continue;
    }
    const location = orgOwned(locations.get(area.locationId), organizationId);
    rows.push({
      id: area.id,
      locationId: area.locationId,
      locationCode: location?.code ?? null,
      code: area.code,
      name: area.name,
      kind: area.kind,
      isTransit: area.isTransit,
    });
  }
  return rows;
}
