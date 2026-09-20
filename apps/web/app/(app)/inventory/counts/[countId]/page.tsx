import { createPostgresCountStore, getStockCount } from "@aquarela/application";
import { QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";
import {
  Alert,
  KpiCard,
  PageHeader,
  SectionCard,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";

import {
  loadCountLineRefs,
  toCountLineRows,
  type CountLineRow,
} from "../../../../api/v1/counts/count-rows";
import { countStatusView } from "../counts-table";

import { ApproveCountForm, CancelCountButton } from "./count-actions";
import { CountEntryForm, type CountEntryLine } from "./count-entry-form";

export const dynamic = "force-dynamic";

/** ISO instant → "2026-02-01 00:00 UTC". */
function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function orDash(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function lineLabel(row: CountLineRow): string {
  const item = row.itemName ?? row.itemCode ?? row.itemId;
  const area = row.storageAreaName ?? row.storageAreaCode ?? row.storageAreaId;
  const lot = row.lotNumber === null ? "" : ` · lot ${row.lotNumber}`;
  return `${item} · ${area}${lot}`;
}

/**
 * Count detail (08_UI_UX.md §8.3, §8.6): the variance review table, the
 * blind/sighted entry sheet, and the approve/cancel actions. For a blind,
 * unapproved count the read withholds the expected quantities, so this page
 * cannot render them — the variance table shows only what was counted and an
 * explanation. The count is org-checked before anything is shown.
 */
export default async function CountDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly countId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { countId: rawCountId } = await params;
  const countId = uuidOrNotFound(rawCountId);
  const organizationId = resolveOrganization();
  const store = createPostgresCountStore(getDb().db);

  const detail = await getStockCount(store, { organizationId, stockCountId: countId });
  if (detail === undefined) {
    notFound();
  }

  const [location, refs] = await Promise.all([
    store.findLocation(detail.count.locationId),
    loadCountLineRefs(store, organizationId, detail.lines),
  ]);
  const rows = toCountLineRows(organizationId, detail.lines, refs);

  const status = countStatusView(detail.count.status);
  const varianceCount = rows.filter(
    (row) => row.varianceQty !== null && parseDecimal(row.varianceQty, QUANTITY_SCALE) !== 0n,
  ).length;
  const countedCount = rows.filter((row) => row.countedQty !== null).length;
  const hasPositiveVariance = rows.some(
    (row) => row.varianceQty !== null && parseDecimal(row.varianceQty, QUANTITY_SCALE) > 0n,
  );

  const entryLines: CountEntryLine[] = rows.map((row) => ({
    key: row.id,
    itemId: row.itemId,
    storageAreaId: row.storageAreaId,
    lotId: row.lotId,
    label: lineLabel(row),
    unitCode: row.unitCode,
    countedQty: row.countedQty,
  }));

  const isOpen = detail.count.status === "draft" || detail.count.status === "counting";
  const locationLabel =
    location !== undefined && location.organizationId === organizationId
      ? `${location.code} · ${location.name}`
      : detail.count.locationId;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <PageHeader
        title={`Count · ${locationLabel}`}
        scope="Inventory"
        description={`Cutoff ${formatInstant(detail.count.cutoff)} — expected quantities are the projected balance at that instant.`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Status"
          value={status.label}
          meta={detail.count.blind ? "Blind count (DEC-017)" : "Sighted count"}
        />
        <KpiCard
          label="Lines counted"
          value={`${countedCount} / ${rows.length}`}
          meta="Observed out of snapshot lines"
        />
        <KpiCard
          label="Variances"
          value={detail.expectedHidden ? "hidden" : String(varianceCount)}
          meta={
            detail.expectedHidden
              ? "Hidden until approval on a blind count"
              : "Lines that differ from the expected snapshot"
          }
        />
      </div>

      {detail.expectedHidden ? (
        <Alert tone="info" title="Blind count in progress">
          This count is blind, so the expected quantities and variances stay hidden until it is
          approved. Enter what is physically on the shelf; the comparison happens on approval.
        </Alert>
      ) : null}

      <SectionCard
        title="Variance review"
        meta={`${rows.length} ${rows.length === 1 ? "line" : "lines"}`}
      >
        {rows.length === 0 ? (
          <Alert tone="info">
            No projected stock at this location and cutoff, so the count has no lines to review.
          </Alert>
        ) : (
          <Table
            caption="Count lines and their variances."
            columnCount={detail.expectedHidden ? 4 : 7}
          >
            <thead>
              <tr>
                <Th>Item · area</Th>
                <Th>Lot</Th>
                {detail.expectedHidden ? null : <Th style={numCell}>Expected</Th>}
                <Th style={numCell}>Counted</Th>
                {detail.expectedHidden ? null : (
                  <>
                    <Th style={numCell}>Variance</Th>
                    <Th>Reason</Th>
                    <Th>Recount</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    {row.itemName ?? row.itemCode ?? row.itemId}
                    <span
                      style={{
                        display: "block",
                        fontFamily: typography.fontFamily.mono,
                        fontSize: typography.fontSize.xs,
                        color: color.text.muted,
                      }}
                    >
                      {row.storageAreaName ?? row.storageAreaCode ?? row.storageAreaId}
                    </span>
                  </Td>
                  <Td>{orDash(row.lotNumber)}</Td>
                  {detail.expectedHidden ? null : (
                    <Td style={numCell}>
                      {orDash(row.expectedQty === null ? null : trimDecimal(row.expectedQty))}
                      {row.unitCode === null ? "" : ` ${row.unitCode}`}
                    </Td>
                  )}
                  <Td style={numCell}>
                    {orDash(row.countedQty === null ? null : trimDecimal(row.countedQty))}
                  </Td>
                  {detail.expectedHidden ? null : (
                    <>
                      <Td style={numCell}>
                        {orDash(row.varianceQty === null ? null : trimDecimal(row.varianceQty))}
                      </Td>
                      <Td>{orDash(row.reasonCode)}</Td>
                      <Td>{row.recount ? "Yes" : "No"}</Td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>

      {isOpen ? <CountEntryForm countId={countId} lines={entryLines} /> : null}

      {isOpen ? (
        <>
          <ApproveCountForm countId={countId} hasPositiveVariance={hasPositiveVariance} />
          <SectionCard title="Cancel" meta="discard this count">
            <p style={{ margin: `0 0 ${spacing[3]}px` }}>
              Cancelling keeps the record for the audit trail but stops any further counting or
              approval. Nothing is posted to the ledger.
            </p>
            <CancelCountButton countId={countId} />
          </SectionCard>
        </>
      ) : null}

      {detail.count.status === "approved" ? (
        <Alert tone="success" title="Approved">
          Variances were posted to the ledger
          {detail.count.approvedAt === null ? "" : ` on ${formatInstant(detail.count.approvedAt)}`}.
          A mistake is corrected by reversing the movement (DEC-028), never by editing this count.
        </Alert>
      ) : null}

      {detail.count.status === "cancelled" ? (
        <Alert tone="warning" title="Cancelled">
          This count was cancelled; no variances were posted.
        </Alert>
      ) : null}
    </div>
  );
}
