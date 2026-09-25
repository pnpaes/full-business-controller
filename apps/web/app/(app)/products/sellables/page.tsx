import {
  createPostgresMasterDataStore,
  createPostgresProductStore,
  listItems,
  listProducts,
} from "@aquarela/application";
import { PRODUCT_KIND } from "@aquarela/persistence";
import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { RegisterProductForm } from "./register-product-form";
import { RegisterVariantForm } from "./register-variant-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sellable products — Aquarela Business Control" };

/** `add_on` → "add on"; no label source exists yet. */
function humanize(code: string): string {
  return code.replace(/_/g, " ");
}

/**
 * Sellable products and variants (`DEC-128`): the things we sell. A product
 * groups variants and a variant is the sellable identity (`DEC-030`) carrying
 * the SKU, the size and an optional stocked finished-good item. Select a variant
 * to edit it and to attach a recipe version and add-on applicability.
 *
 * The products are read directly through the same application service the read
 * API uses (`listProducts` over `createPostgresProductStore`) rather than an
 * HTTP round-trip.
 */
export default async function SellableProductsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresProductStore(getDb().db);
  const [products, itemPage] = await Promise.all([
    listProducts(store, { organizationId }),
    listItems(createPostgresMasterDataStore(getDb().db), { organizationId, limit: 200 }),
  ]);
  const productOptions = products.map(({ product }) => ({
    id: product.id,
    code: product.code,
    name: product.name,
  }));
  const itemOptions = itemPage.items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
  }));

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
        title="Sellable products"
        scope="Aquarela Business Control"
        description="Products and the variants we sell, each with its SKU and the recipe and add-ons it is served with."
      />

      <p style={{ margin: 0 }}>
        <a href="/products" style={{ color: color.brand.navy }}>
          ← Back to items
        </a>
      </p>

      <SectionCard title="Register a product" meta="DEC-128 · create">
        <details>
          <summary
            style={{
              cursor: "pointer",
              minHeight: geometry.touchTarget,
              display: "flex",
              alignItems: "center",
              fontSize: typography.fontSize.md,
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New product
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <RegisterProductForm productKinds={PRODUCT_KIND} />
          </div>
        </details>
      </SectionCard>

      <SectionCard title="Register a variant" meta="DEC-030 · sellable identity">
        <details>
          <summary
            style={{
              cursor: "pointer",
              minHeight: geometry.touchTarget,
              display: "flex",
              alignItems: "center",
              fontSize: typography.fontSize.md,
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New variant
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <RegisterVariantForm products={productOptions} items={itemOptions} />
          </div>
        </details>
      </SectionCard>

      <SectionCard
        title="Products"
        meta={`${products.length} ${products.length === 1 ? "product" : "products"}`}
      >
        {products.length === 0 ? (
          <EmptyState title="No products yet">
            Register a product above, then add the variants you sell. A variant is the sellable
            identity that carries the SKU.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
            {products.map(({ product, variants }) => (
              <div
                key={product.id}
                style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
                  <span
                    style={{
                      fontFamily: typography.fontFamily.mono,
                      fontWeight: typography.fontWeight.semibold,
                    }}
                  >
                    {product.code}
                  </span>
                  <span>{product.name}</span>
                  <Badge>{humanize(product.productKind)}</Badge>
                  {product.category === null ? null : (
                    <span style={{ color: color.text.muted }}>{product.category}</span>
                  )}
                </div>
                {variants.length === 0 ? (
                  <p style={{ margin: 0, color: color.text.muted }}>
                    No variants yet — register one above.
                  </p>
                ) : (
                  <Table
                    caption={`Variants of ${product.code}. Select a code to edit the variant.`}
                    columnCount={5}
                  >
                    <thead>
                      <tr>
                        <Th>Variant</Th>
                        <Th>SKU</Th>
                        <Th>Size</Th>
                        <Th>Finished good</Th>
                        <Th>Range</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((variant) => (
                        <tr key={variant.id}>
                          <Td>
                            <a
                              href={`/products/sellables/${variant.id}`}
                              style={{
                                fontFamily: typography.fontFamily.mono,
                                color: color.brand.navy,
                                fontWeight: typography.fontWeight.semibold,
                              }}
                            >
                              {variant.code}
                            </a>
                            <span style={{ color: color.text.muted }}> — {variant.name}</span>
                          </Td>
                          <Td>{variant.sku}</Td>
                          <Td>{variant.size ?? "—"}</Td>
                          <Td>
                            {variant.finishedGoodItemId === null ? (
                              <span style={{ color: color.text.muted }}>Made to order</span>
                            ) : (
                              <span style={{ fontFamily: typography.fontFamily.mono }}>
                                {variant.finishedGoodItemId.slice(0, 8)}…
                              </span>
                            )}
                          </Td>
                          <Td>
                            {variant.activeTo === null ? (
                              <StatusPill tone="success">Active</StatusPill>
                            ) : (
                              <StatusPill tone="info">Ended {variant.activeTo}</StatusPill>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
