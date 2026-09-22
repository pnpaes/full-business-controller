import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the close/lock slice (`REC-003`, `REC-006`, `DEC-027`, row 13a).
 *
 * This mirrors the workforce access module (`../../workforce/access.ts`) rather
 * than importing it: the workforce module is named for, and its comments cite,
 * the workforce matrix rows, and the close slice is a different domain. The
 * single authorization primitive (`isAuthorizedFor`, no implicit admin bypass)
 * is still shared through `@aquarela/application`.
 *
 * **Provisional** (`DEC-105`): the reading below of the Sales/reconciliation
 * matrix row — owner Full, location_manager Assigned, front_of_house "Close
 * tasks", finance Full, admin As-required, analyst Read, kitchen/purchasing None
 * — is recorded for owner/OPS confirmation.
 */

/** Reading a close: the seven roles that may see the close register. */
export const PERIOD_CLOSE_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "front_of_house",
  "finance",
  "admin",
  "analyst",
] as const;

/**
 * Beginning and locking a close: read minus `analyst` (read-only). A
 * location-scoped caller is additionally bounded to the scope's location; a
 * `company`-scope write additionally requires `PERIOD_CLOSE_COMPANY_WRITE_ROLES`.
 */
export const PERIOD_CLOSE_WRITE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "front_of_house",
  "finance",
  "admin",
] as const;

/**
 * A `company`-scope begin/lock (the whole-organization month close) is a
 * company-level action, so it is narrower than a location close: owner,
 * general_manager, finance and admin. `location_manager` and `front_of_house`
 * may close a location but not the company month. `admin` is an explicit grant
 * (there is no implicit admin bypass).
 */
export const PERIOD_CLOSE_COMPANY_WRITE_ROLES = [
  "owner",
  "general_manager",
  "finance",
  "admin",
] as const;

/**
 * Reopening a locked period (`DEC-027`: "explicit reopen only with elevated
 * permission, reason and audit") is the elevated path, so it is owner,
 * general_manager, finance and admin. `location_manager`, `front_of_house` and
 * `analyst` may not reopen. `admin` is an explicit grant (no implicit bypass).
 */
export const PERIOD_CLOSE_REOPEN_ROLES = ["owner", "general_manager", "finance", "admin"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadPeriodCloseAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`, mirroring `isWorkforceAuthorized`
 * (`../../workforce/access.ts:158`). A caller with no location scope (owner /
 * general_manager / finance / admin) is organization-wide and is checked on role
 * alone; a location-scoped caller (`access.locationIds` non-empty) must also hold
 * `locationId` when one is supplied. Calling it with no `locationId` is therefore
 * a pure role check, which is what the company-scope and reopen checks use. A
 * missing/empty role list fails closed.
 */
export function isPeriodCloseAuthorized(
  access: UserAccess,
  roles: readonly string[],
  locationId?: string,
): boolean {
  const scoped = access.locationIds.length > 0 && locationId !== undefined;
  return roles.some((role) => isAuthorizedFor(access, scoped ? { role, locationId } : { role }));
}
