import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Access posture for the task slice (`DEC-122`, provisional; owner confirmation
 * required). The `07_SECURITY_AND_NFR.md` matrix has no `task` row (`DEC-101`
 * recorded access as unset), so `DEC-122` supplies one:
 *
 * - **Read** is granted to every authenticated role — a task is operational
 *   work that anyone may see.
 * - **Create / assign / transition** is granted to `owner`, `general_manager`,
 *   `admin` and `location_manager`.
 *
 * `task` has **no `location_id`** (`DEC-101`), so a location manager's write
 * authority here is **organization-wide** — a known over-broad ceiling, recorded
 * rather than silently accepted. Upgrade path: a `location_id` column (or a join
 * to the linked entity) plus a location-scoped check in `isTaskAuthorized`.
 *
 * There is no implicit `admin` bypass (`isAuthorizedFor`), so every role is
 * listed explicitly and a missing/empty role list fails closed.
 */
export const TASK_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "purchasing",
  "finance",
  "admin",
  "analyst",
  "product_owner",
  "technical_owner",
  "data_owner",
] as const;

export const TASK_WRITE_ROLES = ["owner", "general_manager", "admin", "location_manager"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadTaskAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A pure role check — `task` has no
 * location column, so no location scope is applied (the `document` slice's
 * precedent, and the recorded `DEC-122` organization-wide ceiling). A
 * missing/empty role list fails closed.
 */
export function isTaskAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}

/** True when the caller may create, assign or transition a task. */
export function canWriteTasks(access: UserAccess): boolean {
  return isTaskAuthorized(access, TASK_WRITE_ROLES);
}
