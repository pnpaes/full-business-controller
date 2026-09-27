import { retryDeadLetteredJob } from "@aquarela/application";
import { createLogger } from "@aquarela/logger";

import { jsonOk } from "../../../../../../lib/http";
import { redispatchJob } from "../../../../../../lib/jobs";

import { withJobsAdminMutation } from "../../dlq-mutation";
import { toJobRow } from "../../job-rows";
import { jobsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger({ name: "web-jobs-dlq" });

/**
 * Retries a dead-lettered job (`DEC-139`; the weekly DLQ review's "replay"). The
 * job is reset to `pending` and its outbox dead-letter mark cleared, then the
 * event is re-sent through the web boss. The reset and the send are two steps:
 * if the send fails the event is unpublished again, so the scheduled maintenance
 * replay re-sends it (the safety net); a duplicate send is deduplicated by the
 * shared outbox id.
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
    jobsLimiters.retryDeadLetteredJob,
    context,
    async ({ organizationId, jobId, actorId, store }) => {
      const job = await retryDeadLetteredJob(store, { organizationId, jobId, actorId });

      try {
        await redispatchJob({ organizationId, outboxEventId: job.outboxEventId });
      } catch (error) {
        logger.warn(
          { err: error, jobId },
          "dead-lettered job retry: immediate re-dispatch failed; the maintenance replay will re-send it",
        );
      }

      return jsonOk({ job: toJobRow(job) });
    },
  );
}
