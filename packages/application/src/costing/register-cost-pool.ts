import { DomainError } from "@aquarela/domain";

import { COSTING_AUDIT_ACTIONS } from "./actions";
import type { CostingStore } from "./types";
import { assertEffectiveRange } from "./validation";

export interface RegisterCostPoolInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface RegisterCostPoolResult {
  readonly costPoolId: string;
}

/**
 * Registers a cost pool or a new version of one (COST-007). `code`/`name` are
 * trimmed and the effective window checked before the transaction; the overlap
 * check against the code's existing versions runs inside it. `cost_pool.code` is
 * versioned, not unique — only **overlapping** windows are illegal, so a
 * non-overlapping successor version is accepted. The check is read-then-write,
 * so `cost_pool_no_overlap` (the exclusion constraint on
 * `(organization_id, code, range)`) remains the concurrency authority.
 */
export async function registerCostPool(
  store: CostingStore,
  input: RegisterCostPoolInput,
): Promise<RegisterCostPoolResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("cost pool code must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("cost pool name must not be empty");
  }
  const effectiveTo = input.effectiveTo ?? null;
  assertEffectiveRange(input.effectiveFrom, effectiveTo);

  return store.withTransaction(async (tx) => {
    const versions = await tx.listCostPoolsByCode(input.organizationId, code);
    const overlaps = versions.some(
      (existing) =>
        (existing.effectiveTo === null || existing.effectiveTo > input.effectiveFrom) &&
        (effectiveTo === null || existing.effectiveFrom < effectiveTo),
    );
    if (overlaps) {
      throw new DomainError(
        "cost pool code already has a version overlapping this effective window",
      );
    }

    const created = await tx.createCostPool({
      organizationId: input.organizationId,
      code,
      name,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COSTING_AUDIT_ACTIONS.costPoolRegistered,
      entityType: "cost_pool",
      entityId: created.id,
      after: { code, name },
    });

    return { costPoolId: created.id };
  });
}
