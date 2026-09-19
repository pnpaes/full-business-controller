import { DomainError, SupplierPack, Unit } from "@aquarela/domain";

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
 * of the item's base unit. The pack factor is validated with the domain
 * `SupplierPack` (positive, compatible dimensions — `package` to/from the base
 * unit of another dimension only), so an invalid pack never reaches the
 * database. The organization and item/supplier existence are checked here
 * because the repository functions are intentionally unscoped.
 */
export async function registerSupplierItem(
  store: MasterDataStore,
  input: RegisterSupplierItemInput,
): Promise<RegisterSupplierItemResult> {
  if (input.supplierSku.trim().length === 0) {
    throw new DomainError("supplier SKU must not be empty");
  }
  const [item, supplier, packUnit] = await Promise.all([
    store.findItem(input.itemId),
    store.findSupplier(input.supplierId),
    store.findUnit(input.packUnitId),
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
  const baseUnit = await store.findUnit(item.baseUnitId);
  if (baseUnit === undefined) {
    throw new DomainError("item base unit not found");
  }

  SupplierPack.from(toDomainUnit(packUnit), toDomainUnit(baseUnit), input.packToBaseUnitFactor);

  const existing = await store.findSupplierItemBySku(input.supplierId, input.supplierSku);
  if (existing !== undefined) {
    throw new DomainError("supplier SKU already registered for this supplier");
  }

  const created = await store.createSupplierItem({
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
}
