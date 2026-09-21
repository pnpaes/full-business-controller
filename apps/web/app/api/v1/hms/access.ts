import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role codes for the HMS monitoring-log routes, drawn from the
 * `07_SECURITY_AND_NFR.md` access matrix ("HMS monitoring logs"): owner / general
 * manager, location manager, analyst read; kitchen and FOH record; purchasing and
 * finance have no access; `admin` is "as required" and granted explicitly per
 * row. There is no implicit admin bypass (`isAuthorizedFor`), so `admin` appears
 * only where the matrix grants read access — it may read but not record.
 *
 * ponytail: fixed role-code lists, not a permission table — the matrix is the
 * authority and a permission table would need its own migration and decision.
 */
export const HMS_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
  "analyst",
] as const;

/** Operational roles (location_manager / kitchen / front_of_house) that may record. */
export const HMS_RECORD_ROLES = ["location_manager", "kitchen", "front_of_house"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadHmsAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A caller with no location scope
 * (owner / general manager / admin / analyst) is organization-wide and is checked
 * on role alone; a location-scoped caller (`access.locationIds` non-empty) must
 * also hold `locationId` when one is supplied (`07_SECURITY_AND_NFR.md` §7.1 —
 * "role plus location scope enforced server-side in services and queries"). A
 * missing/empty role list fails closed.
 */
export function isHmsAuthorized(
  access: UserAccess,
  roles: readonly string[],
  locationId?: string,
): boolean {
  const scoped = access.locationIds.length > 0 && locationId !== undefined;
  return roles.some((role) => isAuthorizedFor(access, scoped ? { role, locationId } : { role }));
}
