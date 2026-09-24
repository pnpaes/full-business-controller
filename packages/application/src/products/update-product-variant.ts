import { DomainError } from "@aquarela/domain";

import { PRODUCT_AUDIT_ACTIONS } from "./actions";
import type { ProductStore } from "./types";

export interface UpdateProductVariantInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productVariantId: string;
  readonly name?: string;
  /** `null` clears the size; absent leaves it unchanged. */
  readonly size?: string | null;
  /** `null` detaches the stocked item; absent leaves it unchanged. */
  readonly finishedGoodItemId?: string | null;
}

export interface UpdateProductVariantResult {
  readonly productVariantId: string;
}

/**
 * Updates the genuinely mutable fields of one variant (`DEC-128`). The mutable
 * set is:
 *
 * - `name` — a display label with no downstream meaning;
 * - `size` — a display label (nullable);
 * - `finishedGoodItemId` — the nullable link to the stocked finished-good item.
 *   It is a forward-looking link, not a stocked fact, and nullable by design: a
 *   made-to-order variant has none, and clearing it stays legal.
 *
 * `code`, `sku` and `productId` are **immutable**: they are the identity that
 * external mappings and history resolve against (`DEC-041`), so they are
 * created, never rewritten (append-only posture, `DEC-008`/`DEC-028`). A null
 * `finishedGoodItemId` supplied on registration stays null until an operator
 * attaches an item here. Org-scoped: an unknown or cross-organization variant
 * is a domain failure.
 */
export async function updateProductVariant(
  store: ProductStore,
  input: UpdateProductVariantInput,
): Promise<UpdateProductVariantResult> {
  const changes: { name?: string; size?: string | null; finishedGoodItemId?: string | null } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new DomainError("variant name must not be empty");
    }
    changes.name = name;
  }
  if (input.size !== undefined) {
    if (input.size === null) {
      changes.size = null;
    } else {
      const size = input.size.trim();
      changes.size = size.length === 0 ? null : size;
    }
  }
  if (input.finishedGoodItemId !== undefined) {
    changes.finishedGoodItemId = input.finishedGoodItemId;
  }
  if (Object.keys(changes).length === 0) {
    throw new DomainError("no variant changes provided");
  }

  return store.withTransaction(async (tx) => {
    const variant = await tx.findVariant(input.productVariantId);
    if (variant === undefined || variant.organizationId !== input.organizationId) {
      throw new DomainError("product variant not found in organization");
    }

    if (changes.finishedGoodItemId !== undefined && changes.finishedGoodItemId !== null) {
      const item = await tx.findItemScope(changes.finishedGoodItemId);
      if (item === undefined || item.organizationId !== input.organizationId) {
        throw new DomainError("finished-good item not found in this organization");
      }
    }

    await tx.updateVariant({ productVariantId: input.productVariantId, ...changes });
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.variantUpdated,
      entityType: "product_variant",
      entityId: input.productVariantId,
      before: {
        name: variant.name,
        size: variant.size,
        finished_good_item_id: variant.finishedGoodItemId,
      },
      after: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.size === undefined ? {} : { size: changes.size }),
        ...(changes.finishedGoodItemId === undefined
          ? {}
          : { finished_good_item_id: changes.finishedGoodItemId }),
      },
    });

    return { productVariantId: input.productVariantId };
  });
}
