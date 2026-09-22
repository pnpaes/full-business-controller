import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the adjustment-period slice (`REC-006`, `DEC-027`, row 13b).
 *
 * This mirrors the close/lock access module (`../../period-closes/access.ts`)
 * rather than importing it: the close slice is a different domain. The single
 * authorization primitive (`isAuthorizedFor`, no implicit admin bypass) is still
 * shared through `@aquarela/application`.
 *
 * An `adjustment_period` has **no location dimension** (the table carries only
 * `organization_id`), so unlike the close slice there is no location scope to
 * enforce — authorization is the role check alone.
 *
 * **Provisional:** the reading below is recorded for owner/OPS confirmation.
 */

/** Reading an adjustment period: the seven roles that may see the register. */
export const ADJUSTMENT_PERIOD_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "front_of_house",
  "finance",
  "admin",
  "analyst",
] as const;

/**
 * Opening and closing an adjustment period: read minus `analyst` (read-only) and
 * minus `location_manager`/`front_of_house`. Opening a correction window that
 * re-opens otherwise locked periods is a company-level management action, so it
 * is narrower than a location close: owner, general_manager, finance and admin.
 * `admin` is an explicit grant (there is no implicit admin bypass).
 */
export const ADJUSTMENT_PERIOD_WRITE_ROLES = [
  "owner",
  "general_manager",
  "finance",
  "admin",
] as const;

/** Loads the caller's roles live from server data (ADR-0003). */
export async function loadAdjustmentPeriodAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. Because an adjustment period is
 * organization-scoped with no location dimension, this is a pure role check; a
 * missing/empty role list fails closed.
 */
export function isAdjustmentPeriodAuthorized(
  access: UserAccess,
  roles: readonly string[],
): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}
