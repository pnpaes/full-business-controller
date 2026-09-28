import { DomainError } from "@aquarela/domain";
import { ITEM_PURPOSE } from "@aquarela/persistence";

import type { MasterDataStore, MasterItem } from "./types";

const ITEM_PURPOSES: readonly string[] = ITEM_PURPOSE;

/**
 * `DEC-150`: the purpose a new item gets when the caller supplies none —
 * `finished_good` is a stocked item a sellable is fulfilled from, everything
 * else is an operational input.
 */
export function deriveItemPurpose(itemType: string): string {
  return itemType === "finished_good" ? "for_sale" : "for_use";
}

export interface RegisterItemInput {
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  /** `DEC-150`: derived from `itemType` when omitted; an explicit value wins. */
  readonly purpose?: string;
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

  const purpose = input.purpose ?? deriveItemPurpose(input.itemType);
  if (!ITEM_PURPOSES.includes(purpose)) {
    throw new DomainError(`purpose must be one of ${ITEM_PURPOSES.join(", ")}`);
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
      purpose,
      baseUnitId: input.baseUnitId,
      inventoryPolicy: input.inventoryPolicy ?? "stocked",
      lotTracked: input.lotTracked ?? false,
    });
    return { itemId: created.id, created: true };
  });
}
