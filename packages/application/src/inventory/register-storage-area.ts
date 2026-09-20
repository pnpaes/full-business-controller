import { DomainError } from "@aquarela/domain";
import { STORAGE_AREA_KIND } from "@aquarela/persistence";

import { INVENTORY_AUDIT_ACTIONS } from "./actions";
import type { InventoryStore } from "./types";
import { isBlank } from "./validation";

const KINDS: readonly string[] = STORAGE_AREA_KIND;

export interface RegisterStorageAreaInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isTransit?: boolean;
}

/**
 * Registers one storage area (DATA_DICTIONARY §4). Vocabulary and text checks
 * run before the transaction; the location is org-checked and the code-duplicate
 * / transit rules are enforced inside it, then the row and its audit fact commit
 * together. `isTransit` may only be set on a `virtual_transit` location
 * (DEC-029's logical transit bucket).
 */
export async function registerStorageArea(
  store: InventoryStore,
  input: RegisterStorageAreaInput,
): Promise<{ storageAreaId: string }> {
  if (!KINDS.includes(input.kind)) {
    throw new DomainError(`kind must be one of ${KINDS.join(", ")}`);
  }
  if (isBlank(input.code)) {
    throw new DomainError("code must not be blank");
  }
  if (isBlank(input.name)) {
    throw new DomainError("name must not be blank");
  }
  const isTransit = input.isTransit ?? false;

  return store.withTransaction(async (tx) => {
    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    const existing = await tx.findStorageAreaByCode({
      organizationId: input.organizationId,
      locationId: input.locationId,
      code: input.code,
    });
    if (existing !== undefined) {
      throw new DomainError("storage area code already exists for this location");
    }

    if (isTransit && location.kind !== "virtual_transit") {
      throw new DomainError("isTransit may only be true on a virtual transit location");
    }

    const created = await tx.createStorageArea({
      organizationId: input.organizationId,
      locationId: input.locationId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      isTransit,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: INVENTORY_AUDIT_ACTIONS.storageAreaRegistered,
      entityType: "storage_area",
      entityId: created.id,
      after: {
        location_id: input.locationId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        is_transit: isTransit,
      },
    });

    return { storageAreaId: created.id };
  });
}
