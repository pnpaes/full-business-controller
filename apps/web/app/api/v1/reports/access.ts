import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the sales & margin reporting read model (`RPT-001`–`RPT-003`,
 * row 13c). This mirrors the workforce/HMS access modules rather than importing
 * one: the reporting slice is its own domain and the role set is provisional
 * (recorded under `DEC-108`), so keeping it here makes the rule readable at the
 * route call site. The single authorization primitive (`isAuthorizedFor`, no
 * implicit admin bypass) is shared through `@aquarela/application`.
 *
 * The provisional read set is owner, general_manager, location_manager
 * (location-scoped), finance, admin and analyst. The operational roles
 * (`kitchen`, `front_of_house`, `purchasing`) are excluded — they act on stock
 * and sales but do not read consolidated margin. `admin` is an explicit grant
 * (there is no implicit admin bypass), and `analyst` is granted the aggregate
 * read the matrix reserves for reporting.
 */
export const SALES_REPORT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
  "analyst",
] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadReportingAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`, mirroring `isWorkforceAuthorized`
 * (`workforce/access.ts`). A caller with no location scope (owner / general
 * manager / finance / admin / analyst) is organization-wide and is checked on
 * role alone; a location-scoped caller (`access.locationIds` non-empty) must
 * also hold `locationId` when one is supplied (`07_SECURITY_AND_NFR.md` §7.1).
 * Calling it with no `locationId` is a pure role check. A missing/empty role
 * list fails closed.
 */
export function isReportingAuthorized(
  access: UserAccess,
  roles: readonly string[],
  locationId?: string,
): boolean {
  const scoped = access.locationIds.length > 0 && locationId !== undefined;
  return roles.some((role) => isAuthorizedFor(access, scoped ? { role, locationId } : { role }));
}
