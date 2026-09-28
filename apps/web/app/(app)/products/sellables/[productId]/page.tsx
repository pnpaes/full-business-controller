import {
  createPostgresMasterDataStore,
  createPostgresProductStore,
  findProduct,
  listItems,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import {
  DataTable,
  DescriptionList,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";

import { NewVariantModal } from "./new-variant-modal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sellable product — Aquarela Business Control" };

/** `add_on` → "add on"; no label source exists yet. */
function humanize(code: string): string {
  return code.replace(/_/g, " ");
}

/**
 * One sellable product (`DEC-128`) and its variants (`DEC-030`). The parent
 * view owns the child create action: "New variant" opens a modal bound to this
 * product, and each variant row opens that variant for editing. A well-formed
 * id that is unknown or belongs to another organization renders the 404 state
 * rather than a raw domain error.
 */
export default async function SellableProductPage({
  params,
}: {
  readonly params: Promise<{ readonly productId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const productId = uuidOrNotFound((await params).productId);
  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresProductStore(db);
  const detail = await findProduct(store, { organizationId, productId }).catch((error: unknown) => {
    if (error instanceof DomainError) {
      notFound();
    }
    throw error;
  });

  // `DEC-150`: a variant may only be stocked from a for-sale item, so the
  // selector (and this lookup) lists for-sale items only.
  const itemPage = await listItems(createPostgresMasterDataStore(db), {
    organizationId,
    purpose: "for_sale",
    limit: 200,
  });
  const itemOptions = itemPage.items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
  }));
  const finishedGoodName = (itemId: string | null): string | null =>
    itemId === null ? null : (itemPage.items.find((item) => item.id === itemId)?.code ?? null);

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
        title={`${detail.product.code} · ${detail.product.name}`}
        scope="Sellable product"
        description="The product's data and the variants we sell under it. Open a variant to edit it and attach its recipe."
      />

      <p style={{ margin: 0 }}>
        <a href="/products/sellables" style={{ color: color.brand.navy }}>
          ← Back to sellable products
        </a>
      </p>

      <SectionCard title="Product" meta="read-only">
        <DescriptionList
          items={[
            { term: "Code", description: detail.product.code },
            { term: "Name", description: detail.product.name },
            { term: "Kind", description: humanize(detail.product.productKind) },
            { term: "Category", description: detail.product.category ?? "—" },
            { term: "Active from", description: detail.product.activeFrom },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Variants"
        meta={`${detail.variants.length} ${detail.variants.length === 1 ? "variant" : "variants"}`}
        actions={<NewVariantModal productId={detail.product.id} items={itemOptions} />}
      >
        {detail.variants.length === 0 ? (
          <EmptyState title="No variants yet">
            Add a variant with the button above. A variant is the sellable identity that carries the
            SKU, the size and an optional stocked finished-good item.
          </EmptyState>
        ) : (
          <DataTable
            caption="Variants of this product. Select a variant to edit it."
            columns={[
              { key: "variant", header: "Variant" },
              { key: "sku", header: "SKU" },
              { key: "size", header: "Size" },
              { key: "finishedGood", header: "Stocked from" },
              { key: "status", header: "Status" },
            ]}
            rows={detail.variants.map((variant) => {
              const finishedGood = finishedGoodName(variant.finishedGoodItemId);
              return {
                variant: (
                  <span style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                    <span
                      style={{
                        fontFamily: typography.fontFamily.mono,
                        fontWeight: typography.fontWeight.semibold,
                      }}
                    >
                      {variant.code}
                    </span>
                    <span>{variant.name}</span>
                  </span>
                ),
                sku: variant.sku,
                size: variant.size ?? <span style={{ color: color.text.muted }}>—</span>,
                finishedGood:
                  finishedGood === null ? (
                    <span style={{ color: color.text.muted }}>Made to order</span>
                  ) : (
                    <span style={{ fontFamily: typography.fontFamily.mono }}>{finishedGood}</span>
                  ),
                status:
                  variant.activeTo === null ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : (
                    <StatusPill tone="info">Ended {variant.activeTo}</StatusPill>
                  ),
              };
            })}
            rowHref={(_row, index) => {
              const variant = detail.variants[index];
              return variant === undefined
                ? ""
                : `/products/sellables/${detail.product.id}/variants/${variant.id}`;
            }}
          />
        )}
      </SectionCard>
    </div>
  );
}
