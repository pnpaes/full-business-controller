import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role set for the AI-advisory review reads (`GET /api/v1/ai/suggestions`).
 *
 * **Provisional:** `DEC-101` leaves the AI/approval access rows unset, so there
 * is no matrix row to cite. This is a fail-closed placeholder that mirrors the
 * report/forecast read set (owner / general_manager / finance / admin) until a
 * decision assigns the row; `location_manager`, the operational roles and
 * `analyst` get nothing, and `admin` is an explicit grant (there is no implicit
 * bypass). Narrow or widen it only against a recorded decision.
 */
export const AI_READ_ROLES = ["owner", "general_manager", "finance", "admin"] as const;

/**
 * Role set for the AI-advisory decisions
 * (`POST /api/v1/ai/suggestions/[id]/approve|reject`).
 *
 * Read is finance-inclusive; a **decision** is a human judgement that will
 * influence operations, so `finance` is deliberately excluded and only the
 * administrative roles may act. Like the read set this is provisional pending
 * `DEC-101`; `admin` is an explicit grant (no implicit bypass).
 */
export const AI_DECIDE_ROLES = ["owner", "general_manager", "admin"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadAiAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`, fail-closed (mirrors
 * `isJobsAuthorized`). Suggestions are organization-level with no location
 * column, so this is a pure role check; a missing/empty role list denies.
 */
export function isAiAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}
