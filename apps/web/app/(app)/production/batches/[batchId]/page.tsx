import {
  createPostgresProductionStore,
  getProductionBatch,
  resolvePlannedSnapshot,
} from "@aquarela/application";
import type { PlannedSnapshot } from "@aquarela/application";
import { QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";
import {
  Alert,
  DescriptionList,
  KpiCard,
  PageHeader,
  SectionCard,
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
import {
  loadProductionRefs,
  toProductionBatchInputRows,
  toProductionBatchOutputRows,
  toProductionBatchRows,
} from "../../../../api/v1/production/production-rows";
import {
  formatInstant,
  hasYieldVariance,
  orDash,
  productionStatusView,
  trimDecimal,
  yieldVarianceLabel,
} from "../../production-labels";

import { BatchLifecycleActions, CompleteBatchForm } from "./batch-actions";

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

interface InputLineView {
  readonly key: string;
  readonly itemLabel: string;
  readonly unitCode: string | null;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly reasonCode: string | null;
  readonly lotLabel: string | null;
}

interface OutputLineView {
  readonly key: string;
  readonly itemLabel: string;
  readonly unitCode: string | null;
  readonly kind: string;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotLabel: string | null;
  readonly expiryDate: string | null;
}

/**
 * Batch detail (08_UI_UX.md §8.3, §8.6): the recipe version, planned vs actual
 * input lines with variance and reason, the outputs, the timestamps, and the
 * completion action with actual quantities and the required draw area.
 *
 * The persisted lines only exist after completion (open point (i)), so for a
 * batch that is not yet complete the page resolves the planned snapshot from the
 * immutable approved recipe version and shows it as the planned side. The ledger
 * is untouched until completion.
 */
export default async function ProductionBatchDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly batchId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { batchId: rawBatchId } = await params;
  const batchId = uuidOrNotFound(rawBatchId);
  const organizationId = resolveOrganization();
  const store = createPostgresProductionStore(getDb().db);

  const detail = await getProductionBatch(store, { organizationId, productionBatchId: batchId });
  if (detail === undefined) {
    notFound();
  }
  const batch = detail.batch;

  // Planned snapshot for a batch that has no persisted lines yet. Resolving it
  // can reject (a recipe that lost its output item, a broken conversion); the
  // failure is surfaced, not invented around.
  const version = await store.findRecipeVersion(batch.recipeVersionId);
  let snapshot: PlannedSnapshot | undefined;
  let snapshotError: string | null = null;
  if (version !== undefined && batch.status !== "completed") {
    try {
      snapshot = await resolvePlannedSnapshot(store, {
        organizationId,
        version,
        asOf: batch.plannedStart === null ? new Date() : new Date(batch.plannedStart),
      });
    } catch (error) {
      snapshotError =
        error instanceof Error ? error.message : "planned snapshot could not be resolved";
    }
  }

  const [refs, areas] = await Promise.all([
    loadProductionRefs(
      store,
      organizationId,
      [batch],
      detail.inputs,
      detail.outputs,
      snapshot?.inputs.map((line) => line.itemId) ?? [],
    ),
    store.listStorageAreas({ organizationId, locationId: batch.locationId }),
  ]);

  const [batchRow] = toProductionBatchRows(organizationId, [batch], refs);
  const persistedInputs = toProductionBatchInputRows(organizationId, detail.inputs, refs);
  const persistedOutputs = toProductionBatchOutputRows(organizationId, detail.outputs, refs);

  const inputViews: InputLineView[] =
    persistedInputs.length > 0
      ? persistedInputs.map((row) => ({
          key: row.id,
          itemLabel: row.itemName ?? row.itemCode ?? row.itemId,
          unitCode: row.unitCode,
          plannedQty: row.plannedQty,
          actualQty: row.actualQty,
          varianceQty: row.varianceQty,
          reasonCode: row.reasonCode,
          lotLabel: row.lotNumber,
        }))
      : (snapshot?.inputs ?? []).map((line) => {
          const item = refs.items.get(line.itemId);
          const unit = refs.units.get(line.unitId);
          return {
            key: line.itemId,
            itemLabel: item?.name ?? item?.code ?? line.itemId,
            unitCode: unit?.code ?? null,
            plannedQty: line.plannedQty,
            actualQty: null,
            varianceQty: null,
            reasonCode: null,
            lotLabel: null,
          };
        });

  const outputViews: OutputLineView[] =
    persistedOutputs.length > 0
      ? persistedOutputs.map((row) => ({
          key: row.id,
          itemLabel: row.itemName ?? row.itemCode ?? row.itemId,
          unitCode: row.unitCode,
          kind: row.kind,
          plannedQty: row.plannedQty,
          actualQty: row.actualQty,
          varianceQty: row.varianceQty,
          lotLabel: row.lotNumber,
          expiryDate: row.expiryDate,
        }))
      : (snapshot?.outputs ?? []).map((line) => {
          const item = refs.items.get(line.itemId);
          const unit = refs.units.get(line.unitId);
          return {
            key: line.itemId,
            itemLabel: item?.name ?? item?.code ?? line.itemId,
            unitCode: unit?.code ?? null,
            kind: line.kind,
            plannedQty: line.plannedQty,
            actualQty: null,
            varianceQty: null,
            lotLabel: null,
            expiryDate: null,
          };
        });

  const status = productionStatusView(batch.status);
  const location = refs.locations.get(batch.locationId);
  const recipe = batchRow?.recipeName ?? batchRow?.recipeCode ?? null;
  const destinationArea = areas.find((area) => area.id === batch.destinationStorageAreaId);
  const completeOutput = snapshot?.outputs[0];
  const canComplete =
    batch.status === "in_progress" &&
    snapshot !== undefined &&
    completeOutput !== undefined &&
    batch.destinationStorageAreaId !== null;
  const isCompletedWithVariance =
    batch.status === "completed" && hasYieldVariance(batch.yieldVariancePct);

  return (
    <div style={contentColumn}>
      <PageHeader
        title={`Batch · ${recipe ?? "recipe not found"}`}
        scope="Production"
        description={`${location?.code ?? batch.locationId} · batch ${batch.id}`}
      />

      <Tabs
        items={[
          { label: "Board", href: "/production" },
          { label: "Plans", href: "/production/plans" },
        ]}
        ariaLabel="Production sections"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Status" value={status.label} meta="Batch workflow" />
        <KpiCard
          label="Planned output"
          value={batch.plannedOutputQty === null ? "—" : trimDecimal(batch.plannedOutputQty)}
          meta={batchRow?.outputUnitCode ?? "unit not resolved"}
        />
        <KpiCard
          label="Actual output"
          value={batch.actualOutputQty === null ? "—" : trimDecimal(batch.actualOutputQty)}
          meta={batchRow?.outputUnitCode ?? "Not completed yet"}
        />
        <KpiCard
          label="Yield variance"
          value={yieldVarianceLabel(batch.yieldVariancePct)}
          meta="Stored fact · no tolerance configured (PROD-003)"
        />
      </div>

      {isCompletedWithVariance ? (
        <Alert tone="warning" title="Yield variance">
          This batch finished with a yield variance of {yieldVarianceLabel(batch.yieldVariancePct)}.
          `PROD-003` has no tolerance or exception store, so the variance is recorded as a fact and
          no threshold is applied here.
        </Alert>
      ) : null}

      <SectionCard title="Batch" meta={status.label}>
        <DescriptionList
          items={[
            {
              term: "Recipe",
              description:
                batchRow === undefined || batchRow.recipeName === null
                  ? "Not found in this organization"
                  : `${batchRow.recipeName} · v${batchRow.recipeVersionNo ?? "?"}`,
            },
            {
              term: "Output item",
              description:
                batchRow === undefined || batchRow.outputItemCode === null
                  ? "Not resolved"
                  : `${batchRow.outputItemCode} · ${batchRow.outputItemName ?? ""}`.trim(),
            },
            {
              term: "Location",
              description:
                location === undefined ? batch.locationId : `${location.code} · ${location.name}`,
            },
            { term: "Workstation", description: orDash(batch.workstation) },
            { term: "Plan", description: orDash(batch.planId) },
            {
              term: "Destination area",
              description:
                batch.destinationStorageAreaId === null
                  ? "Not set — completion cannot post the output until it is (open point (e))"
                  : (destinationArea?.name ?? batch.destinationStorageAreaId),
            },
            {
              term: "Planned start",
              description: batch.plannedStart === null ? "—" : formatInstant(batch.plannedStart),
            },
            {
              term: "Actual start",
              description: batch.actualStart === null ? "—" : formatInstant(batch.actualStart),
            },
            {
              term: "Actual finish",
              description: batch.actualFinish === null ? "—" : formatInstant(batch.actualFinish),
            },
            { term: "Created", description: formatInstant(batch.createdAt) },
          ]}
        />
      </SectionCard>

      {snapshotError !== null ? (
        <Alert tone="danger" title="Planned snapshot unavailable">
          {snapshotError}. The batch cannot be completed until the recipe version resolves to a
          stocked output item (PROD-001).
        </Alert>
      ) : null}

      <SectionCard
        title="Inputs · planned vs actual"
        meta={
          persistedInputs.length > 0
            ? `${persistedInputs.length} persisted lines`
            : snapshot === undefined
              ? "no planned lines"
              : `${snapshot.inputs.length} planned lines`
        }
      >
        {inputViews.length === 0 ? (
          <Alert tone="info">
            This recipe has no input components. Completion records the output only.
          </Alert>
        ) : (
          <Table
            caption="Batch input lines with planned, actual and variance quantities."
            columnCount={6}
          >
            <thead>
              <tr>
                <Th>Item</Th>
                <Th style={numCell}>Planned</Th>
                <Th style={numCell}>Actual</Th>
                <Th style={numCell}>Variance</Th>
                <Th>Reason</Th>
                <Th>Lot</Th>
              </tr>
            </thead>
            <tbody>
              {inputViews.map((line) => {
                const variance = line.varianceQty;
                return (
                  <tr key={line.key}>
                    <Td>{line.itemLabel}</Td>
                    <Td style={numCell}>
                      {trimDecimal(line.plannedQty)}
                      {line.unitCode === null ? "" : ` ${line.unitCode}`}
                    </Td>
                    <Td style={numCell}>
                      {line.actualQty === null ? "—" : trimDecimal(line.actualQty)}
                    </Td>
                    <Td
                      style={{
                        ...numCell,
                        color:
                          variance !== null && parseDecimal(variance, QUANTITY_SCALE) !== 0n
                            ? color.status.warning.fg
                            : undefined,
                      }}
                    >
                      {variance === null ? "—" : trimDecimal(variance)}
                    </Td>
                    <Td>{orDash(line.reasonCode)}</Td>
                    <Td>{orDash(line.lotLabel)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Outputs"
        meta={outputViews.length === 0 ? "none recorded" : `${outputViews.length} line(s)`}
      >
        {outputViews.length === 0 ? (
          <Alert tone="info">
            No output line yet. The output row is written when the batch completes; the planned
            output is snapshotted on the batch header as {batch.plannedOutputQty ?? "—"}.
          </Alert>
        ) : (
          <Table
            caption="Batch output lines with planned, actual and variance quantities."
            columnCount={7}
          >
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Kind</Th>
                <Th style={numCell}>Planned</Th>
                <Th style={numCell}>Actual</Th>
                <Th style={numCell}>Variance</Th>
                <Th>Lot</Th>
                <Th>Expiry</Th>
              </tr>
            </thead>
            <tbody>
              {outputViews.map((line) => (
                <tr key={line.key}>
                  <Td>{line.itemLabel}</Td>
                  <Td>{line.kind}</Td>
                  <Td style={numCell}>
                    {trimDecimal(line.plannedQty)}
                    {line.unitCode === null ? "" : ` ${line.unitCode}`}
                  </Td>
                  <Td style={numCell}>
                    {line.actualQty === null ? "—" : trimDecimal(line.actualQty)}
                  </Td>
                  <Td style={numCell}>
                    {line.varianceQty === null ? "—" : trimDecimal(line.varianceQty)}
                  </Td>
                  <Td>{orDash(line.lotLabel)}</Td>
                  <Td>{orDash(line.expiryDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>

      {batch.status === "completed" ? (
        <Alert tone="success" title="Completed">
          Consumption and output were posted to the append-only ledger
          {batch.actualFinish === null ? "" : ` at ${formatInstant(batch.actualFinish)}`}. A mistake
          is corrected by reversing the movements (DEC-028), never by editing this batch.
        </Alert>
      ) : null}

      {batch.status === "cancelled" ? (
        <Alert tone="warning" title="Cancelled">
          This batch was cancelled before completion; nothing was posted to the ledger.
        </Alert>
      ) : null}

      <BatchLifecycleActions batchId={batch.id} status={batch.status} />

      {batch.status === "in_progress" && batch.destinationStorageAreaId === null ? (
        <Alert tone="warning" title="No destination storage area">
          This batch has no destination storage area, so completion cannot post the output. There is
          no endpoint to set it after planning (open point (e)) — cancel and re-plan the batch with
          a destination.
        </Alert>
      ) : null}

      {canComplete && completeOutput !== undefined && snapshot !== undefined ? (
        <CompleteBatchForm
          batchId={batch.id}
          inputs={snapshot.inputs.map((line) => {
            const item = refs.items.get(line.itemId);
            const unit = refs.units.get(line.unitId);
            return {
              itemId: line.itemId,
              label: item?.name ?? item?.code ?? line.itemId,
              unitCode: unit?.code ?? null,
              plannedQty: line.plannedQty,
            };
          })}
          output={{
            itemId: completeOutput.itemId,
            label:
              refs.items.get(completeOutput.itemId)?.name ??
              refs.items.get(completeOutput.itemId)?.code ??
              completeOutput.itemId,
            unitCode: refs.units.get(completeOutput.unitId)?.code ?? null,
            plannedQty: completeOutput.plannedQty,
          }}
          areas={areas.map((area) => ({ id: area.id, code: area.code, name: area.name }))}
        />
      ) : null}
    </div>
  );
}
