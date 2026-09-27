import { findJobById, type Job } from "@aquarela/persistence";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isJobsAuthorized, JOBS_READ_ROLES, loadJobsAccess } from "../access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical 8-4-4-4-12 hex UUID, matching `lib/route-params.ts` (version and
 * variant nibbles intentionally unconstrained). A non-UUID id is rejected before
 * it can reach a Postgres `uuid` comparison, which would raise a driver error.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The API-facing shape of one job. **Deliberately omits `payload` (may carry
 * internal routing data) and `error` (an internal string that may leak
 * internals)** — only the projection fields a client needs to poll progress.
 */
function toJobRow(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    queue: job.queue,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    scheduledAt: job.scheduledAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

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
    if (!UUID.test(id)) {
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
