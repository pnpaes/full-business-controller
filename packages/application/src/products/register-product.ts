import { DomainError } from "@aquarela/domain";
import { PRODUCT_KIND } from "@aquarela/persistence";

import { PRODUCT_AUDIT_ACTIONS } from "./actions";
import type { ProductStore } from "./types";

export interface RegisterProductInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  readonly category?: string | null;
  /** One of `PRODUCT_KIND` (`base` / `variant` / `add_on`); defaults to `base`. */
  readonly productKind?: string;
}

export interface RegisterProductResult {
  readonly productId: string;
  /** False when a product with this code already existed (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Registers a product (`DEC-128`) — the grouping identity that variants hang
 * off. Idempotent on the natural key `(organization_id, code)`:
 * `product_organization_id_code_key` is the only uniqueness the schema
 * enforces, so a re-run of an existing code returns the existing product id and
 * `created: false` rather than colliding or duplicating.
 *
 * `productKind` is checked against the schema vocabulary here so an unknown
 * value fails with a message instead of a raw CHECK violation. `activeFrom`
 * defaults to the current date at the database (`current_date`), so a
 * registration never back-dates itself.
 */
export async function registerProduct(
  store: ProductStore,
  input: RegisterProductInput,
): Promise<RegisterProductResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("product code must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("product name must not be empty");
  }
  const productKind = (input.productKind ?? "base").trim();
  if (!(PRODUCT_KIND as readonly string[]).includes(productKind)) {
    throw new DomainError(`product kind must be one of ${PRODUCT_KIND.join(", ")}`);
  }
  const categoryRaw = input.category?.trim();
  const category = categoryRaw === undefined || categoryRaw.length === 0 ? null : categoryRaw;

  return store.withTransaction(async (tx) => {
    const existing = await tx.findProductByCode(input.organizationId, code);
    if (existing !== undefined) {
      return { productId: existing.id, created: false };
    }

    const created = await tx.createProduct({
      organizationId: input.organizationId,
      code,
      name,
      category,
      productKind,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.productRegistered,
      entityType: "product",
      entityId: created.id,
      after: { code, name, category, product_kind: productKind },
    });

    return { productId: created.id, created: true };
  });
}
