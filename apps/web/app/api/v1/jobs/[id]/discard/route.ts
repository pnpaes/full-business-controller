import { discardDeadLetteredJob } from "@aquarela/application";

import { jsonOk } from "../../../../../../lib/http";

import { withJobsAdminMutation } from "../../dlq-mutation";
import { toJobRow } from "../../job-rows";
import { jobsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Discards a dead-lettered job (`DEC-139`; the weekly DLQ review's "discard"). The
 * job moves to the terminal `failed` status; the outbox `dead_lettered_at` stays
 * as the review marker while the row is stamped published, so the maintenance
 * replay cannot resurrect a discarded job. No queue send happens.
 *
 * Signed out → 401; a role outside `JOBS_ADMIN_ROLES` (owner / general_manager /
 * admin; `finance` may read but not act) → 403; a non-UUID id → 400; an unknown
 * or other-organization id → 404; a job not in `dead_lettered` → 400. Returns
 * `{ ok: true, job }` (no `payload`/`error`).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withJobsAdminMutation(
    request,
    jobsLimiters.discardDeadLetteredJob,
    context,
    async ({ organizationId, jobId, actorId, store }) => {
      const job = await discardDeadLetteredJob(store, { organizationId, jobId, actorId });
      return jsonOk({ job: toJobRow(job) });
    },
  );
}
