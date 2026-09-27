import { JOB_STATUS, type JobStatus } from "@aquarela/application";

/**
 * Row shape and query parsing for the job-projection routes (`DEC-139` item 5).
 *
 * The API-facing shape is shared by the single read (`GET /api/v1/jobs/[id]`),
 * the list (`GET /api/v1/jobs`) and the DLQ-review responses so they cannot drift.
 * It **deliberately omits `payload`** (may carry internal routing data) and
 * **`error`** (an internal string that may leak internals) — only the projection
 * fields a client needs to poll progress.
 */

export const DEFAULT_JOBS_LIMIT = 50;
const MAX_LIMIT = 200;

/** The same strict 8-4-4-4-12 hex UUID the other routes accept. */
export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The projection fields a route row exposes; both `Job` and `JobRecord` satisfy it. */
export interface JobRowSource {
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  readonly queue: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date | null;
}

/** One job as the API returns it (no `payload`/`error`). */
export function toJobRow(job: JobRowSource): Record<string, unknown> {
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

export function toJobRows(jobs: readonly JobRowSource[]): Record<string, unknown>[] {
  return jobs.map(toJobRow);
}

export interface JobsListQuery {
  /** One of the `JOB_STATUS` vocabulary, exact match. */
  readonly status?: JobStatus;
  readonly limit: number;
  readonly offset: number;
}

export type ParsedJobsListQuery =
  { readonly ok: true; readonly query: JobsListQuery } | { readonly ok: false };

function readNonNegativeInteger(raw: string | null): number | undefined | "invalid" {
  if (raw === null) {
    return undefined;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return "invalid";
  }
  return Number.parseInt(value, 10);
}

/**
 * Parses the optional `status` filter and `limit`/`offset` paging. `limit` is
 * `1..MAX_LIMIT` and `offset` is `0..MAX_LIMIT`, so a malformed or huge value is
 * a 400 rather than reaching the store.
 */
export function parseJobsListQuery(searchParams: URLSearchParams): ParsedJobsListQuery {
  const status = searchParams.get("status");
  if (status !== null && !(JOB_STATUS as readonly string[]).includes(status)) {
    return { ok: false };
  }

  const limit = readNonNegativeInteger(searchParams.get("limit"));
  const offset = readNonNegativeInteger(searchParams.get("offset"));
  if (limit === "invalid" || offset === "invalid") {
    return { ok: false };
  }
  if (limit !== undefined && (limit < 1 || limit > MAX_LIMIT)) {
    return { ok: false };
  }
  if (offset !== undefined && offset > MAX_LIMIT) {
    return { ok: false };
  }

  return {
    ok: true,
    query: {
      ...(status === null ? {} : { status: status as JobStatus }),
      limit: limit ?? DEFAULT_JOBS_LIMIT,
      offset: offset ?? 0,
    },
  };
}
