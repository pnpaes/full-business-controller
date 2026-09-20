import { DomainError, Unit, type UnitDimension } from "@aquarela/domain";

import type { MasterDataStore, MasterUnit } from "./types";

export interface RegisterUnitInput {
  readonly organizationId: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase?: boolean;
}

export interface RegisterUnitResult {
  readonly unitId: string;
  /** False when a unit with this code already existed (idempotent re-run). */
  readonly created: boolean;
}

/**
 * Registers a unit of measure (FND-003). Idempotent on the natural key
 * `(organization_id, code)`: a re-run returns the existing unit instead of
 * colliding. The dimension is validated through the domain `Unit` value object,
 * so an unknown dimension never reaches the database.
 */
export async function registerUnit(
  store: MasterDataStore,
  input: RegisterUnitInput,
): Promise<RegisterUnitResult> {
  const code = input.code.trim();
  if (code.length === 0) {
    throw new DomainError("unit code must not be empty");
  }
  const isBase = input.isBase ?? false;
  Unit.from(code, input.dimension, isBase);

  return store.withTransaction(async (tx) => {
    const existing = await tx.findUnitByCode(input.organizationId, code);
    if (existing !== undefined) {
      return { unitId: existing.id, created: false };
    }
    const created: MasterUnit = await tx.createUnit({
      organizationId: input.organizationId,
      code,
      dimension: input.dimension,
      isBase,
    });
    return { unitId: created.id, created: true };
  });
}
