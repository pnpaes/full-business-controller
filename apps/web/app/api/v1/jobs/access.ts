import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role set for the job projection route (`DEC-139` item 5).
 *
 * **Provisional:** `DEC-101` leaves job/approval access unset, so there is no
 * matrix row to cite. This is a fail-closed placeholder that mirrors the
 * payroll-input report read set (owner / general_manager / finance / admin) until
 * a decision assigns the row; `location_manager`, the operational roles and
 * `analyst` get nothing, and `admin` is an explicit grant (there is no implicit
 * admin bypass). Narrow or widen it only against a recorded decision.
 */
export const JOBS_READ_ROLES = ["owner", "general_manager", "finance", "admin"] as const;

/**
 * Role set for the DLQ-review mutations (`POST /api/v1/jobs/[id]/retry|discard`).
 *
 * Read is finance-inclusive (`JOBS_READ_ROLES`, a progress-poll concern);
 * retry/discard are **admin-level operational actions** on the queue, so
 * `finance` is deliberately excluded and only the administrative roles may act.
 * Like the read set this is provisional pending `DEC-101`; narrow or widen it only
 * against a recorded decision. `admin` is an explicit grant (no implicit bypass).
 */
export const JOBS_ADMIN_ROLES = ["owner", "general_manager", "admin"] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadJobsAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`, fail-closed (mirrors
 * `isWorkforceAuthorized`). The `job` projection is organization-level with no
 * location column, so there is no location scope to apply and this is a pure
 * role check; a missing/empty role list denies.
 */
export function isJobsAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}
