import {
  buildComplianceExport,
  createPostgresHmsStore,
  type ComplianceExportBundle,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { HMS_COMPLIANCE_EXPORT_ROLES, isHmsAuthorized, loadHmsAccess } from "../access";
import { parseComplianceExportQuery } from "../compliance-export-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The organization's compliance/evidence export bundle (`DEC-093`, clarified by
 * `DEC-098`): the monitoring readings, incidents, corrective actions, checklist
 * runs and maintenance logs for an optional inclusive `from`/`to` window, in one
 * serialisable JSON object. It is a sensitive bulk read and writes one
 * `hms.compliance_export.generated` audit fact (the application does that).
 *
 * Query: optional `from`/`to` ISO instants (both inclusive, either open-ended).
 * Response: the application's `ComplianceExportBundle` verbatim via `jsonOk` —
 * `{ ok: true, …bundle }` — not a reshaped payload. Signed out → 401; a role
 * outside the export set (owner / general_manager / location_manager / admin —
 * `analyst`, `kitchen`, `front_of_house`, `purchasing` and `finance` are denied,
 * `DEC-098`) → 403; a malformed `from`/`to` or `from > to` → 400. Never returns
 * another organization's records (`DEC-061`).
 *
 * Location scope is enforced by the application query, not here: the caller's
 * `access.locationIds` are forwarded and a scoped caller is bounded to their
 * locations. An unscoped caller (owner / GM / admin) gets the organization-wide
 * bundle. `corrective_action` and `maintenance_log` carry no `location_id` and
 * are scoped by the application through their incident/equipment parents
 * (`DEC-098`), so the route does not attempt to scope them.
 *
 * There is deliberately no `locationId` parameter. The export is either the
 * whole organization (unscoped caller) or exactly the caller's own scope (scoped
 * caller) — a per-location *filter* would only ever narrow a scoped caller, who
 * needs no help because their scope is already server-derived, and accepting one
 * from an unscoped caller would either be ignored (silently widening the request
 * to the whole organization) or would have to be honoured (`DEC-098` grants
 * owner/GM/admin an organization-wide export regardless of any `locationId`).
 * Ignoring a supplied value is the silent-widen hazard this route refuses, so an
 * unknown `locationId` is simply not read — the request shape has no field for
 * it, rather than a field that is discarded.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_COMPLIANCE_EXPORT_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseComplianceExportQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const bundle: ComplianceExportBundle = await buildComplianceExport(store, {
      organizationId,
      actorId: session.userId,
      // An unscoped caller has an empty `locationIds`; forwarding `[]` would
      // wrongly read as "scoped to nothing". Empty scope = organization-wide
      // (`access.ts`), so forward `undefined` for it (the application also
      // defends against `[]`, but neither layer should reintroduce the bug).
      locationIds: access.locationIds.length > 0 ? access.locationIds : undefined,
      ...parsed.query,
    });

    return jsonOk({ ...bundle });
  });
}
