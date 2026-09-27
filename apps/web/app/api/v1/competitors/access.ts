import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Access posture for the competitor-observation slice (`DEC-126`, provisional;
 * owner confirmation required). The `07_SECURITY_AND_NFR.md` matrix has no
 * `competitor`/`competitor_observation` row, so this slice supplies one:
 *
 * - **Read** (register, observations, comparison) is granted to the intelligence
 *   audience — `owner`, `general_manager`, `location_manager`, `finance`,
 *   `admin`, `analyst` (the `DEC-108` sales-report read set).
 * - **Write** (register a competitor, capture an observation) and the
 *   **review gate** (`review`/`reject`) are granted to `owner`,
 *   `general_manager`, `admin`, `location_manager`.
 *
 * Neither table has a `location_id`, so a location manager's authority is
 * **organization-wide** — a known over-broad ceiling, recorded rather than
 * hidden. There is no implicit `admin` bypass (`isAuthorizedFor`), so every role
 * is listed explicitly and a missing/empty role list fails closed.
 */
export const COMPETITOR_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "finance",
  "admin",
  "analyst",
] as const;

export const COMPETITOR_WRITE_ROLES = [
  "owner",
  "general_manager",
  "admin",
  "location_manager",
] as const;

/**
 * The **terms-approval** bar for a competitor source (`ADR-0010`/`DEC-143`).
 * Approving or rejecting a source's terms is a higher bar than capturing an
 * observation: only `owner`/`admin` may decide legal/terms status. Registering
 * an `automated` source likewise requires this set, because that registration
 * records the approval that enables automation.
 */
export const COMPETITOR_TERMS_ROLES = ["owner", "admin"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadCompetitorAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A pure role check — neither table has
 * a location column, so no location scope is applied (the `task`/`document`
 * slice precedent). A missing/empty role list fails closed.
 */
export function isCompetitorAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}

/** True when the caller may register a competitor or capture an observation. */
export function canWriteCompetitors(access: UserAccess): boolean {
  return isCompetitorAuthorized(access, COMPETITOR_WRITE_ROLES);
}

/** True when the caller may approve/reject a source's terms (owner/admin). */
export function canManageCompetitorTerms(access: UserAccess): boolean {
  return isCompetitorAuthorized(access, COMPETITOR_TERMS_ROLES);
}
