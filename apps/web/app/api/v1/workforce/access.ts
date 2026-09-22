import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the workforce personnel slice (`DEC-087`, `DEC-099`),
 * implementing `DEC-099` item 6 exactly.
 *
 * This mirrors the HMS access module (`../hms/access.ts`) rather than importing
 * it: the HMS module is named for, and its comments cite, the HMS matrix rows,
 * and the workforce slice is a different domain whose role sets differ (notably
 * `finance` holds employee records but is excluded from personnel documents).
 * Reusing an `isHmsAuthorized` helper for workforce routes would couple the two
 * domains and make the access rule harder to read at the call site. The single
 * authorization primitive (`isAuthorizedFor`, no implicit admin bypass) is still
 * shared through `@aquarela/application`.
 */

/**
 * The `employee` matrix row (`07_SECURITY_AND_NFR.md:17`): read and write =
 * owner, general_manager, location_manager (location-scoped), finance, admin.
 * `analyst` and the operational roles (`kitchen`, `front_of_house`,
 * `purchasing`) get nothing. There is no implicit admin bypass, so `admin` is
 * listed explicitly.
 */
export const WORKFORCE_EMPLOYEE_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
] as const;

/** Writing an employee follows the same matrix row as reading it. */
export const WORKFORCE_EMPLOYEE_WRITE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
] as const;

/**
 * Personnel documents (`employee_document`, `DEC-099` item 6): owner,
 * general_manager and admin only. `finance` is deliberately **excluded** even
 * though it may read and write the employee record itself — the asymmetry is
 * explicit in the decision — and so are `location_manager`, `kitchen`,
 * `front_of_house`, `purchasing` and `analyst`. Document routes carry **no**
 * location scope (the roles are org-wide and the table has no location column).
 */
export const WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES = [
  "owner",
  "general_manager",
  "admin",
] as const;

export const WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES = [
  "owner",
  "general_manager",
  "admin",
] as const;

/**
 * Shift planning and rota (`shift`/`shift_assignment`, `WF-002`/`WF-003`,
 * `DEC-037`): the matrix row is readable by owner, general_manager,
 * location_manager (location-scoped), kitchen, front_of_house, finance and
 * admin. `analyst` and `purchasing` get nothing; `admin` is an explicit grant
 * (there is no implicit admin bypass).
 */
export const SHIFT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "finance",
  "admin",
] as const;

/**
 * Writing a shift — create, update, publish, cancel, complete, assign and
 * withdraw — is narrower than reading it: owner, general_manager,
 * location_manager (location-scoped) and admin. `kitchen`/`front_of_house` may
 * read the rota but not plan it, and `finance` may read but not write.
 */
export const SHIFT_WRITE_ROLES = ["owner", "general_manager", "location_manager", "admin"] as const;

/**
 * The derived worked-hours report (`WF-004`) is payroll-input data and is
 * restricted by `07_SECURITY_AND_NFR.md` §7.1 to owner, general_manager,
 * location_manager (location-scoped), finance and admin. This is deliberately
 * narrower than `SHIFT_READ_ROLES`: `kitchen`, `front_of_house`, `purchasing`
 * and `analyst` may see the rota or cost data elsewhere but must not read the
 * hours that feed payroll. `admin` is an explicit grant (no implicit bypass).
 */
export const WORKED_HOURS_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadWorkforceAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`, mirroring `isHmsAuthorized`
 * (`../hms/access.ts:223`). A caller with no location scope (owner / general
 * manager / finance / admin) is organization-wide and is checked on role alone;
 * a location-scoped caller (`access.locationIds` non-empty) must also hold
 * `locationId` when one is supplied (`07_SECURITY_AND_NFR.md` §7.1). Calling it
 * with no `locationId` is therefore a pure role check, which is what the
 * org-wide document routes use. A missing/empty role list fails closed.
 */
export function isWorkforceAuthorized(
  access: UserAccess,
  roles: readonly string[],
  locationId?: string,
): boolean {
  const scoped = access.locationIds.length > 0 && locationId !== undefined;
  return roles.some((role) => isAuthorizedFor(access, scoped ? { role, locationId } : { role }));
}

/**
 * The fail-closed location gate for `employee.primary_location_id` (nullable).
 * An org-wide caller (`locationIds` empty) is unconstrained; a location-scoped
 * caller may touch only an employee whose primary location is **non-null** and
 * in scope. An employee with a NULL primary location is not visible to a scoped
 * caller — fail-closed, so a scoped manager can neither read nor amend a record
 * they could not otherwise manage. This is also what denies a scoped caller a
 * body `primaryLocationId` of `null` on create/patch (they would be writing a
 * row into no scope at all).
 */
export function isEmployeeInLocationScope(
  access: UserAccess,
  primaryLocationId: string | null,
): boolean {
  if (access.locationIds.length === 0) {
    return true;
  }
  return primaryLocationId !== null && access.locationIds.includes(primaryLocationId);
}
