import type { EquipmentRecord, HmsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_EQUIPMENT_LIMIT = 50;

export interface ListEquipmentQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** Free-text `kind` exact match (`DEC-092` names no vocabulary). */
  readonly kind?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Equipment rows for one organization, ordered by `code` then id, with optional
 * location, kind and active filters. The organization filter is never optional,
 * so a caller cannot read another tenant's register (`DEC-061`); `limit`
 * defaults to `DEFAULT_EQUIPMENT_LIMIT` so a caller cannot ask for the whole
 * register unbounded.
 */
export async function listEquipment(
  store: HmsStore,
  query: ListEquipmentQuery,
): Promise<readonly EquipmentRecord[]> {
  return store.listEquipment({
    organizationId: query.organizationId,
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.active === undefined ? {} : { active: query.active }),
    limit: query.limit ?? DEFAULT_EQUIPMENT_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
