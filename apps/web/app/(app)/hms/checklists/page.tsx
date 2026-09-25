import {
  createPostgresHmsStore,
  createPostgresInventoryStore,
  listChecklistRuns,
  listChecklistTemplates,
  listLocations,
} from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  HMS_CHECKLIST_RUN_READ_ROLES,
  HMS_CHECKLIST_RUN_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../api/v1/hms/access";
import {
  checkFrequencyLabel,
  checklistCategoryLabel,
  checklistOutcomeView,
  checklistRunStatusView,
  formatHmsInstant,
  parseChecklistItems,
  parseChecklistResults,
} from "../hms-labels";
import { RunChecklistForm, type RunTemplateOption } from "./run-checklist-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "HMS checklists — Aquarela Business Control" };

const PAGE_LIMIT = 200;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/** Tables scroll inside a labelled region; the page never scrolls sideways. */
const tableWrap = { overflowX: "auto", minWidth: 0 } as const;

/**
 * The IK-mat checklist screen (`HMS-005`, `DEC-091`, `DEC-096`): the active
 * templates (self-check, cleaning/hygiene categories), the question flow for a
 * new run and the run history with per-item outcomes. Template authoring
 * (register/supersede) is a managed write with no UI here — it stays API-only
 * and the gap is stated, not faked.
 */
export default async function HmsChecklistsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Checklists" scope="HMS" />
        <EmptyState title="Not available for your role">
          Purchasing and finance have no access to checklists (DEC-096). Ask an owner or
          administrator if you need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const templates = await listChecklistTemplates(store, {
    organizationId,
    active: true,
    limit: PAGE_LIMIT,
  });
  const runs = await listChecklistRuns(store, { organizationId, limit: PAGE_LIMIT });

  const visibleRuns =
    access.locationIds.length > 0
      ? runs.filter((run) => access.locationIds.includes(run.locationId))
      : runs;

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locations = allLocations
    .filter((location) =>
      access.locationIds.length > 0 ? access.locationIds.includes(location.id) : true,
    )
    .map((location) => ({ id: location.id, label: `${location.code} · ${location.name}` }));
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );
  const templateLabelById = new Map(templates.map((template) => [template.id, template.name]));

  const templateOptions: RunTemplateOption[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    categoryLabel: checklistCategoryLabel(template.category),
    items: parseChecklistItems(template.items),
  }));

  const columns: readonly DataTableColumn[] = [
    { key: "template", header: "Template" },
    { key: "runAt", header: "Run at" },
    { key: "location", header: "Location" },
    { key: "performedBy", header: "Performed by" },
    { key: "status", header: "Status" },
    { key: "results", header: "Items" },
    { key: "notes", header: "Notes" },
  ];

  const canRecord = isHmsAuthorized(access, HMS_CHECKLIST_RUN_RECORD_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Checklists"
        scope="HMS"
        description="IK-mat self-checks and cleaning/hygiene checklists: walk a template, capture non-conformities and keep the run history (DEC-091, DEC-096)."
      />

      {canRecord ? (
        <RunChecklistForm templates={templateOptions} locations={locations} />
      ) : (
        <SectionCard title="Run a checklist" meta="record roles only">
          <EmptyState title="Recording is not available for your role">
            Analyst can read runs but not record them; recording needs owner, general manager,
            location manager, kitchen, front of house or admin (DEC-096).
          </EmptyState>
        </SectionCard>
      )}

      <SectionCard
        title="Templates"
        meta={`${templates.length} active ${templates.length === 1 ? "template" : "templates"}`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Active checklist templates with category, cadence and item count"
            columns={[
              { key: "name", header: "Name" },
              { key: "category", header: "Category" },
              { key: "frequency", header: "Cadence" },
              { key: "items", header: "Items" },
            ]}
            rows={templates.map((template) => ({
              name: template.name,
              category: checklistCategoryLabel(template.category),
              frequency: checkFrequencyLabel(template.frequency),
              items: String(parseChecklistItems(template.items).length),
            }))}
            emptyMessage="No active templates. Authoring is a managed write done through the API for now (owner, general manager or admin)."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Run history"
        meta={`${visibleRuns.length} recent ${visibleRuns.length === 1 ? "run" : "runs"} · newest first`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Checklist runs, newest first, with per-item outcomes"
            columns={columns}
            rows={visibleRuns.map((run) => {
              const runStatus = checklistRunStatusView(run.status);
              const results = parseChecklistResults(run.results);
              const fails = results.filter((result) => result.outcome === "fail").length;
              return {
                template: templateLabelById.get(run.templateId) ?? run.templateId,
                runAt: formatHmsInstant(run.runAt),
                location: locationLabelById.get(run.locationId) ?? run.locationId,
                performedBy: run.performedBy,
                status: <StatusPill tone={runStatus.tone}>{runStatus.label}</StatusPill>,
                results:
                  fails > 0 ? (
                    <StatusPill tone="danger">{`${fails} fail${fails === 1 ? "" : "s"} of ${results.length}`}</StatusPill>
                  ) : (
                    <StatusPill tone={checklistOutcomeView("pass").tone}>
                      {`${results.length} answered`}
                    </StatusPill>
                  ),
                notes: run.notes ?? "—",
              };
            })}
            emptyMessage="No runs recorded yet. Walk the first checklist with the form above."
          />
        </div>
      </SectionCard>
    </div>
  );
}
