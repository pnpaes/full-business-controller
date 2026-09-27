import { findJobById } from "@aquarela/persistence";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isJobsAuthorized, JOBS_READ_ROLES, loadJobsAccess } from "../access";
import { JOB_ID_PATTERN, toJobRow } from "../job-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One job projection by id (`DEC-139` item 5) — the progress endpoint a future
 * producer points at with `202 + Location` when a command enqueues work (no
 * route returns 202 yet; nothing in this slice enqueues).
 *
 * Signed out → 401; a role outside `JOBS_READ_ROLES` (provisional, `DEC-101`
 * unset) → 403; a non-UUID id → 400. The read is organization-scoped, so an
 * unknown or other-organization id is an indistinguishable 404 (`DEC-061`).
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadJobsAccess(session.userId);
    if (!isJobsAuthorized(access, JOBS_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!JOB_ID_PATTERN.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const job = await findJobById(getDb().db, { organizationId, jobId: id });
    if (job === undefined) {
      return jsonError(404);
    }

    return jsonOk({ job: toJobRow(job) });
  });
}
