import {
  createPostgresInventoryStore,
  createPostgresRecipeStore,
  listLocations,
  listRecipes,
} from "@aquarela/application";
import { Breadcrumbs, EmptyState, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../../../api/v1/reports/access";
import { SimulationClient } from "./simulation-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "What-if simulation — Aquarela Business Control" };

/**
 * What-if simulation (`W6`, `DEC-125`). A server component that gates the route
 * on the reporting roles, loads the locations in the caller's scope and the
 * organization's recipes for the pickers, then hands the form to the client
 * component. Every figure the simulation returns is a model with its
 * assumptions, provenance and unmodelled list shown — never a fact.
 */
export default async function SimulationPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }
  const access = await loadReportingAccess(session.userId);
  if (!isReportingAuthorized(access, SALES_REPORT_READ_ROLES)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
        <PageHeader
          title="What-if simulation"
          scope="Aquarela Business Control"
          description="Model the effect of a scenario over the cost, price and recipe data."
        />
        <EmptyState title="Not available for your role">
          The simulation reads consolidated margin, so it is not available to your role. Ask an
          owner or general manager if you need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const db = getDb().db;
  const allLocations = await listLocations(createPostgresInventoryStore(db), { organizationId });
  const locations =
    access.locationIds.length > 0
      ? allLocations.filter((location) => access.locationIds.includes(location.id))
      : allLocations;
  const recipes = await listRecipes(createPostgresRecipeStore(db), { organizationId, limit: 200 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        <Breadcrumbs
          items={[
            { label: "Management home", href: "/" },
            { label: "Insights", href: "/insights" },
            { label: "Simulation" },
          ]}
        />
        <PageHeader
          title="What-if simulation"
          scope="Aquarela Business Control"
          description="Simulate volume, price, wage, menu and headcount changes over the existing cost, price and recipe data. Every result is labelled as a model, with its assumptions, provenance and unmodelled terms shown."
        />
      </div>

      {recipes.length === 0 ? (
        <SectionCard title="What-if simulation" meta="needs a recipe">
          <EmptyState title="No recipes yet">
            A menu addition or removal is identified by recipe. Register a recipe with an approved
            version and a product assignment first, then a scenario can model the menu.
          </EmptyState>
        </SectionCard>
      ) : null}

      <SimulationClient
        locations={locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        recipes={recipes.map((listed) => ({
          id: listed.recipe.id,
          code: listed.recipe.code,
          name: listed.recipe.name,
        }))}
        defaultLocationId={locations[0]?.id ?? ""}
      />
    </div>
  );
}
