import { DomainError } from "@aquarela/domain";
import { INVENTORY_POLICY, ITEM_PURPOSE } from "@aquarela/persistence";

import { CATALOG_AUDIT_ACTIONS } from "./actions";
import type { MasterDataStore } from "./types";

const INVENTORY_POLICIES: readonly string[] = INVENTORY_POLICY;
const ITEM_PURPOSES: readonly string[] = ITEM_PURPOSE;

export interface UpdateItemInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly itemId: string;
  readonly name?: string;
  /** `DEC-150`: `for_sale`/`for_use`, editable after registration. */
  readonly purpose?: string;
  readonly inventoryPolicy?: string;
  readonly lotTracked?: boolean;
}

export interface UpdateItemResult {
  readonly itemId: string;
}

/**
 * Updates the mutable fields of one item (08_UI_UX.md §8.3). Only `name`,
 * `inventoryPolicy` and `lotTracked` are accepted:
 *
 * - `name` is a display label with no downstream meaning.
 * - `inventoryPolicy`/`lotTracked` govern *future* movements; every past
 *   movement already recorded its own quantity and lot, so changing them cannot
 *   rewrite a posted fact.
 *
 * The identity fields (`code`, `sku`), the base unit and the item type are
 * deliberately not mutable: `code`/`sku` anchor external-mapping identity
 * resolution, and the base unit/type anchor how every historical quantity, cost
 * and recipe line is interpreted — changing them would reinterpret history, not
 * correct it (append-only posture, DEC-008/DEC-028). `currentCost` is owned by
 * the receiving slice and is never edited here.
 *
 * Org-scoped: an unknown or cross-organization id is a domain failure. The
 * update and its audit fact commit together.
 */
export async function updateItem(
  store: MasterDataStore,
  input: UpdateItemInput,
): Promise<UpdateItemResult> {
  const changes: {
    name?: string;
    purpose?: string;
    inventoryPolicy?: string;
    lotTracked?: boolean;
  } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new DomainError("item name must not be empty");
    }
    changes.name = name;
  }
  if (input.purpose !== undefined) {
    if (!ITEM_PURPOSES.includes(input.purpose)) {
      throw new DomainError(`purpose must be one of ${ITEM_PURPOSES.join(", ")}`);
    }
    changes.purpose = input.purpose;
  }
  if (input.inventoryPolicy !== undefined) {
    if (!INVENTORY_POLICIES.includes(input.inventoryPolicy)) {
      throw new DomainError(`inventoryPolicy must be one of ${INVENTORY_POLICIES.join(", ")}`);
    }
    changes.inventoryPolicy = input.inventoryPolicy;
  }
  if (input.lotTracked !== undefined) {
    changes.lotTracked = input.lotTracked;
  }
  if (Object.keys(changes).length === 0) {
    throw new DomainError("no item changes provided");
  }

  return store.withTransaction(async (tx) => {
    const item = await tx.findCatalogItem(input.itemId);
    if (item === undefined || item.organizationId !== input.organizationId) {
      throw new DomainError("item not found in organization");
    }

    await tx.updateItem({ itemId: input.itemId, ...changes });
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CATALOG_AUDIT_ACTIONS.itemUpdated,
      entityType: "item",
      entityId: input.itemId,
      before: {
        name: item.name,
        purpose: item.purpose,
        inventory_policy: item.inventoryPolicy,
        lot_tracked: item.lotTracked,
      },
      after: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.purpose === undefined ? {} : { purpose: changes.purpose }),
        ...(changes.inventoryPolicy === undefined
          ? {}
          : { inventory_policy: changes.inventoryPolicy }),
        ...(changes.lotTracked === undefined ? {} : { lot_tracked: changes.lotTracked }),
      },
    });

    return { itemId: input.itemId };
  });
}
