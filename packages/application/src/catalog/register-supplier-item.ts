import { DomainError, parseDecimal, QUANTITY_SCALE, SupplierPack, Unit } from "@aquarela/domain";

import type { MasterDataStore, MasterUnit } from "./types";

export interface RegisterSupplierItemInput {
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly supplierSku: string;
  readonly packUnitId: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty?: string;
  readonly leadTimeDays?: number;
  readonly preferred?: boolean;
}

export interface RegisterSupplierItemResult {
  readonly supplierItemId: string;
}

function toDomainUnit(unit: MasterUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

/**
 * Registers a supplier pack (PROC-001): 1 `packUnitId` = `packToBaseUnitFactor`
 * of the item's base unit (`SupplierPack` allows a package to convert to the
 * item's base unit even when that is not the dimension's canonical base, DEC-051).
 * The pack factor and optional `minOrderQty`/`leadTimeDays` are validated at
 * this boundary, so an invalid row never reaches the database. The organization
 * and item/supplier existence are checked here because the repository functions
 * are intentionally unscoped. The duplicate-SKU check and the insert share one
 * transaction; the unique constraint is the concurrency authority.
 */
export async function registerSupplierItem(
  store: MasterDataStore,
  input: RegisterSupplierItemInput,
): Promise<RegisterSupplierItemResult> {
  if (input.supplierSku.trim().length === 0) {
    throw new DomainError("supplier SKU must not be empty");
  }
  // Validate the optional boundary inputs before opening a transaction, so a bad
  // value fails without touching the database. `parseDecimal` rejects malformed
  // or over-precise values (numeric(19,6)).
  if (input.minOrderQty !== undefined && parseDecimal(input.minOrderQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("minOrderQty must be a positive quantity of at most 6 decimal places");
  }
  if (
    input.leadTimeDays !== undefined &&
    (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0)
  ) {
    throw new DomainError("leadTimeDays must be a non-negative integer");
  }

  // The duplicate check and the insert run in one transaction. The unique
  // constraint remains the authority under concurrency; the Postgres adapter
  // translates its violation into the same domain failure.
  return store.withTransaction(async (tx) => {
    const [item, supplier, packUnit] = await Promise.all([
      tx.findItem(input.itemId),
      tx.findSupplier(input.supplierId),
      tx.findUnit(input.packUnitId),
    ]);
    if (item === undefined || item.organizationId !== input.organizationId) {
      throw new DomainError("item not found in organization");
    }
    if (supplier === undefined || supplier.organizationId !== input.organizationId) {
      throw new DomainError("supplier not found in organization");
    }
    if (packUnit === undefined) {
      throw new DomainError("pack unit not found");
    }
    const baseUnit = await tx.findUnit(item.baseUnitId);
    if (baseUnit === undefined) {
      throw new DomainError("item base unit not found");
    }

    SupplierPack.from(toDomainUnit(packUnit), toDomainUnit(baseUnit), input.packToBaseUnitFactor);

    const existing = await tx.findSupplierItemBySku(input.supplierId, input.supplierSku);
    if (existing !== undefined) {
      throw new DomainError("supplier SKU already registered for this supplier");
    }

    const created = await tx.createSupplierItem({
      organizationId: input.organizationId,
      supplierId: input.supplierId,
      itemId: input.itemId,
      supplierSku: input.supplierSku,
      packUnitId: input.packUnitId,
      packToBaseUnitFactor: input.packToBaseUnitFactor,
      ...(input.minOrderQty !== undefined ? { minOrderQty: input.minOrderQty } : {}),
      ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
      ...(input.preferred !== undefined ? { preferred: input.preferred } : {}),
    });
    return { supplierItemId: created.id };
  });
}
