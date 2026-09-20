import { DomainError } from "@aquarela/domain";

import type { MasterDataStore, MasterItem } from "./types";

export interface RegisterItemInput {
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitId: string;
  /** Defaults to `stocked`. */
  readonly inventoryPolicy?: string;
  readonly lotTracked?: boolean;
}

export interface RegisterItemResult {
  readonly itemId: string;
  /** False when an item with this code already existed (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Registers an item (08_UI_UX.md §8.3). Idempotent on `(organization_id, code)`:
 * a re-run returns the existing item. Uniqueness is checked against both `code`
 * and `sku` before the insert; the database unique constraints remain the
 * authority under concurrency.
 *
 * ponytail: `item_type`/`inventory_policy` are passed through as given; the SQL
 * `check` constraints (`schemas/domain-enums.yaml`) are the vocabulary
 * authority. Promote them to a domain value object here if a second caller
 * needs the same validation.
 */
export async function registerItem(
  store: MasterDataStore,
  input: RegisterItemInput,
): Promise<RegisterItemResult> {
  const code = input.code.trim();
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("item code must not be empty");
  }
  if (sku.length === 0) {
    throw new DomainError("item SKU must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("item name must not be empty");
  }

  return store.withTransaction(async (tx) => {
    const baseUnit = await tx.findUnit(input.baseUnitId);
    if (baseUnit === undefined) {
      throw new DomainError("base unit not found");
    }

    const existing = await tx.findItemByCode(input.organizationId, code);
    if (existing !== undefined) {
      return { itemId: existing.id, created: false };
    }
    const skuOwner = await tx.findItemBySku(input.organizationId, sku);
    if (skuOwner !== undefined) {
      throw new DomainError("item SKU already registered in organization");
    }

    const created: MasterItem = await tx.createItem({
      organizationId: input.organizationId,
      code,
      sku,
      name,
      itemType: input.itemType,
      baseUnitId: input.baseUnitId,
      inventoryPolicy: input.inventoryPolicy ?? "stocked",
      lotTracked: input.lotTracked ?? false,
    });
    return { itemId: created.id, created: true };
  });
}
