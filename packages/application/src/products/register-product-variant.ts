import { DomainError } from "@aquarela/domain";

import { PRODUCT_AUDIT_ACTIONS } from "./actions";
import type { ProductStore } from "./types";

export interface RegisterProductVariantInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly size?: string | null;
  /**
   * The stocked finished-good `item` this variant is fulfilled from. Optional
   * and nullable on purpose: a made-to-order variant has no stocked item, so it
   * stays legal to register one without it.
   */
  readonly finishedGoodItemId?: string | null;
}

export interface RegisterProductVariantResult {
  readonly productVariantId: string;
  /** False when a variant with this code already existed (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Registers a product variant (`DEC-128`) — the sellable identity (`DEC-030`).
 * Validated at this boundary so an invalid row never reaches the database:
 *
 * - the product exists and belongs to the organization (a foreign product is a
 *   message-only `DomainError`);
 * - `code`, `sku` and `name` are non-blank;
 * - `sku` is unique per organization (`product_variant_organization_id_sku_key`);
 *   a collision with a different variant is a message-only `DomainError`;
 * - `finishedGoodItemId`, when supplied, names an item in the organization —
 *   and is **not required**, because a made-to-order variant genuinely has no
 *   stocked item.
 *
 * Idempotent on `(product_id, code)`: a re-run of an existing code returns the
 * existing variant id and `created: false` before any SKU/item check, so a
 * repeat submit is safe and the other fields are ignored.
 */
export async function registerProductVariant(
  store: ProductStore,
  input: RegisterProductVariantInput,
): Promise<RegisterProductVariantResult> {
  const code = input.code.trim();
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("variant code must not be empty");
  }
  if (sku.length === 0) {
    throw new DomainError("variant SKU must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("variant name must not be empty");
  }
  const sizeRaw = input.size?.trim();
  const size = sizeRaw === undefined || sizeRaw.length === 0 ? null : sizeRaw;
  const finishedGoodItemId = input.finishedGoodItemId ?? null;

  return store.withTransaction(async (tx) => {
    const product = await tx.findProduct(input.productId);
    if (product === undefined || product.organizationId !== input.organizationId) {
      throw new DomainError("product not found in this organization");
    }

    const existing = await tx.findVariantByCode(product.id, code);
    if (existing !== undefined) {
      return { productVariantId: existing.id, created: false };
    }

    const skuHolder = await tx.findVariantBySku(input.organizationId, sku);
    if (skuHolder !== undefined) {
      throw new DomainError("SKU already registered for this organization");
    }

    if (finishedGoodItemId !== null) {
      const item = await tx.findItemScope(finishedGoodItemId);
      if (item === undefined || item.organizationId !== input.organizationId) {
        throw new DomainError("finished-good item not found in this organization");
      }
    }

    const created = await tx.createVariant({
      organizationId: input.organizationId,
      productId: product.id,
      code,
      sku,
      name,
      size,
      finishedGoodItemId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.variantRegistered,
      entityType: "product_variant",
      entityId: created.id,
      after: {
        product_id: product.id,
        code,
        sku,
        name,
        size,
        finished_good_item_id: finishedGoodItemId,
      },
    });

    return { productVariantId: created.id, created: true };
  });
}
