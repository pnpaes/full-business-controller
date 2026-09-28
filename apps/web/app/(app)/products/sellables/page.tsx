import { createPostgresProductStore, listProducts } from "@aquarela/application";
import { PRODUCT_KIND } from "@aquarela/persistence";
import {
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { NewProductModal } from "./new-product-modal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sellable products — Aquarela Business Control" };

/** `add_on` → "add on"; no label source exists yet. */
function humanize(code: string): string {
  return code.replace(/_/g, " ");
}

/**
 * Sellable products (`DEC-128`): the register of what we sell. A product groups
 * variants, and a variant is the sellable identity (`DEC-030`). This level
 * never creates variants — each row shows its variant count and opens the
 * product's own view, where the product's data, its variants and the "New
 * variant" action live. Creation is a button + modal, never a form band
 * (`docs/ux/README.md`, "Creation and hierarchy").
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
  const products = await listProducts(store, { organizationId });

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
        description="The products we sell. Open a product to see its variants — the sellable identities that carry the SKU and the recipe and add-ons they are served with."
        actions={<NewProductModal productKinds={PRODUCT_KIND} />}
      />

      <p style={{ margin: 0 }}>
        <a href="/products" style={{ color: color.brand.navy }}>
          ← Back to items
        </a>
      </p>

      <SectionCard
        title="Products"
        meta={`${products.length} ${products.length === 1 ? "product" : "products"}`}
      >
        {products.length === 0 ? (
          <EmptyState title="No products yet">
            Register a product with the button above, then add the variants you sell from that
            product. A variant is the sellable identity that carries the SKU.
          </EmptyState>
        ) : (
          <DataTable
            caption="Sellable products with the number of variants each carries. Select a product to open it."
            columns={[
              { key: "product", header: "Product" },
              { key: "kind", header: "Kind" },
              { key: "category", header: "Category" },
              { key: "variants", header: "Variants", align: "right" },
            ]}
            rows={products.map(({ product, variants }) => ({
              product: (
                <span style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                  <span
                    style={{
                      fontFamily: typography.fontFamily.mono,
                      fontWeight: typography.fontWeight.semibold,
                    }}
                  >
                    {product.code}
                  </span>
                  <span>{product.name}</span>
                </span>
              ),
              kind: <Badge>{humanize(product.productKind)}</Badge>,
              category:
                product.category === null ? (
                  <span style={{ color: color.text.muted }}>—</span>
                ) : (
                  product.category
                ),
              variants:
                variants.length === 0 ? (
                  <span style={{ color: color.text.muted }}>None</span>
                ) : (
                  `${variants.length} ${variants.length === 1 ? "variant" : "variants"}`
                ),
            }))}
            rowHref={(_row, index) => `/products/sellables/${products[index]?.product.id ?? ""}`}
          />
        )}
      </SectionCard>
    </div>
  );
}
