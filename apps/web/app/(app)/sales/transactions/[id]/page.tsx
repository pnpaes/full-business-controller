import { createPostgresSalesStore, getSalesTransaction } from "@aquarela/application";
import {
  DescriptionList,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  spacing,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";
import { loadSalesRefs } from "../../../../api/v1/sales/sales-refs";
import { toSalesLineRows, toSalesTransactionRows } from "../../../../api/v1/sales/sales-rows";
import { formatInstant, mappingStateView, orDash } from "../../import-labels";
import { optionKindView } from "../../sales-labels";

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

/**
 * Sales transaction detail (08_UI_UX.md §8.3): the header totals and the lines
 * with quantity, unit price, amounts, the captured applied tax rate, the option
 * kind (`DEC-043`) and the line's mapping state.
 *
 * Recorded, not resolved: `applied_tax_rate` is shown exactly as captured and
 * never re-derived (`DEC-045`; A4); a reversal (`DEC-028`) is not implemented,
 * so `reversalOfId` is shown as a stored fact and no reversal action is offered.
 */
export default async function SalesTransactionDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { id: rawId } = await params;
  const id = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresSalesStore(db);

  const detail = await getSalesTransaction(store, { organizationId, salesTransactionId: id });
  if (detail === undefined) {
    notFound();
  }

  const refs = await loadSalesRefs(db, organizationId, [detail.transaction]);
  const rows = toSalesTransactionRows(
    organizationId,
    [detail.transaction],
    refs,
    new Map([[detail.transaction.id, detail.lines.length]]),
  );
  const header = rows[0];
  const lines = toSalesLineRows(organizationId, detail.lines);

  if (header === undefined) {
    notFound();
  }

  const location =
    header.locationCode === null && header.locationName === null
      ? "— (the source carried no resolvable location)"
      : `${orDash(header.locationCode)} · ${orDash(header.locationName)}`;
  const channel =
    header.channelCode === null && header.channelName === null
      ? "— (the source carried no resolvable channel)"
      : `${orDash(header.channelCode)} · ${orDash(header.channelName)}`;

  return (
    <div style={contentColumn}>
      <PageHeader
        title={`Sales transaction · ${header.externalTransactionId}`}
        scope="Sales · Transactions"
        description={`${formatInstant(header.occurredAt)} · ${header.currency} · ${header.sourceSystem}`}
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

      <SectionCard title="Header">
        <DescriptionList
          items={[
            { term: "Source system", description: header.sourceSystem },
            { term: "External transaction id", description: header.externalTransactionId },
            { term: "Occurred at", description: formatInstant(header.occurredAt) },
            { term: "Location", description: location },
            { term: "Channel", description: channel },
            {
              term: "Gross",
              description: orDash(header.grossAmount),
            },
            { term: "Net", description: orDash(header.netAmount) },
            { term: "Tax", description: orDash(header.taxAmount) },
            { term: "Discount", description: orDash(header.discountAmount) },
            { term: "Refund", description: orDash(header.refundAmount) },
            { term: "Currency", description: header.currency },
            { term: "Lines", description: String(header.lineCount) },
            {
              term: "Import run",
              description:
                header.importRunId === null
                  ? "— (posted outside an import run)"
                  : header.importRunId,
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="Lines" meta={lines.length === 0 ? "none" : `${lines.length} line(s)`}>
        {lines.length === 0 ? (
          <EmptyState title="No lines recorded for this transaction">
            A transaction with no lines carries only its header totals. This is possible when a
            staged row was posted for a transaction whose remaining rows were dispositioned.
          </EmptyState>
        ) : (
          <Table
            caption="Sales lines. Amounts are stored numeric(19,4); applied_tax_rate is the rate actually applied, captured verbatim and never re-derived (DEC-042/DEC-045)."
            columnCount={9}
          >
            <thead>
              <tr>
                <Th>Product</Th>
                <Th style={numCell}>Qty</Th>
                <Th style={numCell}>Unit price</Th>
                <Th style={numCell}>Gross</Th>
                <Th style={numCell}>Net</Th>
                <Th style={numCell}>Tax (applied rate)</Th>
                <Th>Option</Th>
                <Th>Mapping</Th>
                <Th>Reversal</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const mapping = mappingStateView(line.mappingState);
                return (
                  <tr key={line.id}>
                    <Td>
                      {orDash(line.sku)}
                      {line.externalProductRef === null ? null : (
                        <span style={{ display: "block", opacity: 0.7 }}>
                          {line.externalProductRef}
                        </span>
                      )}
                    </Td>
                    <Td style={numCell}>{line.quantity}</Td>
                    <Td style={numCell}>{orDash(line.unitPrice)}</Td>
                    <Td style={numCell}>{orDash(line.grossAmount)}</Td>
                    <Td style={numCell}>{orDash(line.netAmount)}</Td>
                    <Td style={numCell}>
                      {orDash(line.taxAmount)}
                      <span style={{ display: "block", opacity: 0.7 }}>
                        {orDash(line.appliedTaxRate)}
                      </span>
                    </Td>
                    <Td>{optionKindView(line.optionKind)}</Td>
                    <Td>
                      <StatusPill tone={mapping.tone}>{mapping.label}</StatusPill>
                    </Td>
                    <Td>{line.reversalOfId === null ? "—" : line.reversalOfId}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
