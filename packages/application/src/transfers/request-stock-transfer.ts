import { DomainError } from "@aquarela/domain";

import { TRANSFER_AUDIT_ACTIONS } from "./actions";
import type { TransferStore } from "./types";
import { isUuid } from "./validation";

export interface RequestStockTransferInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly fromLocationId: string;
  readonly fromStorageAreaId: string;
  readonly toLocationId: string;
  readonly toStorageAreaId: string;
  /**
   * Optional deterministic id, used only by the idempotent demo seed so a
   * re-run finds the same header instead of creating a duplicate. The HTTP
   * surface never accepts it; the DB generates a random id otherwise.
   */
  readonly transferId?: string;
}

export interface RequestStockTransferResult {
  readonly transferId: string;
}

/**
 * Opens a transfer in status `requested` (`DEC-029`). The header names the two
 * physical endpoints; the items are chosen at dispatch, because there is no
 * transfer line table (recorded open point).
 *
 * Both locations and both storage areas are organization-checked, each area must
 * belong to its location, and neither endpoint may be the virtual transit point
 * or an `is_transit` bucket — transit is the internal leg, not a transfer end.
 */
export async function requestStockTransfer(
  store: TransferStore,
  input: RequestStockTransferInput,
): Promise<RequestStockTransferResult> {
  if (input.transferId !== undefined && !isUuid(input.transferId)) {
    throw new DomainError("transferId must be a UUID");
  }
  if (input.fromStorageAreaId === input.toStorageAreaId) {
    throw new DomainError("a transfer must not use the same storage area on both sides");
  }

  return store.withTransaction(async (tx) => {
    const fromLocation = await tx.findLocation(input.fromLocationId);
    if (fromLocation === undefined || fromLocation.organizationId !== input.organizationId) {
      throw new DomainError("from location not found in organization");
    }
    if (fromLocation.kind === "virtual_transit") {
      throw new DomainError("a transfer must not start at the virtual transit location");
    }
    const fromArea = await tx.findStorageArea(input.fromStorageAreaId);
    if (fromArea === undefined || fromArea.organizationId !== input.organizationId) {
      throw new DomainError("from storage area not found in organization");
    }
    if (fromArea.locationId !== input.fromLocationId) {
      throw new DomainError("from storage area does not belong to the from location");
    }
    if (fromArea.isTransit) {
      throw new DomainError("a transfer must not start at the in-transit storage area");
    }

    const toLocation = await tx.findLocation(input.toLocationId);
    if (toLocation === undefined || toLocation.organizationId !== input.organizationId) {
      throw new DomainError("to location not found in organization");
    }
    if (toLocation.kind === "virtual_transit") {
      throw new DomainError("a transfer must not end at the virtual transit location");
    }
    const toArea = await tx.findStorageArea(input.toStorageAreaId);
    if (toArea === undefined || toArea.organizationId !== input.organizationId) {
      throw new DomainError("to storage area not found in organization");
    }
    if (toArea.locationId !== input.toLocationId) {
      throw new DomainError("to storage area does not belong to the to location");
    }
    if (toArea.isTransit) {
      throw new DomainError("a transfer must not end at the in-transit storage area");
    }

    const transfer = await tx.createStockTransfer({
      ...(input.transferId === undefined ? {} : { id: input.transferId }),
      organizationId: input.organizationId,
      fromLocationId: input.fromLocationId,
      fromStorageAreaId: input.fromStorageAreaId,
      toLocationId: input.toLocationId,
      toStorageAreaId: input.toStorageAreaId,
      status: "requested",
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TRANSFER_AUDIT_ACTIONS.requested,
      entityType: "stock_transfer",
      entityId: transfer.id,
      after: {
        status: "requested",
        from_location_id: input.fromLocationId,
        from_storage_area_id: input.fromStorageAreaId,
        to_location_id: input.toLocationId,
        to_storage_area_id: input.toStorageAreaId,
      },
    });

    return { transferId: transfer.id };
  });
}
