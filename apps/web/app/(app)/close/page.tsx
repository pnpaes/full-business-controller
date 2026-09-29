import {
  createPostgresInventoryStore,
  createPostgresPeriodCloseStore,
  listLocations,
  listPeriodCloses,
} from "@aquarela/application";
import { EmptyState, InfoTip, KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  isPeriodCloseAuthorized,
  loadPeriodCloseAccess,
  PERIOD_CLOSE_COMPANY_WRITE_ROLES,
  PERIOD_CLOSE_READ_ROLES,
  PERIOD_CLOSE_REOPEN_ROLES,
  PERIOD_CLOSE_WRITE_ROLES,
} from "../../api/v1/period-closes/access";

import { BeginCloseModal } from "./begin-close-form";
import { CloseRegisterTable, type CloseRegisterRow } from "./close-register-table";
import { CloseStateActions } from "./close-state-actions";
import { formatCloseInstant, formatClosePeriod } from "./close-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Close register — Aquarela Business Control" };

/** The register shows a bounded working set; the read API pages beyond it. */
const REGISTER_LIMIT = 100;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * The close register (`DEC-119`, `REC-003`/`REC-006`, `DEC-027`): the operator
 * surface that begins, locks and reopens a close. It lists the served
 * organization's closes and offers the begin action from the header; a location
 * close locks one location day and the company close locks the calendar month.
 * The irreversible lock/reopen actions live in the separate period-state-changes
 * section, not mixed into the read-only register.
 *
 * Reads the same application service and row shape as
 * `GET /api/v1/period-closes`, so the screen and the API cannot drift. Access is
 * the close read role set (`../api/v1/period-closes/access.ts`); a caller outside
 * it gets an explicit "not available" state rather than an empty register. The
 * `company` month begin and the per-row lock/reopen are offered only to the roles
 * that hold them, but the server remains the authority on every action.
 *
 * **`scopeLimited` (DEC-107 item 6, DEC-119 item 3):** a location close evaluates
 * the `reconciliation`/`import_run` prerequisites organization-wide, because
 * neither table carries a location dimension — so a location close can be blocked
 * by unrelated organization-wide data. This is stated as an `InfoTip` rather than
 * hidden.
 */
export default async function ClosePage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadPeriodCloseAccess(session.userId);
  if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Close register"
          scope="Close"
          description="Begin, lock and reopen a location daily close or the company month close."
        />
        <EmptyState title="Not available for your role">
          The close register is limited to the close roles (owner, general manager, location
          manager, front of house, finance, admin and analyst). Ask an owner or administrator if you
          need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const store = createPostgresPeriodCloseStore(getDb().db);
  const closes = await listPeriodCloses(store, { organizationId, limit: REGISTER_LIMIT });

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  // A location-scoped caller may only close the locations they hold; the API
  // enforces this too, so the selector does not offer a location it would reject.
  const locations =
    access.locationIds.length > 0
      ? allLocations.filter((location) => access.locationIds.includes(location.id))
      : allLocations;
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const canCompanyWrite = isPeriodCloseAuthorized(access, PERIOD_CLOSE_COMPANY_WRITE_ROLES);
  const canBegin = locations.length > 0 || canCompanyWrite;

  // Resolve the lock actors to a profile label; never invent a name, so an
  // unresolved id falls back to the id itself (the app-shell convention).
  const actorIds = [
    ...new Set(
      closes.flatMap((close) => (close.lockedBy === null ? [] : ([close.lockedBy] as const))),
    ),
  ];
  const actors = await Promise.all(actorIds.map((id) => getAuthStore().findUserById(id)));
  const actorLabelById = new Map(
    actorIds.map((id, index) => {
      const actor = actors[index];
      return [id, actor === undefined ? id : (actor.email ?? actor.username ?? id)] as const;
    }),
  );

  const rows: CloseRegisterRow[] = closes.map((close) => {
    const scopedLocationId = close.scopeType === "location" ? close.scopeId : undefined;
    const canLock =
      close.status === "closing" &&
      isPeriodCloseAuthorized(access, PERIOD_CLOSE_WRITE_ROLES, scopedLocationId) &&
      (close.scopeType !== "company" || canCompanyWrite);
    const canReopen =
      close.status === "locked" &&
      isPeriodCloseAuthorized(access, PERIOD_CLOSE_REOPEN_ROLES, scopedLocationId);
    return {
      id: close.id,
      scopeType: close.scopeType,
      scopeLabel:
        close.scopeType === "location"
          ? (locationLabelById.get(close.scopeId) ?? `Location ${close.scopeId}`)
          : "Company · whole organization",
      periodLabel: formatClosePeriod(close.periodStart, close.periodEnd),
      status: close.status,
      lockedByLabel:
        close.lockedBy === null ? null : (actorLabelById.get(close.lockedBy) ?? close.lockedBy),
      lockedAtLabel: close.lockedAt === null ? null : formatCloseInstant(close.lockedAt),
      reopenReason: close.reopenReason,
      canLock,
      canReopen,
    };
  });

  const closingCount = rows.filter((row) => row.status === "closing").length;
  const lockedCount = rows.filter((row) => row.status === "locked").length;
  const reopenedCount = rows.filter((row) => row.status === "reopened").length;

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Close register"
        scope="Close"
        description="Begin, lock and reopen a close: a location day (the daily close) or the company calendar month. Closes stay operator-driven — there is no scheduler."
        actions={
          canBegin ? (
            <BeginCloseModal
              locations={locations.map((location) => ({
                id: location.id,
                code: location.code,
                name: location.name,
              }))}
              defaultLocationId={locations[0]?.id ?? ""}
              organizationId={organizationId}
              canCompanyClose={canCompanyWrite}
            />
          ) : undefined
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Closing" value={String(closingCount)} meta="Begun, not yet locked" />
        <KpiCard label="Locked" value={String(lockedCount)} meta="Period frozen" />
        <KpiCard
          label="Reopened"
          value={String(reopenedCount)}
          meta="Unlocked for correction; re-begin to close again"
        />
      </div>

      <SectionCard
        title="Closes"
        meta={
          <>
            {rows.length} {rows.length === 1 ? "close" : "closes"} · newest period first
            <InfoTip
              content="A location daily close is checked organization-wide: open reconciliations and unfinished import runs carry no location dimension, so unrelated organization-wide data can block it. No location-precise filter is available."
              label="Why a location close can be blocked org-wide"
            />
          </>
        }
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <CloseRegisterTable rows={rows} />
        </div>
      </SectionCard>

      <CloseStateActions rows={rows} />
    </div>
  );
}
