import { listJobs } from "@aquarela/persistence";
import { EmptyState, PageHeader, SectionCard, spacing, typography } from "@aquarela/ui";
import { redirect } from "next/navigation";
import Link from "next/link";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  isJobsAuthorized,
  JOBS_ADMIN_ROLES,
  JOBS_READ_ROLES,
  loadJobsAccess,
} from "../../api/v1/jobs/access";

import { JobsRegister, type JobsRegisterRow } from "./jobs-register";
import { isJobStatus, JOB_STATUS_FILTERS, jobStatusView } from "./jobs-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs — Aquarela Business Control" };

const PAGE_SIZE = 50;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function href(status: string, offset = 0): string {
  return `/jobs?status=${encodeURIComponent(status)}&offset=${offset}`;
}

/**
 * The jobs operator screen (`DEC-139`): the application-facing view over the
 * `job` projection that the read API (`GET /api/v1/jobs`) also serves, so the
 * screen and the API cannot drift. It defaults to the `dead_lettered` filter —
 * the weekly review queue — and never renders `payload` or `error`.
 *
 * Access mirrors the API: read is `JOBS_READ_ROLES`, the retry/discard actions
 * are `JOBS_ADMIN_ROLES`; the server remains the authority on every action.
 */
export default async function JobsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadJobsAccess(session.userId);
  if (!isJobsAuthorized(access, JOBS_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Jobs"
          scope="Operations"
          description="The worker and scheduler queue: job progress, failures and the dead-letter review queue."
        />
        <EmptyState title="Not available for your role">
          The jobs screen is limited to the jobs roles (owner, general manager, finance and admin).
          Ask an owner or administrator if you need access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const statusParam = readParam(params, "status") ?? "dead_lettered";
  const status = isJobStatus(statusParam) ? statusParam : "dead_lettered";
  const offsetRaw = Number.parseInt(readParam(params, "offset") ?? "0", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const jobs = await listJobs(getDb().db, {
    organizationId: resolveOrganization(),
    status,
    limit: PAGE_SIZE,
    offset,
  });

  const rows: JobsRegisterRow[] = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    kind: job.kind,
    queue: job.queue,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  }));

  const canAdmin = isJobsAuthorized(access, JOBS_ADMIN_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Jobs"
        scope="Operations"
        description="Job progress and the dead-letter review queue (DEC-139). Retry re-queues a job; discard marks it terminally failed and stops the replay."
      />

      <nav
        aria-label="Filter by status"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}
      >
        {JOB_STATUS_FILTERS.map((value) => {
          const active = value === status;
          const view = jobStatusView(value);
          return (
            <Link
              key={value}
              href={href(value)}
              aria-current={active ? "true" : undefined}
              style={{
                padding: `${spacing[1]}px ${spacing[3]}px`,
                borderRadius: 999,
                border: `1px solid ${active ? "transparent" : "rgba(0,0,0,0.15)"}`,
                background: active ? "rgba(0,0,0,0.06)" : "transparent",
                fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.regular,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              {view.label}
            </Link>
          );
        })}
      </nav>

      <SectionCard
        title="Jobs"
        meta={`${rows.length} ${rows.length === 1 ? "job" : "jobs"} · newest first · offset ${offset}`}
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <JobsRegister rows={rows} canAdmin={canAdmin} />
        </div>
      </SectionCard>

      {rows.length === PAGE_SIZE || offset > 0 ? (
        <div style={{ display: "flex", gap: spacing[3], justifyContent: "space-between" }}>
          {offset > 0 ? (
            <Link href={href(status, Math.max(0, offset - PAGE_SIZE))}>← Newer</Link>
          ) : (
            <span />
          )}
          {rows.length === PAGE_SIZE ? (
            <Link href={href(status, offset + PAGE_SIZE)}>Older →</Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <p style={{ margin: 0, opacity: 0.75, fontSize: typography.fontSize.sm }}>
        Job progress is polled from this screen; the underlying API is{" "}
        <code>GET /api/v1/jobs?status=…</code> and each job is also addressable at{" "}
        <code>/api/v1/jobs/&lt;id&gt;</code> (the URL a future async producer returns with its{" "}
        <code>202</code>).
      </p>
    </div>
  );
}
