import { DomainError } from "@aquarela/domain";

import { INVENTORY_AUDIT_ACTIONS } from "./actions";
import type { InventoryStore } from "./types";

export interface SetLocationDefaultStorageAreaInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
}

/**
 * Sets a location's default storage area (`DEC-145`), the fallback a goods
 * receipt resolves to when it carries no explicit per-receipt override.
 *
 * The location is org-checked and the area is asserted to belong to that same
 * location and organization **before** the write; the row update and its audit
 * fact commit together. The `0074` database guard mirrors both checks as a
 * backstop, so a caller that bypasses this command still cannot store an area
 * from another location or organization.
 */
export async function setLocationDefaultStorageArea(
  store: InventoryStore,
  input: SetLocationDefaultStorageAreaInput,
): Promise<{ readonly locationId: string; readonly storageAreaId: string }> {
  return store.withTransaction(async (tx) => {
    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }
    const area = await tx.findStorageArea(input.storageAreaId);
    if (area === undefined || area.organizationId !== input.organizationId) {
      throw new DomainError("storage area not found in organization");
    }
    if (area.locationId !== input.locationId) {
      throw new DomainError("storage area does not belong to the location");
    }

    const updated = await tx.setLocationDefaultStorageArea({
      organizationId: input.organizationId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
    });
    if (updated === undefined) {
      // The org-scoped update matched no row: the location vanished between the
      // read above and the write. Fail closed rather than report a phantom set.
      throw new DomainError("location not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: INVENTORY_AUDIT_ACTIONS.locationDefaultStorageAreaSet,
      entityType: "location",
      entityId: input.locationId,
      after: { default_storage_area_id: input.storageAreaId },
    });

    return { locationId: input.locationId, storageAreaId: input.storageAreaId };
  });
}
