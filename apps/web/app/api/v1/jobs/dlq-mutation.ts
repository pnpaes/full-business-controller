import { createPostgresJobStore, type JobStore } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import type { RateLimiter } from "../../../../lib/rate-limit";

import { isJobsAuthorized, JOBS_ADMIN_ROLES, loadJobsAccess } from "./access";
import { JOB_ID_PATTERN } from "./job-rows";

export interface JobsAdminMutation {
  readonly organizationId: string;
  readonly jobId: string;
  readonly actorId: string;
  readonly store: JobStore;
}

/**
 * The shared guard chain for the DLQ-review mutations
 * (`POST /api/v1/jobs/[id]/retry|discard`), mirroring the payroll route's
 * same-origin + limiter + session pattern: `withMutationGuards` (same-origin
 * first, then the per-IP throttle), `requireSession` (401), `JOBS_ADMIN_ROLES`
 * (403), a UUID check on the id (400) and the serving organization. A
 * `NotFoundError` from the command is an indistinguishable 404; any other
 * `DomainError` is a 400 with its authored message.
 */
export async function withJobsAdminMutation(
  request: Request,
  limiter: RateLimiter,
  context: { readonly params: Promise<{ readonly id: string }> },
  run: (input: JobsAdminMutation) => Promise<Response>,
): Promise<Response> {
  return withMutationGuards(request, limiter, async () => {
    const { session } = await requireSession(request);
    const access = await loadJobsAccess(session.userId);
    if (!isJobsAuthorized(access, JOBS_ADMIN_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!JOB_ID_PATTERN.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresJobStore(getDb().db);
    try {
      return await run({ organizationId, jobId: id, actorId: session.userId, store });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}
