import { isAuthorizedFor, type UserAccess } from "@aquarela/application";

/**
 * Write-side access for the forecast-tracking surface (`DEC-011`, `DEC-138`).
 *
 * The **read** gate is not declared here: the tracking view is readable by the
 * same set as the forecast it tracks, so the routes reuse
 * `SALES_REPORT_READ_ROLES` / `isReportingAuthorized` from
 * `../reports/access.ts` rather than keeping a second copy of that rule.
 *
 * **Write/override** is governance-level — `owner`, `general_manager`, `admin`.
 * Recording a snapshot fixes a model's projection as an auditable fact for later
 * comparison, and an override is a reasoned annotation of it, so both stay with
 * the roles that own the forecast posture. `owner` is listed explicitly
 * (`DEC-130`); there is no implicit owner/admin bypass, and a missing/empty role
 * list fails closed.
 */
export const FORECAST_WRITE_ROLES = ["owner", "general_manager", "admin"] as const;

/**
 * True when `access` holds one of the forecast write roles. A pure role check:
 * this surface is organization-scoped with no location dimension (a snapshot's
 * location is an explicit filter the command normalises, not a caller scope).
 */
export function isForecastWriteAuthorized(
  access: UserAccess,
  roles: readonly string[] = FORECAST_WRITE_ROLES,
): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}
