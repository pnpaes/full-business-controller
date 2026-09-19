import { DomainError } from "@aquarela/domain";

import { RECIPE_AUDIT_ACTIONS } from "./actions";
import type { RecipeStore } from "./types";

export interface RegisterAllergenInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  /** True for an allergen that a source ingredient contributes (DATA_DICTIONARY §3). */
  readonly isDerived?: boolean;
}

export interface RegisterAllergenResult {
  readonly allergenId: string;
}

/** Registers an organization-scoped allergen master row (unique `code`). */
export async function registerAllergen(
  store: RecipeStore,
  input: RegisterAllergenInput,
): Promise<RegisterAllergenResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("allergen code must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("allergen name must not be empty");
  }
  const isDerived = input.isDerived ?? false;

  return store.withTransaction(async (tx) => {
    const existing = await tx.findAllergenByCode(input.organizationId, code);
    if (existing !== undefined) {
      throw new DomainError("allergen code already registered for this organization");
    }
    const created = await tx.createAllergen({
      organizationId: input.organizationId,
      code,
      name,
      isDerived,
    });
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECIPE_AUDIT_ACTIONS.allergenRegistered,
      entityType: "allergen",
      entityId: created.id,
      after: { code, name, is_derived: isDerived },
    });
    return { allergenId: created.id };
  });
}
