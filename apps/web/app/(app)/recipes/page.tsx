import {
  createPostgresMasterDataStore,
  createPostgresRecipeStore,
  listItems,
  listRecipes,
  type ListedRecipe,
  type RecipeItemRecord,
} from "@aquarela/application";
import { MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";
import {
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
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { NewRecipeForm } from "./new-recipe-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recipes — Aquarela Business Control" };

const STATE_TONES = {
  approved: "success",
  rejected: "danger",
  submitted: "warning",
} as const;

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

/** Resolves each recipe's output item through the recipe port's org-checked lookup. */
async function loadOutputItems(
  store: ReturnType<typeof createPostgresRecipeStore>,
  listed: readonly ListedRecipe[],
): Promise<ReadonlyMap<string, RecipeItemRecord>> {
  const ids = [
    ...new Set(
      listed.flatMap((entry) =>
        entry.recipe.outputItemId === null ? [] : [entry.recipe.outputItemId],
      ),
    ),
  ];
  const items = await Promise.all(ids.map((id) => store.findItem(id)));
  const map = new Map<string, RecipeItemRecord>();
  for (const item of items) {
    if (item !== undefined) {
      map.set(item.id, item);
    }
  }
  return map;
}

/**
 * Recipes: versioned recipe identities with their latest version and a cost
 * preview (`08_UI_UX.md` §8.3, "Recipe editor"). Real data only — an empty
 * organization gets an `EmptyState`, not a fabricated list.
 */
export default async function RecipesPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresRecipeStore(getDb().db);
  const listed = await listRecipes(store, { organizationId });
  const outputItems = await loadOutputItems(store, listed);
  const itemPage = await listItems(createPostgresMasterDataStore(getDb().db), {
    organizationId,
    limit: 200,
  });

  const approvedCount = listed.filter((entry) => entry.latestVersion?.state === "approved").length;
  const costedCount = listed.filter((entry) => entry.costPreview.available).length;
  const versionCount = listed.filter((entry) => entry.latestVersion !== null).length;

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
        title="Recipes"
        scope="Aquarela Business Control · Products"
        description="Recipe identities with their latest version, state and cost preview."
        actions={
          <a
            href="/products"
            style={{
              color: color.brand.navy,
              fontWeight: typography.fontWeight.semibold,
              fontSize: typography.fontSize.sm,
            }}
          >
            Products area
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
          label="Recipes"
          value={String(listed.length)}
          meta="Served organization · all states"
        />
        <KpiCard
          label="With a version"
          value={String(versionCount)}
          meta="A recipe version is required before it can be costed"
        />
        <KpiCard
          label="Latest version approved"
          value={String(approvedCount)}
          meta="Only an approved version produces a cost (COST-002)"
        />
        <KpiCard
          label="Cost preview available"
          value={String(costedCount)}
          meta="Approved version with a resolvable cost source (DEC-047)"
        />
      </div>

      <SectionCard
        title="All recipes"
        meta={`${listed.length} ${listed.length === 1 ? "recipe" : "recipes"}`}
      >
        {listed.length === 0 ? (
          <EmptyState
            title="No recipes yet"
            action={
              <a
                href="/products"
                style={{ color: color.brand.navy, fontWeight: typography.fontWeight.semibold }}
              >
                Go to Products
              </a>
            }
          >
            Recipes appear here once registered, with their versions and cost preview. Register the
            first recipe below, then add a version with its lines and allergens.
          </EmptyState>
        ) : (
          <Table
            caption="Recipes with their latest version and cost preview. A cost preview requires an approved version and a resolvable cost source."
            columnCount={6}
          >
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Latest version</Th>
                <Th>State</Th>
                <Th>Output item</Th>
                <Th style={{ textAlign: "right" }}>Cost / usable unit</Th>
              </tr>
            </thead>
            <tbody>
              {listed.map((entry) => {
                const output =
                  entry.recipe.outputItemId === null
                    ? undefined
                    : outputItems.get(entry.recipe.outputItemId);
                return (
                  <tr key={entry.recipe.id}>
                    <Td>
                      <a
                        href={`/recipes/${entry.recipe.id}`}
                        style={{
                          color: color.brand.navy,
                          fontWeight: typography.fontWeight.semibold,
                          fontFamily: typography.fontFamily.mono,
                        }}
                      >
                        {entry.recipe.code}
                      </a>
                    </Td>
                    <Td>
                      <a href={`/recipes/${entry.recipe.id}`} style={{ color: color.text.primary }}>
                        {entry.recipe.name}
                      </a>
                    </Td>
                    <Td>
                      {entry.latestVersion === null ? (
                        <span style={{ color: color.text.muted }}>—</span>
                      ) : (
                        `v${entry.latestVersion.versionNo}`
                      )}
                    </Td>
                    <Td>
                      {entry.latestVersion === null ? (
                        <span style={{ color: color.text.muted }}>—</span>
                      ) : (
                        <StatusPill tone={stateTone(entry.latestVersion.state)}>
                          {entry.latestVersion.state}
                        </StatusPill>
                      )}
                    </Td>
                    <Td>
                      {entry.recipe.outputItemId === null ? (
                        <span style={{ color: color.text.muted }}>Made to order</span>
                      ) : (
                        <a
                          href="/products"
                          title={entry.recipe.outputItemId}
                          style={{ color: color.brand.navy, textDecoration: "none" }}
                        >
                          {output === undefined ? (
                            <span style={{ fontFamily: typography.fontFamily.mono }}>
                              {entry.recipe.outputItemId}
                            </span>
                          ) : (
                            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span>{output.name}</span>
                              <span
                                style={{
                                  fontFamily: typography.fontFamily.mono,
                                  fontSize: typography.fontSize.xs,
                                  color: color.text.muted,
                                }}
                              >
                                {output.code}
                              </span>
                            </span>
                          )}
                        </a>
                      )}
                    </Td>
                    <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {entry.costPreview.available ? (
                        <span
                          title={`${entry.costPreview.currency} · yield ${trimDecimal(
                            entry.costPreview.yieldRate,
                          )}`}
                          style={{ fontWeight: typography.fontWeight.semibold }}
                        >
                          {formatMoneyAmount(entry.costPreview.costPerUsableOutputUnit)}{" "}
                          {entry.costPreview.currency}
                        </span>
                      ) : (
                        <span title={entry.costPreview.reason} style={{ color: color.text.muted }}>
                          Not costed
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Register a recipe"
        meta="Identity only — add a version next"
        headingLevel={2}
      >
        <NewRecipeForm
          items={itemPage.items.map((item) => ({
            id: item.id,
            code: item.code,
            name: item.name,
          }))}
        />
      </SectionCard>

      <p
        style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
        }}
      >
        <Badge>Real data</Badge> Costs are previews at moving weighted average / DEC-047 cost-source
        precedence and are not the signed-off verified figure until the golden fixtures are signed.
      </p>
    </div>
  );
}
