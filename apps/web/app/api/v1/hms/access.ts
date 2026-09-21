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

/**
 * Role sets for the HMS incident register (`HMS-003`, `DEC-090`), per the
 * `DEC-095` clarification of the `07_SECURITY_AND_NFR.md` access matrix. Unlike
 * the monitoring-log row there is no `analyst` read: `analyst`, `finance` and
 * `purchasing` have no access to incidents or corrective actions at all. `admin`
 * is granted explicitly per row (no implicit admin bypass): it may read and
 * close/reopen (`EDIT`) but not create.
 */
export const HMS_INCIDENT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
] as const;

/** kitchen / front_of_house may raise an incident but cannot edit or close it. */
export const HMS_INCIDENT_CREATE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
] as const;

/** Closing/reopening an incident is an edit; operators may not. */
export const HMS_INCIDENT_EDIT_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
] as const;

/** Role sets for corrective actions (`HMS-004`, `DEC-090`, `DEC-095`). */
export const HMS_CORRECTIVE_ACTION_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
] as const;

export const HMS_CORRECTIVE_ACTION_CREATE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
] as const;

/**
 * An operator (kitchen / front_of_house) may progress an action to
 * `in_progress`/`done` but never `verified` — that transition additionally
 * requires one of `HMS_CORRECTIVE_ACTION_VERIFY_ROLES`.
 */
export const HMS_CORRECTIVE_ACTION_EDIT_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
  "kitchen",
  "front_of_house",
] as const;

/** A verifier is a manager-level role; operators can never verify an action. */
export const HMS_CORRECTIVE_ACTION_VERIFY_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
] as const;

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
