import {
  createPostgresMasterDataStore,
  createPostgresProductStore,
  findProductVariant,
  listAssignmentOptions,
  listItems,
  listProducts,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import {
  Badge,
  DescriptionList,
  EmptyState,
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

import { getDb } from "../../../../../../../lib/db";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../../../lib/route-params";
import { getServerSession } from "../../../../../../../lib/server-session";

import { AddonApplicabilityForm } from "./addon-applicability-form";
import { AssignRecipeForm } from "./assign-recipe-form";
import { EditVariantForm } from "./edit-variant-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Variant — Aquarela Business Control" };

/** A `Date` as its `yyyy-mm-dd` calendar day. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * One variant (`DEC-128`), nested under its product: the edit surface reached
 * from the product view. Its identity, the mutable-field editor, the
 * effective-dated recipe assignments and the add-on applicability rows naming
 * its product. `code`, `sku` and the product are shown read-only because they
 * anchor identity and are never rewritten. A variant id that is unknown, in
 * another organization, or reached under a different product renders the 404
 * state rather than a raw domain error.
 */
export default async function VariantPage({
  params,
}: {
  readonly params: Promise<{ readonly productId: string; readonly variantId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const routeParams = await params;
  const productId = uuidOrNotFound(routeParams.productId);
  const variantId = uuidOrNotFound(routeParams.variantId);
  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresProductStore(db);

  const detail = await findProductVariant(store, {
    organizationId,
    productVariantId: variantId,
  }).catch((error: unknown) => {
    if (error instanceof DomainError) {
      notFound();
    }
    throw error;
  });
  if (detail.product.id !== productId) {
    notFound();
  }

  const [options, products] = await Promise.all([
    listAssignmentOptions(store, { organizationId }),
    listProducts(store, { organizationId }),
  ]);
  const organization = await createPostgresMasterDataStore(db).findOrganization(organizationId);
  const currency = organization?.currency ?? null;
  const itemPage = await listItems(createPostgresMasterDataStore(db), {
    organizationId,
    limit: 200,
  });
  const finishedGood =
    detail.variant.finishedGoodItemId === null
      ? undefined
      : itemPage.items.find((item) => item.id === detail.variant.finishedGoodItemId);

  const baseProducts = products
    .map(({ product }) => product)
    .filter((product) => product.id !== detail.product.id);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <PageHeader
        title={`${detail.product.code} · ${detail.variant.code}`}
        scope="Sellable variant"
        description="The sellable identity: its SKU, the recipe it is made from and the add-ons it accepts."
      />

      <p style={{ margin: 0 }}>
        <a href={`/products/sellables/${detail.product.id}`} style={{ color: color.brand.navy }}>
          ← Back to {detail.product.code}
        </a>
      </p>

      <SectionCard title="Identity" meta="read-only">
        <DescriptionList
          items={[
            { term: "Product", description: `${detail.product.code} — ${detail.product.name}` },
            { term: "Variant code", description: detail.variant.code },
            { term: "SKU", description: detail.variant.sku },
            {
              term: "Finished good",
              description:
                detail.variant.finishedGoodItemId === null
                  ? "Made to order (no stocked item)"
                  : finishedGood === undefined
                    ? detail.variant.finishedGoodItemId
                    : `${finishedGood.code} · ${finishedGood.name}`,
            },
            { term: "Active from", description: detail.variant.activeFrom },
          ]}
        />
      </SectionCard>

      <SectionCard title="Edit variant" meta="display fields and the finished-good link">
        <EditVariantForm
          productVariantId={detail.variant.id}
          name={detail.variant.name}
          size={detail.variant.size}
          finishedGoodItemId={detail.variant.finishedGoodItemId}
        />
      </SectionCard>

      <SectionCard title="Recipe assignment" meta="approved version · location · window">
        {detail.recipeAssignments.length === 0 ? (
          <EmptyState title="No recipe assigned">
            Assign an approved recipe version for a location and window below. Overlapping windows
            for the same variant and location are rejected.
          </EmptyState>
        ) : (
          <Table caption="Effective recipe assignments for this variant." columnCount={4}>
            <thead>
              <tr>
                <Th>Location</Th>
                <Th>Recipe version</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody>
              {detail.recipeAssignments.map((assignment) => (
                <tr key={assignment.id}>
                  <Td>
                    <Badge>{assignment.locationCode}</Badge> {assignment.locationName}
                  </Td>
                  <Td>
                    <span style={{ fontFamily: typography.fontFamily.mono }}>
                      v{assignment.recipeVersionNo}
                    </span>
                  </Td>
                  <Td>{isoDay(assignment.effectiveFrom)}</Td>
                  <Td>
                    {assignment.effectiveTo === null ? (
                      <span style={{ color: color.text.muted }}>Open-ended</span>
                    ) : (
                      isoDay(assignment.effectiveTo)
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div style={{ marginTop: spacing[4] }}>
          <AssignRecipeForm
            productVariantId={detail.variant.id}
            locations={options.locations.map((location) => ({
              id: location.id,
              code: location.code,
              name: location.name,
            }))}
            recipeVersions={options.recipeVersions.map((version) => ({
              id: version.id,
              recipeCode: version.recipeCode,
              recipeName: version.recipeName,
              versionNo: version.versionNo,
            }))}
          />
        </div>
      </SectionCard>

      <SectionCard title="Add-on applicability" meta="this product as an add-on">
        {detail.addonApplicability.length === 0 ? (
          <EmptyState title="No add-ons configured">
            Declare which base products this product may attach to below. A product cannot be its
            own add-on.
          </EmptyState>
        ) : (
          <Table caption="Add-on applicability rows naming this product." columnCount={3}>
            <thead>
              <tr>
                <Th>Add-on</Th>
                <Th>Base product</Th>
                <Th>Price effect</Th>
              </tr>
            </thead>
            <tbody>
              {detail.addonApplicability.map((row) => (
                <tr key={row.id}>
                  <Td>{row.addon.code}</Td>
                  <Td>{row.base.code}</Td>
                  <Td>
                    {row.priceEffect === null ? (
                      <span style={{ color: color.text.muted }}>—</span>
                    ) : (
                      `${row.priceEffect}${currency === null ? "" : ` ${currency}`}`
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div style={{ marginTop: spacing[4] }}>
          <AddonApplicabilityForm
            productId={detail.product.id}
            products={baseProducts.map((product) => ({
              id: product.id,
              code: product.code,
              name: product.name,
            }))}
            currency={currency}
          />
        </div>
      </SectionCard>
    </div>
  );
}
