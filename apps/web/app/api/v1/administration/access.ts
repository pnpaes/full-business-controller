import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Access posture for the Administration read surfaces (`08_UI_UX.md` §8.3),
 * derived from the `07_SECURITY_AND_NFR.md` §7.1 matrix. Every surface here is
 * organization-scoped with **no location dimension** (`unit`,
 * `data_quality_exception` and `audit_event` carry only `organization_id`), so
 * each check is a pure role check. There is no implicit `admin` bypass
 * (`isAuthorizedFor`), so every role is listed explicitly and a missing/empty
 * role list fails closed. Every set lists `owner` (`DEC-130`).
 *
 * - **Units** are catalogue master data (FND-003), read by every role the matrix
 *   grants read on the rows units feed: "Recipes/cost cards" (location_manager
 *   Read, purchasing Read, finance Review, analyst Read, admin As required),
 *   "Supplier/purchases" (location_manager Read, kitchen Read, purchasing Edit,
 *   finance Read, analyst Read) and "Stock/production/waste" (purchasing Read,
 *   finance Read, analyst Read). `front_of_house` is excluded: the matrix gives
 *   it no read on catalogue master data ("Recipes/cost cards" None,
 *   "Supplier/purchases" None).
 *
 * - **Data quality** (§7.9) is a management/oversight surface: exceptions carry
 *   severity, owner, due date and status, and the register is read by the same
 *   set as consolidated reporting (`reports/access.ts`) — owner, general_manager,
 *   location_manager, finance, admin, analyst. The operational roles
 *   (kitchen/front_of_house/purchasing) are excluded; they produce exceptions but
 *   do not review the register.
 *
 * - **Audit** (§7.3) is the most sensitive read and follows the matrix's
 *   "Users/configuration" row (Owner grants, Admin Technical, all others None):
 *   owner, general_manager, admin. Audit events record actor, impersonation
 *   context and before/after diffs across every domain, so the read stays at
 *   governance level rather than the operational or reporting sets.
 *
 * **Provisional:** the reading of the matrix for units and data quality is
 * recorded for owner/OPS confirmation; the audit set is the "Users/configuration"
 * row read directly.
 */

/** Roles that may read the unit register. */
export const ADMIN_UNIT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "purchasing",
  "finance",
  "admin",
  "analyst",
] as const;

/** Roles that may read the data-quality exception register (§7.9). */
export const ADMIN_DATA_QUALITY_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
  "analyst",
] as const;

/** Roles that may read the audit register (§7.3, "Users/configuration" row). */
export const ADMIN_AUDIT_READ_ROLES = ["owner", "general_manager", "admin"] as const;

/** Loads the caller's roles live from server data (ADR-0003). */
export async function loadAdministrationAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A pure role check: every
 * Administration surface is organization-scoped with no location dimension. A
 * missing/empty role list fails closed.
 */
export function isAdministrationAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}
