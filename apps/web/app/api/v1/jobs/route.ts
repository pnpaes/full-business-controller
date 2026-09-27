import { listJobs } from "@aquarela/persistence";

import { getDb } from "../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { isJobsAuthorized, JOBS_READ_ROLES, loadJobsAccess } from "./access";
import { parseJobsListQuery, toJobRows } from "./job-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The served organization's job projections (`DEC-139` item 5), newest first.
 *
 * Query: optional `status` (one of the `job_status` allow-list: `pending`,
 * `running`, `succeeded`, `failed`, `dead_lettered`) and `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`, each row the same shape as
 * `GET /api/v1/jobs/[id]` — **no `payload`/`error`**. Signed out → 401; a role
 * outside `JOBS_READ_ROLES` (provisional, `DEC-101` unset) → 403; a malformed
 * filter or paging value → 400. Never returns another organization's data
 * (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadJobsAccess(session.userId);
    if (!isJobsAuthorized(access, JOBS_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseJobsListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const jobs = await listJobs(getDb().db, {
      organizationId,
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toJobRows(jobs),
    });
  });
}
