import { DomainError, MONEY_SCALE, parseDecimal } from "@aquarela/domain";

import { PRODUCT_AUDIT_ACTIONS } from "./actions";
import type { ProductStore } from "./types";

export interface SetAddonApplicabilityInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly addonProductId: string;
  readonly baseProductId: string;
  /** numeric(19,4); a fixed surcharge (or discount when negative), or absent. */
  readonly priceEffect?: string | null;
}

export interface SetAddonApplicabilityResult {
  readonly addonApplicabilityId: string;
  /** False when the pair was already registered (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Declares that one product may be sold as an add-on to another (`DEC-128`).
 * Validated at this boundary:
 *
 * - a product may not be its own add-on (`addon_applicability_distinct_products_check`);
 * - both products exist and belong to the organization;
 * - `priceEffect`, when supplied, is a numeric(19,4) decimal (never a float) and
 *   may be negative (a discount) or positive (a surcharge).
 *
 * Idempotent on the `(addonProductId, baseProductId)` pair: the schema has no
 * unique key on the pair (only the self-reference check), so the pair is
 * resolved by lookup here and a repeat returns the existing row with
 * `created: false`. ponytail: this is best-effort under concurrency — two
 * simultaneous first-time writes could each insert; a unique index is the
 * upgrade path if that ever matters.
 */
export async function setAddonApplicability(
  store: ProductStore,
  input: SetAddonApplicabilityInput,
): Promise<SetAddonApplicabilityResult> {
  if (input.addonProductId === input.baseProductId) {
    throw new DomainError("a product cannot be its own add-on");
  }
  const priceEffectRaw = input.priceEffect?.trim();
  const priceEffect =
    priceEffectRaw === undefined || priceEffectRaw.length === 0 ? null : priceEffectRaw;
  if (priceEffect !== null) {
    // Throws `DomainError` for anything that is not a numeric(19,4) decimal.
    parseDecimal(priceEffect, MONEY_SCALE);
  }

  return store.withTransaction(async (tx) => {
    const [addon, base] = await Promise.all([
      tx.findProduct(input.addonProductId),
      tx.findProduct(input.baseProductId),
    ]);
    if (addon === undefined || addon.organizationId !== input.organizationId) {
      throw new DomainError("add-on product not found in this organization");
    }
    if (base === undefined || base.organizationId !== input.organizationId) {
      throw new DomainError("base product not found in this organization");
    }

    const existing = await tx.findAddonApplicability(addon.id, base.id);
    if (existing !== undefined) {
      return { addonApplicabilityId: existing.id, created: false };
    }

    const created = await tx.createAddonApplicability({
      organizationId: input.organizationId,
      addonProductId: addon.id,
      baseProductId: base.id,
      priceEffect,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.addonApplicabilitySet,
      entityType: "addon_applicability",
      entityId: created.id,
      after: {
        addon_product_id: addon.id,
        base_product_id: base.id,
        price_effect: priceEffect,
      },
    });

    return { addonApplicabilityId: created.id, created: true };
  });
}
