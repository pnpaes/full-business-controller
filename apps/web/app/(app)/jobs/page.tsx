import { countJobsByStatus, listJobs } from "@aquarela/persistence";
import {
  EmptyState,
  InfoTip,
  MetricBand,
  MetricHero,
  MetricSecondary,
  PageHeader,
  SectionCard,
  formatNumber,
  formatRelativeAge,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  const now = new Date();
  const organizationId = resolveOrganization();
  const jobs = await listJobs(getDb().db, {
    organizationId,
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

  // One grouped count-by-status read drives the hero and every chip with true
  // counts (and the oldest dead letter), so nothing is derived from a capped
  // page of rows.
  const counts = await countJobsByStatus(getDb().db, { organizationId });
  const countByStatus = new Map(counts.map((entry) => [entry.status, entry]));
  const statusCount = (value: string): number => countByStatus.get(value)?.count ?? 0;
  const deadLetterCount = statusCount("dead_lettered");
  const oldestDeadLetter = countByStatus.get("dead_lettered")?.oldestCreatedAt ?? null;
  const runningCount = statusCount("running");

  const canAdmin = isJobsAuthorized(access, JOBS_ADMIN_ROLES);

  const heroMeta =
    deadLetterCount === 0
      ? "Nothing is waiting for review."
      : `oldest ${formatRelativeAge(oldestDeadLetter ?? now, now)}`;

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Jobs"
        scope="Operations"
        description="Job progress and the dead-letter review queue. Retry re-queues a job; discard marks it terminally failed and stops the replay."
      />

      <MetricBand
        hero={
          <MetricHero
            label="Dead letters"
            value={formatNumber(String(deadLetterCount), { decimals: 0 })}
            meta={heroMeta}
            info={
              <InfoTip
                content="Jobs that exhausted every retry attempt. They are kept 30 days and reviewed weekly; retry re-queues one, discard marks it terminally failed."
                label="What a dead letter is"
              />
            }
          />
        }
        metrics={[
          <MetricSecondary
            key="running"
            label="Running"
            value={formatNumber(String(runningCount), { decimals: 0 })}
            meta="in progress right now"
          />,
        ]}
      />

      <nav
        aria-label="Filter by status"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}
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
                display: "inline-flex",
                alignItems: "center",
                gap: spacing[1],
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
              <span
                aria-hidden="true"
                style={{
                  opacity: 0.7,
                  fontVariantNumeric: typography.fontVariantNumeric.tabular,
                }}
              >
                {formatNumber(String(statusCount(value)), { decimals: 0 })}
              </span>
            </Link>
          );
        })}
        <InfoTip
          content="The worker's raw job states: pending (queued), running, succeeded, failed (will retry) and dead_lettered (out of retries — review it here)."
          label="What the job statuses mean"
        />
      </nav>

      <SectionCard
        title="Jobs"
        meta={`${formatNumber(String(rows.length), { decimals: 0 })} ${rows.length === 1 ? "job" : "jobs"} · newest first · page ${Math.floor(offset / PAGE_SIZE) + 1}`}
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
        Job progress is polled from this screen.
        <InfoTip
          content="The list refreshes when you reload or act. The same data is served by the jobs API (GET /api/v1/jobs, one job at /api/v1/jobs/<id> — the URL an async producer returns with its 202)."
          label="About polling and the jobs API"
        />
      </p>
    </div>
  );
}
