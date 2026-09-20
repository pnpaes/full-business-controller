import { DomainError, wouldDriveNegative } from "@aquarela/domain";

import type { InventoryStore } from "./types";

/**
 * Role codes authorized to override DEC-010's negative-stock block.
 *
 * Provisional and fail-closed. Authorization is data-driven (ADR-0003) and the
 * codes are drawn from the existing `ROLE_CODE` vocabulary
 * (`packages/persistence/src/schema/vocabularies.ts`) — no invented code.
 * DEC-010 says "manager permission", and `owner`, `general_manager` and
 * `location_manager` are the owner/manager roles. The owner must confirm
 * exactly which roles grant the override — the next free decision id is
 * `DEC-066` (see `docs/BUILD_ROADMAP.md` §5, "Slice-8 stock-ledger open
 * points"). Until then an actor without one of these codes is rejected, never
 * silently allowed.
 *
 * ponytail: a fixed three-code list, not a permission table — `DEC-066`
 * decides the real grant; fail-closed is the safe ceiling until it lands.
 */
export const NEGATIVE_OVERRIDE_ROLES = ["owner", "general_manager", "location_manager"] as const;

/**
 * DEC-010's restricted emergency path: the caller's `allowNegativeOverride`
 * flag is a request, not an authorization — the actor must hold a qualifying
 * role code loaded from server data (ADR-0003). Throws when it does not.
 */
export async function assertNegativeOverrideAuthorized(
  store: InventoryStore,
  actorId: string,
): Promise<void> {
  const roles = await store.listActorRoleCodes(actorId);
  if (!NEGATIVE_OVERRIDE_ROLES.some((role) => roles.includes(role))) {
    throw new DomainError("negative stock override requires manager permission");
  }
}

/**
 * The shared DEC-010 guard for the posting and reversal paths: the single place
 * that compares the signed delta against the locked balance and decides whether
 * the override was needed. Throws when the posting would go negative without the
 * override; when the override is used it enforces the manager-permission gate and
 * returns `true`. Returns `false` when the guard did not fire.
 */
export async function resolveNegativeOverride(
  store: InventoryStore,
  input: {
    readonly quantityOnHand: string;
    readonly quantityDelta: string;
    readonly allowNegativeOverride: boolean | undefined;
    readonly actorId: string;
  },
): Promise<boolean> {
  if (!wouldDriveNegative(input.quantityOnHand, input.quantityDelta)) {
    return false;
  }
  if (input.allowNegativeOverride !== true) {
    throw new DomainError("posting would drive stock negative");
  }
  // DEC-010's emergency path is a privilege, not a caller flag: the actor must
  // hold a qualifying role loaded from server data (ADR-0003).
  await assertNegativeOverrideAuthorized(store, input.actorId);
  return true;
}
