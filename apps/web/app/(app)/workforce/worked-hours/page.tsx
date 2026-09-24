import {
  computeWorkedHours,
  createPostgresInventoryStore,
  createPostgresSchedulingStore,
  listLocations,
} from "@aquarela/application";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  spacing,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKED_HOURS_READ_ROLES,
} from "../../../api/v1/workforce/access";
import { monthStartUtcDay, nextUtcDay, todayUtcDay } from "../workforce-labels";
import { HoursFilter } from "./hours-filter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Worked hours — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The worked-hours view (`WF-004`, `DEC-103`): one row per employee for the
 * chosen period and location, derived from the approved assignments on
 * assigned/completed shifts (an adjustment overrides its own assignment).
 *
 * Reads the same application service and row shape as
 * `GET /api/v1/workforce/worked-hours`. Access is the worked-hours read set
 * (owner, GM, location manager, finance, admin — `kitchen`, `front_of_house`,
 * `purchasing` and `analyst` are excluded, DEC-103). Location scope is
 * resolved like the route: an out-of-scope location is not offered, a
 * single-location caller is pinned, and a multi-location caller must choose
 * one — the report refuses to guess rather than widening silently.
 */
export default async function WorkedHoursPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly from?: string;
    readonly to?: string;
    readonly location?: string;
  }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadWorkforceAccess(session.userId);
  if (!isWorkforceAuthorized(access, WORKED_HOURS_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Worked hours"
          scope="Workforce"
          description="The derived worked-hours report."
        />
        <EmptyState title="Not available for your role">
          Worked hours are payroll-input data, limited to owner, general manager, location manager,
          finance and admin (DEC-103). Kitchen, front of house, purchasing and analyst have no
          access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const today = todayUtcDay();
  const from = DAY.test(params.from ?? "") ? params.from! : monthStartUtcDay(today);
  const to = DAY.test(params.to ?? "") ? params.to! : today;
  const rawLocationId = params.location;

  const organizationId = resolveOrganization();
  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const scope = access.locationIds;
  const offeredLocations =
    scope.length === 0 ? allLocations : allLocations.filter((l) => scope.includes(l.id));

  // Mirror the GET route's location resolution (fail-closed).
  let locationId: string | undefined = rawLocationId;
  let needsLocationChoice = false;
  let locationError: string | null = null;
  if (scope.length > 0) {
    if (locationId !== undefined && !scope.includes(locationId)) {
      locationError = "The chosen location is outside your scope.";
      locationId = undefined;
    }
    if (locationId === undefined) {
      if (scope.length === 1) {
        locationId = scope[0]!;
      } else {
        needsLocationChoice = true;
      }
    }
  }

  const report =
    locationError !== null || needsLocationChoice
      ? null
      : await computeWorkedHours(createPostgresSchedulingStore(getDb().db), {
          organizationId,
          from: `${from}T00:00:00.000Z`,
          to: `${nextUtcDay(to)}T00:00:00.000Z`,
          ...(locationId === undefined ? {} : { locationId }),
        });

  const columns: readonly DataTableColumn[] = [
    { key: "employee", header: "Employee" },
    { key: "role", header: "Role" },
    { key: "hours", header: "Hours" },
    { key: "rate", header: "Base rate (NOK/h)" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Worked hours"
        scope="Workforce"
        description="Derived per employee from approved assignments on assigned/completed shifts; a recorded adjustment overrides its own assignment (WF-004, DEC-103)."
      />

      <HoursFilter
        locations={offeredLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        locationId={locationId ?? ""}
        from={from}
        to={to}
        locationRequired={needsLocationChoice}
      />

      {locationError !== null ? (
        <EmptyState title="Location outside your scope">{locationError}</EmptyState>
      ) : needsLocationChoice ? (
        <EmptyState title="Choose a location">
          You hold more than one location, and the worked-hours report requires an explicit location
          for a multi-location caller — it refuses to guess rather than silently widening to all of
          them (the recorded fail-closed posture, DEC-103).
        </EmptyState>
      ) : report === null ? null : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: spacing[4],
            }}
          >
            <KpiCard
              label="Total hours"
              value={report.totalHours}
              meta={`${from} → ${to} (period end day included) · ${
                locationId === undefined
                  ? "whole organization"
                  : (locationLabelById.get(locationId) ?? locationId)
              }`}
            />
            <KpiCard
              label="Employees with hours"
              value={String(report.rows.length)}
              meta="One row per employee; decimals at scale 2 (HALF_UP)"
            />
          </div>

          <SectionCard
            title="By employee"
            meta={`${report.rows.length} ${report.rows.length === 1 ? "row" : "rows"}`}
          >
            <DataTable
              caption="Worked hours per employee with role and base hourly rate for the chosen period"
              columns={columns}
              rows={report.rows.map((row) => ({
                id: row.employeeId,
                employee: row.employeeName,
                role: row.roleCode,
                hours: row.hours,
                rate: row.hourlyRate,
              }))}
              emptyMessage="No worked hours in this window. Hours appear once a shift is assigned or completed and its assignment is approved."
            />
          </SectionCard>

          <Alert tone="info" title="How hours are derived">
            An assignment contributes when it is <strong>approved</strong> on a shift in state
            assigned or completed whose start falls in the half-open period. Per assignment the
            latest recorded adjustment wins; otherwise the hours are the shift window minus the
            unpaid break, floored at zero (DEC-103). The report is derived on demand and not
            persisted.
          </Alert>
        </>
      )}
    </div>
  );
}
