import { DomainError } from "@aquarela/domain";

import { CATALOG_AUDIT_ACTIONS } from "./actions";
import type { MasterDataStore } from "./types";

const DEFAULT_CURRENCY = "NOK";
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

export interface RegisterSupplierInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  readonly contact?: string | null;
  readonly terms?: string | null;
  /** Defaults to the organization's currency, then `NOK`. */
  readonly currency?: string;
}

export interface RegisterSupplierResult {
  readonly supplierId: string;
  /** False when a supplier with this code already existed (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Registers a known supplier (`supplier`, DEC-047). Idempotent on the natural
 * key `(organization_id, code)` — `code` is the only uniqueness the schema
 * enforces (`supplier_organization_id_code_key`); `name` is not unique, so a
 * re-run of the same code returns the existing supplier instead of colliding.
 *
 * The currency defaults to the served organization's currency so a supplier
 * inherits the books' currency unless stated otherwise; an ad-hoc grocery
 * purchase is a `cost_observation`, not a supplier (DEC-047).
 */
export async function registerSupplier(
  store: MasterDataStore,
  input: RegisterSupplierInput,
): Promise<RegisterSupplierResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("supplier code must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("supplier name must not be empty");
  }
  const currencyInput = input.currency?.trim().toUpperCase();
  if (
    currencyInput !== undefined &&
    currencyInput.length > 0 &&
    !CURRENCY_PATTERN.test(currencyInput)
  ) {
    throw new DomainError("currency must be a 3-letter ISO code");
  }
  const contact = input.contact?.trim();
  const terms = input.terms?.trim();

  return store.withTransaction(async (tx) => {
    const existing = await tx.findSupplierByCode(input.organizationId, code);
    if (existing !== undefined) {
      return { supplierId: existing.id, created: false };
    }

    const organization = await tx.findOrganization(input.organizationId);
    const currency =
      currencyInput !== undefined && currencyInput.length > 0
        ? currencyInput
        : (organization?.currency ?? DEFAULT_CURRENCY);

    const created = await tx.createSupplier({
      organizationId: input.organizationId,
      code,
      name,
      contact: contact === undefined || contact.length === 0 ? null : contact,
      terms: terms === undefined || terms.length === 0 ? null : terms,
      currency,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CATALOG_AUDIT_ACTIONS.supplierRegistered,
      entityType: "supplier",
      entityId: created.id,
      after: { code, name, currency },
    });

    return { supplierId: created.id, created: true };
  });
}
