import {
  createPostgresImportStore,
  getImportRun,
  previewImportRun,
  type ImportRunPreview,
} from "@aquarela/application";
import {
  Alert,
  DescriptionList,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  color,
  spacing,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";
import { toStagingRowRows } from "../../../../api/v1/imports/import-rows";
import {
  formatInstant,
  formatPeriod,
  importStatusView,
  mappingStateView,
  moneyTotalEntries,
  orDash,
  type MoneyTotalEntry,
} from "../../import-labels";

import { DispositionForm, PostRunForm, RunActions } from "./run-actions";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

function amountFor(entries: readonly MoneyTotalEntry[], currency: string): string {
  return entries.find((entry) => entry.currency === currency)?.amount ?? "—";
}

function residualLabel(entries: readonly MoneyTotalEntry[]): string {
  return entries.length === 0
    ? "—"
    : entries.map((entry) => `${entry.amount} ${entry.currency}`).join(", ");
}

function canRunActions(status: string): boolean {
  return status === "parsed" || status === "needs_review" || status === "validated";
}

/** Only a validated/needs-review run is open for posting (`postImportRun`). */
function canPost(status: string): boolean {
  return status === "validated" || status === "needs_review";
}

function hasPosted(status: string): boolean {
  return status === "posted" || status === "partially_posted";
}

/**
 * Import run detail (08_UI_UX.md §8.3): diagnostics and row counts, the staging
 * rows with their mapping state and error code, the validate/map actions, a
 * disposition form for rows that will not be posted, and the reconciliation
 * preview totals.
 *
 * A validated/needs-review run also offers the row-12 **post** action; after
 * posting, the preview's posted totals are read from the linked sales lines.
 */
export default async function ImportRunDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { runId: rawRunId } = await params;
  const runId = uuidOrNotFound(rawRunId);
  const organizationId = resolveOrganization();
  const store = createPostgresImportStore(getDb().db);

  const detail = await getImportRun(store, { organizationId, importRunId: runId });
  if (detail === undefined) {
    notFound();
  }
  const run = detail.run;
  const preview: ImportRunPreview = await previewImportRun(store, {
    organizationId,
    importRunId: runId,
  });

  const rows = toStagingRowRows(detail.rows);
  const undecided = new Set(preview.undecidedRowIds);
  const eligibleRows = rows.filter((row) => undecided.has(row.id));

  const sourceEntries = moneyTotalEntries(preview.sourceTotals);
  const postedEntries = moneyTotalEntries(preview.postedTotals);
  const dispositionEntries = moneyTotalEntries(preview.dispositionTotals);
  const residualEntries = moneyTotalEntries(preview.residualTotals);
  const currencies = [
    ...new Set([
      ...sourceEntries.map((entry) => entry.currency),
      ...dispositionEntries.map((entry) => entry.currency),
      ...residualEntries.map((entry) => entry.currency),
    ]),
  ].sort();

  const status = importStatusView(run.status);
  const postingPolicy =
    typeof run.diagnostics.posting_policy === "string" ? run.diagnostics.posting_policy : null;
  const erroredOrConflicted = preview.erroredCount + preview.conflictCount;

  return (
    <div style={contentColumn}>
      <PageHeader
        title={`Import run · ${run.source}`}
        scope="Sales · Import"
        description={`${formatPeriod(run.periodStart, run.periodEnd)} · run ${run.id}`}
      />

      <Tabs
        items={[
          { label: "Sales", href: "/sales" },
          { label: "Sales import", href: "/sales/import" },
          { label: "Transactions", href: "/sales/transactions" },
          { label: "Reconciliation", href: "/sales/reconciliation" },
        ]}
        ariaLabel="Sales sections"
      />

      {canPost(run.status) ? (
        <Alert tone="info" title="Ready to post">
          This run is <strong>{status.label}</strong>. Record a disposition for every row that will
          not be posted (DEC-035), then post it into sales below. Posting is idempotent on the
          external transaction/line keys.
        </Alert>
      ) : hasPosted(run.status) ? (
        <Alert tone="success" title="Posted">
          This run is <strong>{status.label}</strong>. Its mapped rows were written to sales; the
          posted totals below are read from the linked sales lines. Reconcile it from{" "}
          <strong>Reconciliation</strong>.
        </Alert>
      ) : (
        <Alert tone="info" title="Not yet postable">
          This run is <strong>{status.label}</strong>. Stage, validate and map it before posting.
        </Alert>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Rows" value={String(preview.rowCount)} meta="Staged rows in this run" />
        <KpiCard
          label="Mapped"
          value={String(preview.mappedCount)}
          meta="Resolved to a catalogue entity"
        />
        <KpiCard
          label="Unmapped"
          value={String(preview.unmappedCount)}
          meta="Awaiting a mapping or a disposition"
        />
        <KpiCard
          label="Errored / conflicted"
          value={String(erroredOrConflicted)}
          meta="Validation errors and DEC-033 conflicts"
        />
        <KpiCard
          label="Residual"
          value={residualLabel(residualEntries)}
          meta="Source − posted − dispositions"
        />
      </div>

      <SectionCard title="Run" meta={<StatusPill tone={status.tone}>{status.label}</StatusPill>}>
        <DescriptionList
          items={[
            { term: "Source", description: run.source },
            {
              term: "Profile version",
              description: `${run.profileVersion} · ${
                run.importProfileId === null
                  ? "no import profile linked"
                  : "linked to an import profile"
              }`,
            },
            { term: "Period", description: formatPeriod(run.periodStart, run.periodEnd) },
            {
              term: "Posting policy",
              description:
                postingPolicy === null
                  ? "—"
                  : `${postingPolicy} (from the run's import profile, DEC-081; DEC-025 allow_partial default when no profile)`,
            },
            { term: "File hash", description: run.fileHash },
            {
              term: "File object id",
              description:
                run.fileObjectId === null
                  ? "— (plain uuid; no file table exists yet)"
                  : run.fileObjectId,
            },
            { term: "Created", description: formatInstant(run.createdAt) },
            { term: "Created by", description: orDash(run.createdBy) },
            {
              term: "Can close",
              description: preview.canClose
                ? "Yes — every non-posted row is mapped or dispositioned (DEC-035)"
                : `No — ${preview.undecidedRowIds.length} row(s) still need a decision`,
            },
          ]}
        />
      </SectionCard>

      {canRunActions(run.status) ? (
        <RunActions runId={run.id} status={run.status} sourceSystem={run.source} />
      ) : null}

      {canPost(run.status) ? <PostRunForm runId={run.id} sourceSystem={run.source} /> : null}

      {detail.conflicts.length > 0 ? (
        <Alert tone="danger" title="Mapping conflicts (DEC-033)">
          {detail.conflicts.length} row(s) matched more than one internal entity. A conflict is
          flagged and blocked, never remapped in place; resolve it explicitly before posting.
        </Alert>
      ) : null}

      {detail.issues.length > 0 ? (
        <SectionCard title="Validation issues" meta={`${detail.issues.length} issue(s)`}>
          <Table caption="Row-level validation issues, with their error code." columnCount={4}>
            <thead>
              <tr>
                <Th style={numCell}>Source row</Th>
                <Th>Code</Th>
                <Th>Message</Th>
                <Th>Staging row</Th>
              </tr>
            </thead>
            <tbody>
              {detail.issues.map((issue, index) => (
                <tr key={`${issue.stagingRowId}-${issue.code}-${index}`}>
                  <Td style={numCell}>{issue.sourceRowNo}</Td>
                  <Td>{issue.code}</Td>
                  <Td>{issue.message}</Td>
                  <Td
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: color.text.muted,
                    }}
                  >
                    {issue.stagingRowId}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Staging rows"
        meta={rows.length === 0 ? "none staged" : `${rows.length} row(s)`}
      >
        {rows.length === 0 ? (
          <EmptyState title="No rows staged yet">
            Rows are staged when the file is registered. A run in <strong>uploaded</strong> status
            has not been staged; register the file again through the import form to stage it.
          </EmptyState>
        ) : (
          <Table
            caption="Every staged row is retained; invalid rows keep their error code and are never dropped (SALE-004)."
            columnCount={4}
          >
            <thead>
              <tr>
                <Th style={numCell}>Source row</Th>
                <Th>Mapping state</Th>
                <Th>Error code</Th>
                <Th>Normalized summary</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const mapping = mappingStateView(row.mappingState);
                return (
                  <tr key={row.id}>
                    <Td style={numCell}>{row.sourceRowNo}</Td>
                    <Td>
                      <StatusPill tone={mapping.tone}>{mapping.label}</StatusPill>
                    </Td>
                    <Td>{orDash(row.errorCode)}</Td>
                    <Td>{row.summary}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </SectionCard>

      {detail.dispositions.length > 0 ? (
        <SectionCard title="Dispositions" meta={`${detail.dispositions.length} recorded (DEC-035)`}>
          <Table
            caption="Approved dispositions for non-posted rows. There is no disposition table; the record is appended to the run diagnostics."
            columnCount={5}
          >
            <thead>
              <tr>
                <Th style={numCell}>Source row</Th>
                <Th>Disposition</Th>
                <Th>Reason</Th>
                <Th>Actor</Th>
                <Th>Recorded</Th>
              </tr>
            </thead>
            <tbody>
              {detail.dispositions.map((disposition, index) => (
                <tr key={`${disposition.stagingRowId}-${index}`}>
                  <Td style={numCell}>{disposition.sourceRowNo}</Td>
                  <Td>{disposition.disposition}</Td>
                  <Td>{orDash(disposition.reason)}</Td>
                  <Td>{orDash(disposition.actorId)}</Td>
                  <Td>{disposition.at === "" ? "—" : formatInstant(disposition.at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
      ) : null}

      {eligibleRows.length > 0 ? <DispositionForm runId={run.id} rows={eligibleRows} /> : null}

      <SectionCard
        title="Preview totals"
        meta={
          preview.canClose
            ? "Every non-posted row has a decision"
            : `${preview.undecidedRowIds.length} row(s) undecided`
        }
      >
        {preview.sourceTotals === null ? (
          <EmptyState title="No source totals yet">
            The preview totals are recorded when the run is validated. Validate the staged rows to
            see the per-currency source, posted, dispositioned and residual totals.
          </EmptyState>
        ) : currencies.length === 0 ? (
          <EmptyState title="No per-currency amounts recorded">
            Validation ran, but no staged row carried both a currency and a{" "}
            <code>gross_amount</code>, so there is nothing to reconcile. Check the row
            normalizations and re-map the run.
          </EmptyState>
        ) : (
          <Table
            caption="Per-currency source, posted, dispositioned and residual totals. The posted totals come from the linked sales lines; there is no tolerance table, so no threshold is applied here — reconciling the run is the separate step that snapshots one."
            columnCount={5}
          >
            <thead>
              <tr>
                <Th>Currency</Th>
                <Th style={numCell}>Source</Th>
                <Th style={numCell}>Posted</Th>
                <Th style={numCell}>Dispositions</Th>
                <Th style={numCell}>Residual</Th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => (
                <tr key={currency}>
                  <Td>{currency}</Td>
                  <Td style={numCell}>{amountFor(sourceEntries, currency)}</Td>
                  <Td style={numCell}>{amountFor(postedEntries, currency)}</Td>
                  <Td style={numCell}>{amountFor(dispositionEntries, currency)}</Td>
                  <Td style={numCell}>{amountFor(residualEntries, currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
