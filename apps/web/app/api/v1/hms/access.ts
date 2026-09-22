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

/**
 * Role sets for the IK-mat checklist slice (`HMS-005`, `DEC-091`, `DEC-096`),
 * implementing `DEC-096` exactly. Unlike incidents (`DEC-095`) an `analyst` may
 * read checklists — they are operational records like the monitoring logs — and
 * `purchasing`/`finance` get nothing. There is no implicit admin bypass
 * (`isAuthorizedFor`), so `admin` appears only where `DEC-096` grants it: it may
 * read and write templates and record runs.
 */
export const HMS_CHECKLIST_TEMPLATE_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
  "analyst",
] as const;

/** Authoring/replacing a template is a managed configuration write. */
export const HMS_CHECKLIST_TEMPLATE_WRITE_ROLES = ["owner", "general_manager", "admin"] as const;

export const HMS_CHECKLIST_RUN_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
  "analyst",
] as const;

/** Recording a run is operational; kitchen/front_of_house may walk a checklist. */
export const HMS_CHECKLIST_RUN_RECORD_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
] as const;

/**
 * Role sets for the equipment register (`HMS-006`, `DEC-092`, `DEC-097`),
 * implementing `DEC-097` exactly. `analyst` reads the register but never writes
 * it, and `purchasing`/`finance` get nothing. There is no implicit admin bypass
 * (`isAuthorizedFor`), so `admin` appears only where `DEC-097` grants it: it may
 * read and write.
 */
export const HMS_EQUIPMENT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
  "analyst",
] as const;

/** Registering or amending equipment is a managed write; operators may not. */
export const HMS_EQUIPMENT_WRITE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
] as const;

/**
 * Role sets for the equipment maintenance fact log (`HMS-006`, `DEC-092`,
 * `DEC-097`). Reading mirrors the equipment register (`analyst` included,
 * `purchasing`/`finance` excluded); recording is operational like a checklist
 * run — kitchen/front_of_house may record, `analyst` may read but not record.
 */
export const HMS_MAINTENANCE_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
  "analyst",
] as const;

export const HMS_MAINTENANCE_RECORD_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "admin",
] as const;

/**
 * Role set for the compliance/evidence export (`DEC-093`, clarified by
 * `DEC-098`): owner / general_manager / location_manager / admin. The bundle is
 * fail-closed — it requires read on **every** source it includes, so `analyst`
 * is denied (it has no incident/corrective-action read, `DEC-095`), as are
 * `kitchen`/`front_of_house` (a bulk sensitive export is a management action
 * even though they hold operational read) and `purchasing`/`finance`. There is
 * no implicit admin bypass (`isAuthorizedFor`), so `admin` is listed explicitly
 * per `DEC-098`.
 */
export const HMS_COMPLIANCE_EXPORT_ROLES = [
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
