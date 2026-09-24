import {
  createPostgresMasterDataStore,
  createPostgresRecipeStore,
  createPostgresTaskStore,
  getRecipe,
  listAssignableUsers,
  listItems,
  listRecipeTests,
  listRecipes,
  type RecipeAllergenRecordView,
  type RecipeCostComponent,
  type RecipeDetail,
  type RecipeItemRecord,
  type RecipeStore,
  type RecipeTestView,
} from "@aquarela/application";
import { ROLE_CODE } from "@aquarela/persistence";
import {
  MONEY_SCALE,
  NotFoundError,
  QUANTITY_SCALE,
  divideRoundHalfUp,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";
import {
  Alert,
  Badge,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { uuidOrNotFound } from "../../../../lib/route-params";
import { getServerSession } from "../../../../lib/server-session";

import { RecordRecipeTestForm } from "./record-recipe-test-form";
import { RegisterVersionForm } from "./register-version-form";

export const dynamic = "force-dynamic";

const STATE_TONES = { approved: "success", rejected: "danger", submitted: "warning" } as const;

function stateTone(state: string): "success" | "warning" | "danger" | "info" {
  if (state === "approved" || state === "rejected" || state === "submitted") {
    return STATE_TONES[state];
  }
  return "info";
}

/** Monetary numeric(19,4) string → 2dp display string, HALF_UP (DEC-024). */
function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
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

function instantDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function effectiveWindow(effectiveFrom: Date, effectiveTo: Date | null): string {
  return effectiveTo === null
    ? `from ${instantDay(effectiveFrom)}`
    : `${instantDay(effectiveFrom)} → ${instantDay(effectiveTo)}`;
}

/**
 * The trial yield, **derived** as `actual_output_qty / batch_input_qty` at 6 dp
 * HALF_UP (`DEC-123` clause 2 — never stored). `null` when the test has no
 * measured output. A rate above 1 is possible for a trial (e.g. water added), so
 * this deliberately does not reuse `usableYieldRate`, which bounds to `(0,1]`.
 */
function derivedYield(actualOutputQty: string | null, batchInputQty: string): string | null {
  if (actualOutputQty === null) {
    return null;
  }
  try {
    const output = parseDecimal(actualOutputQty, QUANTITY_SCALE);
    const input = parseDecimal(batchInputQty, QUANTITY_SCALE);
    if (input <= 0n) {
      return null;
    }
    return formatDecimal(divideRoundHalfUp(output * 10n ** 6n, input), 6);
  } catch {
    return null;
  }
}

/** The labels the detail view needs, resolved through the recipe port only. */
interface Refs {
  readonly items: ReadonlyMap<string, RecipeItemRecord>;
  readonly units: ReadonlyMap<string, { readonly code: string }>;
  readonly subRecipes: ReadonlyMap<string, { readonly code: string; readonly name: string }>;
}

async function loadRefs(store: RecipeStore, detail: RecipeDetail): Promise<Refs> {
  const itemIds = [
    ...new Set([
      ...(detail.recipe.outputItemId === null ? [] : [detail.recipe.outputItemId]),
      ...detail.versions.flatMap((entry) =>
        entry.lines.flatMap((line) => (line.itemId === null ? [] : [line.itemId])),
      ),
    ]),
  ];
  const unitIds = [
    ...new Set(detail.versions.flatMap((entry) => entry.lines.map((line) => line.unitId))),
  ];
  const subRecipeIds = [
    ...new Set(
      detail.versions.flatMap((entry) =>
        entry.lines.flatMap((line) => (line.subRecipeId === null ? [] : [line.subRecipeId])),
      ),
    ),
  ];

  const [items, units, subRecipes, outputItem] = await Promise.all([
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(unitIds.map((id) => store.findUnit(id))),
    Promise.all(subRecipeIds.map((id) => store.findRecipe(id))),
    detail.recipe.outputItemId === null
      ? Promise.resolve(undefined)
      : store.findItem(detail.recipe.outputItemId),
  ]);

  // The output item's base unit is resolved too, so the portion can carry a unit.
  const outputUnit =
    outputItem === undefined ? undefined : await store.findUnit(outputItem.baseUnitId);

  const itemMap = new Map<string, RecipeItemRecord>();
  for (const item of [...items, outputItem]) {
    if (item !== undefined) {
      itemMap.set(item.id, item);
    }
  }
  const unitMap = new Map<string, { readonly code: string }>();
  for (const unit of [...units, outputUnit]) {
    if (unit !== undefined) {
      unitMap.set(unit.id, { code: unit.code });
    }
  }
  const subRecipeMap = new Map<string, { readonly code: string; readonly name: string }>();
  for (const subRecipe of subRecipes) {
    if (subRecipe !== undefined) {
      subRecipeMap.set(subRecipe.id, { code: subRecipe.code, name: subRecipe.name });
    }
  }
  return { items: itemMap, units: unitMap, subRecipes: subRecipeMap };
}

function componentLabel(
  component: RecipeCostComponent,
  refs: Refs,
): { readonly primary: string; readonly secondary: string | null } {
  if (component.subRecipeId !== null) {
    const sub = refs.subRecipes.get(component.subRecipeId);
    return { primary: sub?.name ?? component.subRecipeId, secondary: sub?.code ?? "sub-recipe" };
  }
  if (component.itemId !== null) {
    const item = refs.items.get(component.itemId);
    return { primary: item?.name ?? component.itemId, secondary: item?.code ?? null };
  }
  return { primary: component.componentKind, secondary: null };
}

function AllergenBadges({ allergens }: { allergens: readonly RecipeAllergenRecordView[] }) {
  if (allergens.length === 0) {
    return <span style={{ color: color.text.muted }}>None declared</span>;
  }
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
      {allergens.map((allergen) => (
        <span key={allergen.allergenId} style={{ display: "inline-flex", gap: spacing[1] }}>
          <Badge>{allergen.code}</Badge>
          <span style={{ fontSize: typography.fontSize.sm, color: color.text.secondary }}>
            {allergen.name} · {allergen.source}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Recipe editor detail: version/state, nested lines with quantities and units,
 * yield and portion, allergens and the cost preview (`08_UI_UX.md` §8.3). Read
 * only for now — versions are registered through the API; no edits are faked.
 */
export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ recipeId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { recipeId: rawRecipeId } = await params;
  const recipeId = uuidOrNotFound(rawRecipeId);
  const organizationId = resolveOrganization();
  const store = createPostgresRecipeStore(getDb().db);

  let detail: RecipeDetail;
  try {
    detail = await getRecipe(store, { organizationId, recipeId, asOf: new Date() });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const refs = await loadRefs(store, detail);
  const allTests = await listRecipeTests(store, { organizationId, recipeId });

  // The register-version form's pickers. Every option comes from an existing
  // read service; where no read service exists (a unit catalogue, a cost-centre
  // list) the form says so instead of inventing options.
  const [itemPage, listedRecipes, allergens, users] = await Promise.all([
    listItems(createPostgresMasterDataStore(getDb().db), { organizationId, limit: 200 }),
    listRecipes(store, { organizationId }),
    store.listAllergens(organizationId),
    listAssignableUsers(createPostgresTaskStore(getDb().db), { organizationId }),
  ]);
  const itemOptions = await Promise.all(
    itemPage.items.map(async (item) => {
      const unit = await store.findUnit(item.baseUnitId);
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        baseUnitId: item.baseUnitId,
        baseUnitCode: unit?.code ?? "",
      };
    }),
  );
  const subRecipeOptions = await Promise.all(
    listedRecipes
      .filter((entry) => entry.recipe.id !== recipeId && entry.recipe.outputItemId !== null)
      .map(async (entry) => {
        const outputItem =
          entry.recipe.outputItemId === null
            ? undefined
            : await store.findItem(entry.recipe.outputItemId);
        const unit =
          outputItem === undefined ? undefined : await store.findUnit(outputItem.baseUnitId);
        return {
          id: entry.recipe.id,
          code: entry.recipe.code,
          name: entry.recipe.name,
          baseUnitId: outputItem?.baseUnitId ?? "",
          baseUnitCode: unit?.code ?? "",
        };
      }),
  );
  const unlinkedTests = allTests
    .filter((test) => test.resultingRecipeVersionId === null)
    .map((test) => ({
      id: test.id,
      label: `Trial on v${test.testedVersionNo} · ${instantDay(test.testedAt)}`,
    }));
  const nextVersionNo =
    detail.versions.reduce((highest, entry) => Math.max(highest, entry.version.versionNo), 0) + 1;
  const testsByVersion = new Map<string, RecipeTestView[]>();
  for (const test of allTests) {
    const list = testsByVersion.get(test.recipeVersionId);
    if (list === undefined) {
      testsByVersion.set(test.recipeVersionId, [test]);
    } else {
      list.push(test);
    }
  }
  const latest = detail.versions[0];
  const outputItem =
    detail.recipe.outputItemId === null ? undefined : refs.items.get(detail.recipe.outputItemId);
  const outputUnitCode =
    outputItem === undefined ? null : (refs.units.get(outputItem.baseUnitId)?.code ?? null);
  const preview = detail.costPreview;

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
        title={`${detail.recipe.code} — ${detail.recipe.name}`}
        scope="Aquarela Business Control · Recipes"
        description={
          outputItem === undefined
            ? "Made-to-order recipe (no output item, DEC-030)."
            : `Output item ${outputItem.name} (${outputItem.code}).`
        }
        actions={
          <a
            href="/recipes"
            style={{
              color: color.brand.navy,
              fontWeight: typography.fontWeight.semibold,
              fontSize: typography.fontSize.sm,
            }}
          >
            All recipes
          </a>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Versions"
          value={String(detail.versions.length)}
          meta="Newest first · any state"
        />
        <KpiCard
          label="Latest state"
          value={latest === undefined ? "—" : latest.version.state}
          meta={latest === undefined ? "No version registered yet" : `v${latest.version.versionNo}`}
        />
        <KpiCard
          label="Yield rate"
          value={
            latest === undefined
              ? "—"
              : trimDecimal(preview.available ? preview.yieldRate : latest.version.yieldRate)
          }
          meta="Approved usable output ÷ planned input (§6)"
        />
        <KpiCard
          label="Cost / usable unit"
          value={preview.available ? formatMoneyAmount(preview.costPerUsableOutputUnit) : "—"}
          meta={
            preview.available
              ? `${preview.currency} · v${preview.versionNo} · preview, not verified`
              : preview.reason
          }
        />
      </div>

      <SectionCard
        title="Cost preview"
        meta={
          preview.available
            ? `v${preview.versionNo} · ${preview.currency} · ${formatMoneyAmount(
                preview.recipeInputCost,
              )} batch input`
            : "Not costed"
        }
      >
        {CostPreviewBody(preview, refs, outputUnitCode)}
      </SectionCard>

      <SectionCard
        title="Versions"
        meta={`${detail.versions.length} ${detail.versions.length === 1 ? "version" : "versions"}`}
      >
        {detail.versions.length === 0 ? (
          <EmptyState title="No versions yet">
            Register the first version with the form below: its lines, quantities, yield quantities
            and allergen declarations. The cost preview becomes available once a version is
            approved.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
            {detail.versions.map((entry) => (
              <div
                key={entry.version.id}
                id={`version-${entry.version.id}`}
                style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: spacing[3],
                  }}
                >
                  <span
                    style={{
                      fontFamily: typography.fontFamily.display,
                      fontSize: typography.fontSize.lg,
                      fontWeight: typography.fontWeight.semibold,
                    }}
                  >
                    v{entry.version.versionNo}
                  </span>
                  <StatusPill tone={stateTone(entry.version.state)}>
                    {entry.version.state}
                  </StatusPill>
                  <span style={{ fontSize: typography.fontSize.sm, color: color.text.muted }}>
                    {effectiveWindow(entry.version.effectiveFrom, entry.version.effectiveTo)} ·
                    planned output {trimDecimal(entry.version.plannedOutputQty)} · approved usable{" "}
                    {trimDecimal(entry.version.approvedUsableOutput)}
                    {outputUnitCode === null ? "" : ` ${outputUnitCode}`}
                    {entry.version.preparationMinutes === null
                      ? ""
                      : ` · prep ${entry.version.preparationMinutes} min`}
                  </span>
                </div>

                {entry.version.method === null ? null : (
                  <div>
                    <span
                      style={{
                        fontSize: typography.fontSize.sm,
                        fontWeight: typography.fontWeight.semibold,
                        color: color.text.secondary,
                      }}
                    >
                      Method
                    </span>
                    <p
                      style={{
                        margin: `${spacing[1]}px 0 0`,
                        whiteSpace: "pre-wrap",
                        fontSize: typography.fontSize.sm,
                        color: color.text.primary,
                      }}
                    >
                      {entry.version.method}
                    </p>
                  </div>
                )}

                <div>
                  <span
                    style={{
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.semibold,
                      color: color.text.secondary,
                    }}
                  >
                    Lines
                  </span>
                  <Table
                    caption={`Nested lines for version ${entry.version.versionNo}. Quantities pair with each line's unit.`}
                    columnCount={5}
                    emptyMessage="This version has no lines."
                  >
                    <thead>
                      <tr>
                        <Th>Component</Th>
                        <Th>Item / sub-recipe</Th>
                        <Th style={{ textAlign: "right" }}>Quantity</Th>
                        <Th>Unit</Th>
                        <Th style={{ textAlign: "right" }}>Loss factor</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.lines.map((line) => {
                        const item = line.itemId === null ? undefined : refs.items.get(line.itemId);
                        const sub =
                          line.subRecipeId === null
                            ? undefined
                            : refs.subRecipes.get(line.subRecipeId);
                        return (
                          <tr key={line.id}>
                            <Td>{line.componentKind}</Td>
                            <Td>
                              {line.subRecipeId !== null ? (
                                <a
                                  href={`/recipes/${line.subRecipeId}`}
                                  style={{ color: color.brand.navy }}
                                >
                                  {sub?.name ?? line.subRecipeId}
                                </a>
                              ) : (
                                <span title={line.itemId ?? undefined}>
                                  {item?.name ?? line.itemId ?? "—"}
                                </span>
                              )}
                            </Td>
                            <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {trimDecimal(line.quantity)}
                            </Td>
                            <Td>
                              <Badge>{refs.units.get(line.unitId)?.code ?? line.unitId}</Badge>
                            </Td>
                            <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {trimDecimal(line.lossFactor)}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>

                <div style={{ display: "flex", gap: spacing[2], alignItems: "baseline" }}>
                  <span
                    style={{
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.semibold,
                      color: color.text.secondary,
                    }}
                  >
                    Allergens
                  </span>
                  <AllergenBadges allergens={entry.allergens} />
                </div>

                <VersionTests
                  recipeId={detail.recipe.id}
                  versionId={entry.version.id}
                  tests={testsByVersion.get(entry.version.id) ?? []}
                />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <RegisterVersionForm
        recipeId={detail.recipe.id}
        nextVersionNo={nextVersionNo}
        items={itemOptions}
        subRecipes={subRecipeOptions}
        allergens={allergens.map((allergen) => ({
          id: allergen.id,
          code: allergen.code,
          name: allergen.name,
        }))}
        unlinkedTests={unlinkedTests}
        users={users.map((user) => ({ id: user.id, displayName: user.displayName }))}
        roleCodes={ROLE_CODE}
      />
    </div>
  );
}

/**
 * The per-version **Tests** section (`DEC-123`): each recorded trial with its
 * tested date, batch size, measured output, the **derived** yield
 * (`actual_output / batch_input`), duration, an *illustrative* cost (a recorded
 * observation, not a computed verified cost), the comments/proposal, and a link
 * to the version the trial motivated. The record form appends a new trial below.
 */
function VersionTests({
  recipeId,
  versionId,
  tests,
}: {
  readonly recipeId: string;
  readonly versionId: string;
  readonly tests: readonly RecipeTestView[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
      <span
        style={{
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          color: color.text.secondary,
        }}
      >
        Tests
      </span>
      <Table
        caption={`Recipe trials recorded for version ${versionId}. The yield is derived from the measured output and batch input; a recorded cost is illustrative, not a computed verified cost.`}
        columnCount={8}
        emptyMessage="No trials recorded for this version yet."
      >
        <thead>
          <tr>
            <Th>Tested</Th>
            <Th style={{ textAlign: "right" }}>Batch input</Th>
            <Th style={{ textAlign: "right" }}>Actual output</Th>
            <Th style={{ textAlign: "right" }}>Yield (derived)</Th>
            <Th style={{ textAlign: "right" }}>Duration</Th>
            <Th>Cost</Th>
            <Th>Quality / proposal</Th>
            <Th>Resulting</Th>
          </tr>
        </thead>
        <tbody>
          {tests.map((test) => {
            const yieldRate = derivedYield(test.actualOutputQty, test.batchInputQty);
            return (
              <tr key={test.id}>
                <Td>{instantDay(test.testedAt)}</Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {trimDecimal(test.batchInputQty)}
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {test.actualOutputQty === null ? "—" : trimDecimal(test.actualOutputQty)}
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {yieldRate === null ? "—" : trimDecimal(yieldRate)}
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {test.actualDurationMinutes === null ? "—" : `${test.actualDurationMinutes} min`}
                </Td>
                <Td>
                  {test.actualCost === null ? (
                    "—"
                  ) : (
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatMoneyAmount(test.actualCost)}
                        {test.currency === null ? "" : ` ${test.currency}`}
                      </span>
                      <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
                        illustrative
                      </span>
                    </span>
                  )}
                </Td>
                <Td>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{test.qualityComments ?? "—"}</span>
                    {test.proposedAdjustment === null ? null : (
                      <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
                        Proposal: {test.proposedAdjustment}
                      </span>
                    )}
                  </span>
                </Td>
                <Td>
                  {test.resultingRecipeVersionId === null ? (
                    "—"
                  ) : (
                    <a
                      href={`/recipes/${recipeId}#version-${test.resultingRecipeVersionId}`}
                      style={{ color: color.brand.navy }}
                    >
                      v{test.resultingVersionNo ?? "?"}
                    </a>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <RecordRecipeTestForm recipeId={recipeId} recipeVersionId={versionId} />
    </div>
  );
}

/** The cost-preview body: totals plus the per-component breakdown. */
function CostPreviewBody(
  preview: RecipeDetail["costPreview"],
  refs: Refs,
  outputUnitCode: string | null,
) {
  if (!preview.available) {
    return (
      <Alert tone="info" title="Cost preview unavailable">
        {preview.reason}
      </Alert>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Batch input cost"
          value={`${formatMoneyAmount(preview.recipeInputCost)} ${preview.currency}`}
          meta="Sum of line costs at required purchase quantities (B2)"
        />
        <KpiCard
          label="Batch output cost"
          value={`${formatMoneyAmount(preview.recipeOutputCost)} ${preview.currency}`}
          meta="Batch input plus any batch variable cost (§6)"
        />
        <KpiCard
          label="Cost per usable unit"
          value={`${formatMoneyAmount(preview.costPerUsableOutputUnit)} ${preview.currency}`}
          meta={`Divided by approved usable output${
            outputUnitCode === null ? "" : ` (${outputUnitCode})`
          } (B3)`}
        />
      </div>
      <Table
        caption={`Cost components for version ${preview.versionNo}. Required quantity is grossed up for the line loss factor and recipe yield; each source follows the DEC-047 precedence.`}
        columnCount={5}
        emptyMessage="This version has no costed components."
      >
        <thead>
          <tr>
            <Th>Component</Th>
            <Th style={{ textAlign: "right" }}>Required qty</Th>
            <Th style={{ textAlign: "right" }}>Unit cost</Th>
            <Th style={{ textAlign: "right" }}>Line cost</Th>
            <Th>Source</Th>
          </tr>
        </thead>
        <tbody>
          {preview.components.map((component, index) => {
            const label = componentLabel(component, refs);
            return (
              <tr key={`${component.subRecipeId ?? component.itemId ?? index}`}>
                <Td>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{label.primary}</span>
                    <span
                      style={{
                        fontFamily: typography.fontFamily.mono,
                        fontSize: typography.fontSize.xs,
                        color: color.text.muted,
                      }}
                    >
                      {component.componentKind}
                      {label.secondary === null ? "" : ` · ${label.secondary}`}
                    </span>
                  </span>
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {trimDecimal(component.requiredPurchaseQuantity)}{" "}
                  <Badge>{refs.units.get(component.unitId)?.code ?? component.unitId}</Badge>
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {formatMoneyAmount(component.unitCost)}
                </Td>
                <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {formatMoneyAmount(component.lineCost)}
                </Td>
                <Td>
                  <Badge>{component.sourceType}</Badge>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p style={{ margin: 0, fontSize: typography.fontSize.xs, color: color.text.muted }}>
        Preview only. This is not the signed-off verified cost until the golden fixtures are signed
        (DEC-065); labour, packaging and allocation from slice 6 are not folded in here.
      </p>
    </div>
  );
}
