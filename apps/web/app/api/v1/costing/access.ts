import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the costing write surface, drawn from the
 * `07_SECURITY_AND_NFR.md` access matrix ("Recipes/cost cards"): owner / general
 * manager **Approve**, location manager **Read**, kitchen **Draft/record**,
 * purchasing **Read**, finance **Review**, admin **As required**, analyst
 * **Read**, FOH **None**.
 *
 * Creating a cost card is a draft/record action, so the provisional write set is
 * owner, general_manager, kitchen and admin. `admin` has no implicit bypass
 * (`isAuthorizedFor`), so it is listed explicitly; `finance`'s "Review" and the
 * exact "Draft/record" mapping are recorded as provisional (DEC-111).
 *
 * The `kitchen` inclusion in the write set is **provisional** and awaits
 * owner/OPS confirmation (DEC-111); it must not be treated as settled.
 */
export const COST_CARD_WRITE_ROLES = ["owner", "general_manager", "kitchen", "admin"] as const;

/**
 * Roles that may read cost cards: every matrix role except `front_of_house`
 * (which the `07_SECURITY_AND_NFR.md` "Recipes/cost cards" row scores **None**).
 * `owner`/`general_manager` Approve, `location_manager`/`purchasing`/`analyst`
 * Read, `kitchen` Draft/record, `finance` Review, `admin` As required.
 */
export const COST_CARD_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "purchasing",
  "finance",
  "admin",
  "analyst",
] as const;

/**
 * Channel fee rules (DEC-112) are a cost-card component, so they share the
 * cost-card surface's roles: registering one is the same draft/record action
 * and reading them the same read set. Aliased rather than duplicated so the
 * two surfaces cannot drift.
 */
export const CHANNEL_FEE_RULE_WRITE_ROLES = COST_CARD_WRITE_ROLES;
export const CHANNEL_FEE_RULE_READ_ROLES = COST_CARD_READ_ROLES;

/**
 * Cost centres are the shared overhead/labour master data every Costs surface
 * binds to, so listing them is a **Read** action on the same
 * `07_SECURITY_AND_NFR.md` "Recipes/cost cards" row. Aliased to the cost-card
 * read set (owner / general manager / location manager / kitchen / purchasing /
 * finance / admin / analyst; `front_of_house` scores None) so the two surfaces
 * cannot drift.
 */
export const COST_CENTER_READ_ROLES = COST_CARD_READ_ROLES;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadCostingAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A caller with no location scope
 * (owner / general manager / admin / analyst) is organization-wide and is
 * checked on role alone; a location-scoped caller must also hold `locationId`
 * (`07_SECURITY_AND_NFR.md` §7.1). A missing/empty role list fails closed.
 */
export function isCostingAuthorized(
  access: UserAccess,
  roles: readonly string[],
  locationId?: string,
): boolean {
  const scoped = access.locationIds.length > 0 && locationId !== undefined;
  return roles.some((role) => isAuthorizedFor(access, scoped ? { role, locationId } : { role }));
}
