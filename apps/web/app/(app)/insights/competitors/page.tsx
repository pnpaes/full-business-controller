import {
  createPostgresCompetitorStore,
  listCompetitorObservations,
  listCompetitors,
  compareCompetitorPrices,
  type CompetitorObservationStatusFilter,
} from "@aquarela/application";
import { findOrganizationCurrency } from "@aquarela/persistence";
import {
  Alert,
  Breadcrumbs,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  COMPETITOR_READ_ROLES,
  canWriteCompetitors,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "../../../api/v1/competitors/access";

import { CompetitorFilters } from "./competitor-filters";
import { NewCompetitorForm, RecordObservationForm } from "./competitor-forms";
import { ObservationReviewControls } from "./observation-review-controls";
import {
  comparisonReasonLabel,
  dayStartInstant,
  formatDay,
  formatInstantUTC,
  reviewStatusView,
} from "./competitor-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competitors — Aquarela Business Control" };

const REGISTER_LIMIT = 200;
const OBSERVATION_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_FILTERS = ["pending", "reviewed", "rejected", "all"] as const;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const note = {
  margin: 0,
  maxWidth: "75ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.ink.secondary,
} as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000));
}

/**
 * The competitor observation screen (`DEC-126`, `COMP-001…COMP-004`).
 *
 * Two registers and the comparison:
 * - the **competitor register** (list + create form, idempotent on name);
 * - the **observation register** (list + record form + the per-row review
 *   action), with a status filter that keeps `pending` distinct from
 *   `reviewed` — the screen states plainly that a **pending observation is not
 *   intelligence**;
 * - the **comparison**: each reviewed observation against our own effective
 *   price for the same item, with the price basis, the difference, the ratio
 *   and the date gap; a reviewed observation that cannot be paired is shown as
 *   not comparable with the reason, never guessed at.
 *
 * Server component: it calls the same application services the API routes call,
 * so the screen and the API cannot drift. Access mirrors the routes
 * (`COMPETITOR_READ_ROLES`); the write controls are hidden outside the write
 * roles (`DEC-126`, provisional).
 */
export default async function CompetitorsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly competitorId?: string;
    readonly from?: string;
    readonly to?: string;
  }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadCompetitorAccess(session.userId);
  if (!isCompetitorAuthorized(access, COMPETITOR_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Competitors"
          scope="Insights"
          description="Competitor price observations and a reviewed comparison against our prices."
        />
        <EmptyState title="Not available for your role">
          The competitor register is limited to the intelligence read roles (DEC-126). Ask an owner
          or administrator for access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const status =
    params.status !== undefined && (STATUS_FILTERS as readonly string[]).includes(params.status)
      ? params.status
      : "all";
  const competitorId =
    params.competitorId !== undefined && UUID.test(params.competitorId)
      ? params.competitorId
      : undefined;
  const today = isoDay(new Date());
  const toDay = params.to !== undefined && DAY.test(params.to) ? params.to : today;
  const fromDay =
    params.from !== undefined && DAY.test(params.from) ? params.from : addDays(toDay, -90);

  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresCompetitorStore(db);
  const canWrite = canWriteCompetitors(access);

  const [currency, competitors, observations, comparisons] = await Promise.all([
    findOrganizationCurrency(db, { organizationId }),
    listCompetitors(store, { organizationId, limit: REGISTER_LIMIT }),
    listCompetitorObservations(store, {
      organizationId,
      status: status as CompetitorObservationStatusFilter,
      ...(competitorId === undefined ? {} : { competitorId }),
      limit: OBSERVATION_LIMIT,
    }),
    compareCompetitorPrices(store, {
      organizationId,
      ...(competitorId === undefined ? {} : { competitorId }),
      from: dayStartInstant(fromDay),
      to: dayStartInstant(addDays(toDay, 1)),
      limit: OBSERVATION_LIMIT,
    }),
  ]);

  const currencyCode = currency ?? "NOK";
  const competitorNameById = new Map(competitors.map((row) => [row.id, row.name] as const));
  const competitorOptions = competitors.map((row) => ({ id: row.id, name: row.name }));

  // Resolve reviewers to a profile label; an unresolved id falls back to the id.
  const reviewerIds = [
    ...new Set(observations.flatMap((row) => (row.reviewedBy === null ? [] : [row.reviewedBy]))),
  ];
  const reviewerLabelById = new Map<string, string>();
  await Promise.all(
    reviewerIds.map(async (id) => {
      const profile = await getAuthStore().findUserById(id);
      reviewerLabelById.set(id, profile?.username ?? profile?.email ?? id);
    }),
  );

  const observationColumns: readonly DataTableColumn[] = [
    { key: "observed", header: "Observed" },
    { key: "competitor", header: "Competitor" },
    { key: "offer", header: "Offer" },
    { key: "price", header: "Price" },
    { key: "status", header: "Review" },
    { key: "reviewed", header: "Reviewed by" },
    ...(canWrite ? [{ key: "actions", header: "Decision" } as DataTableColumn] : []),
  ];

  const comparisonColumns: readonly DataTableColumn[] = [
    { key: "competitor", header: "Competitor" },
    { key: "observed", header: "Observed" },
    { key: "ours", header: "Our price" },
    { key: "theirs", header: "Competitor price" },
    { key: "difference", header: "Difference" },
    { key: "ratio", header: "Ratio" },
    { key: "gap", header: "Date gap" },
  ];

  const pendingCount = observations.filter((row) => row.reviewStatus === "pending").length;

  return (
    <div style={contentColumn}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        <Breadcrumbs items={[{ label: "Insights", href: "/insights" }, { label: "Competitors" }]} />
        <PageHeader
          title="Competitors"
          scope="Insights"
          description="Dated competitor observations with a human-review gate: only reviewed observations are intelligence, and only those are compared against our prices (DEC-126)."
        />
      </div>

      <Alert tone="warning" title="A pending observation is not intelligence (DEC-126)">
        Capture is not review. An observation opens <strong>pending</strong> and cannot influence a
        comparison until a reviewer admits it (DEC-020). The comparison read below considers{" "}
        <strong>reviewed observations only</strong>; a pending or rejected one is never paired with
        our price.
      </Alert>

      <SectionCard title="Filters" meta="status · competitor · comparison window">
        <CompetitorFilters
          competitors={competitorOptions}
          status={status}
          competitorId={competitorId ?? ""}
          from={fromDay}
          to={toDay}
        />
      </SectionCard>

      <SectionCard
        title="Competitor register"
        meta={`${competitors.length} ${competitors.length === 1 ? "competitor" : "competitors"} · idempotent on name`}
      >
        <DataTable
          caption="Registered competitors"
          columns={[
            { key: "name", header: "Name" },
            { key: "notes", header: "Notes" },
          ]}
          rows={competitors.map((row) => ({
            name: row.name,
            notes: row.notes ?? "—",
          }))}
          emptyMessage="No competitors registered yet. Add one below to start recording observations."
        />
      </SectionCard>

      {canWrite ? <NewCompetitorForm /> : null}

      <SectionCard
        title="Observation register"
        meta={`${observations.length} shown · ${pendingCount} pending · filter: ${status}`}
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <DataTable
            caption="Competitor observations and their review status"
            columns={observationColumns}
            rows={observations.map((row) => {
              const view = reviewStatusView(row.reviewStatus);
              const reviewer =
                row.reviewedBy === null
                  ? "—"
                  : `${reviewerLabelById.get(row.reviewedBy) ?? row.reviewedBy}${
                      row.reviewedAt === null ? "" : ` · ${formatInstantUTC(row.reviewedAt)}`
                    }`;
              return {
                observed: formatDay(row.observedAt),
                competitor: competitorNameById.get(row.competitorId) ?? row.competitorId,
                offer: row.externalName,
                price:
                  row.price === null
                    ? "—"
                    : `${row.price}${row.currency === null ? "" : ` ${row.currency}`}`,
                status: (
                  <span title={view.description}>
                    <StatusPill tone={view.tone}>{view.label}</StatusPill>
                  </span>
                ),
                reviewed: reviewer,
                ...(canWrite
                  ? {
                      actions:
                        row.reviewStatus === "pending" ? (
                          <ObservationReviewControls observationId={row.id} />
                        ) : (
                          "—"
                        ),
                    }
                  : {}),
              };
            })}
            emptyMessage={`No observations match this filter (${status}). Record one below, or widen the filter.`}
          />
        </div>
      </SectionCard>

      {canWrite ? (
        <RecordObservationForm competitors={competitorOptions} currency={currencyCode} />
      ) : (
        <SectionCard title="Record an observation" meta="write roles only">
          <EmptyState title="Recording is not available for your role">
            Capturing a competitor observation needs owner, general manager, admin or location
            manager (DEC-126).
          </EmptyState>
        </SectionCard>
      )}

      <SectionCard
        title="Comparison with our prices"
        meta={`reviewed only · ${fromDay} to ${toDay}`}
      >
        <p style={{ ...note, marginBottom: spacing[3] }}>
          Each reviewed observation is paired with our own effective price for the same item on the
          observation date (the organization-wide price, net basis). The difference, the ratio and
          the date gap are computed from decimal strings — never floats. An observation that cannot
          be paired is shown as not comparable with the reason, never matched by name.
        </p>
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <DataTable
            caption="Reviewed competitor observations against our own effective price"
            columns={comparisonColumns}
            rows={comparisons.map((row) => {
              if (!row.comparable) {
                return {
                  competitor: competitorNameById.get(row.competitorId) ?? row.competitorId,
                  observed: formatDay(row.observedAt),
                  ours: "—",
                  theirs: "—",
                  difference: "—",
                  ratio: "—",
                  gap: `Not comparable: ${comparisonReasonLabel(row.reason)}`,
                };
              }
              return {
                competitor: competitorNameById.get(row.competitorId) ?? row.competitorId,
                observed: formatDay(row.observedAt),
                ours: `${row.ourPrice} ${row.currency ?? ""} (${row.ourPriceBasis}, from ${formatDay(row.ourPriceEffectiveFrom)})`,
                theirs: `${row.competitorPrice}${row.competitorCurrency === null ? "" : ` ${row.competitorCurrency}`}`,
                difference: row.difference,
                ratio: row.ratio ?? "—",
                gap: `${row.dateGapDays} ${row.dateGapDays === 1 ? "day" : "days"}`,
              };
            })}
            emptyMessage="No reviewed observations in this window. Capture and review one, or widen the window."
          />
        </div>
      </SectionCard>

      <p style={note}>
        Automation that collects from permitted sources, multi-source deduplication and seasonal
        analysis are not built (DEC-126 records them as deferred). Nothing here changes a price:
        pricing stays a human decision on the price-scenario path (DEC-039).
      </p>
    </div>
  );
}
