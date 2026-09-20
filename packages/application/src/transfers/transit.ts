import { DomainError } from "@aquarela/domain";

import type { InventoryStore } from "../inventory";

export interface TransitEndpoint {
  readonly locationId: string;
  readonly storageAreaId: string;
}

/**
 * Resolves the organization's in-transit holding point (`DEC-029`): a
 * `virtual_transit` location plus its `is_transit` storage area. The transit leg
 * is posted through it and eliminated in a consolidation, so the goods are never
 * double-counted between the two physical locations (`INV-009`).
 *
 * If the organization has no virtual transit location, or the location has no
 * `is_transit` area, the dispatch fails with a clear `DomainError` — the slice
 * never creates the transit point implicitly (recorded open point).
 *
 * The store's option reads are code-ordered, so the first match is deterministic
 * when an organization has more than one transit location.
 */
export async function resolveTransitEndpoint(
  store: InventoryStore,
  organizationId: string,
): Promise<TransitEndpoint> {
  const locations = await store.listLocations({ organizationId });
  const transitLocation = locations.find((location) => location.kind === "virtual_transit");
  if (transitLocation === undefined) {
    throw new DomainError(
      "no virtual transit location is configured for the organization; register one before dispatching",
    );
  }

  const areas = await store.listStorageAreas({
    organizationId,
    locationId: transitLocation.id,
  });
  const transitArea = areas.find((area) => area.isTransit);
  if (transitArea === undefined) {
    throw new DomainError(
      "the virtual transit location has no in-transit storage area; register one before dispatching",
    );
  }

  return { locationId: transitLocation.id, storageAreaId: transitArea.id };
}
