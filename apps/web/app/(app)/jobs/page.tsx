import { listJobs } from "@aquarela/persistence";
import {
  EmptyState,
  InfoTip,
  MetricBand,
  MetricHero,
  MetricSecondary,
  PageHeader,
  SectionCard,
  formatNumber,
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
import { formatJobAge, isJobStatus, JOB_STATUS_FILTERS, jobStatusView } from "./jobs-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs — Aquarela Business Control" };

const PAGE_SIZE = 50;
/** One past the page size, so the hero can say "50+" instead of a false exact count. */
const HERO_LIMIT = PAGE_SIZE + 1;

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

  // The hero counts the dead-letter queue. `listJobs` has no count read, so the
  // figure is derived from one bounded fetch (one past the page size → "50+")
  // and the meta says so honestly; a countJobs-by-status read is the recorded
  // shared need.
  const deadLetters = await listJobs(getDb().db, {
    organizationId: resolveOrganization(),
    status: "dead_lettered",
    limit: HERO_LIMIT,
  });
  const deadLetterCount = deadLetters.length;
  const deadLetterExact = deadLetterCount <= PAGE_SIZE;
  const oldestDeadLetter = deadLetters.reduce<Date | null>((oldest, job) => {
    const created = job.createdAt instanceof Date ? job.createdAt : new Date(job.createdAt);
    return oldest === null || created < oldest ? created : oldest;
  }, null);

  const activity = await listJobs(getDb().db, {
    organizationId: resolveOrganization(),
    status: "running",
    limit: HERO_LIMIT,
  });
  const runningCount = activity.length;
  const runningExact = runningCount <= PAGE_SIZE;

  const canAdmin = isJobsAuthorized(access, JOBS_ADMIN_ROLES);

  const heroValue = deadLetterExact
    ? formatNumber(String(deadLetterCount), { decimals: 0 })
    : "50+";
  const heroMeta =
    deadLetterCount === 0
      ? "Nothing is waiting for review."
      : `oldest ${formatJobAge(oldestDeadLetter ?? now, now)} · ${deadLetterExact ? "exact count" : "first 50 shown"}`;

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
            value={heroValue}
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
            value={runningExact ? formatNumber(String(runningCount), { decimals: 0 }) : "50+"}
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
