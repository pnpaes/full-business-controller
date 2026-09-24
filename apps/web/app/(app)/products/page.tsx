import {
  createPostgresMasterDataStore,
  listItems,
  type ListItemsResult,
} from "@aquarela/application";
import { MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";
import { ITEM_TYPE, INVENTORY_POLICY } from "@aquarela/persistence";
import { PageHeader, SectionCard, color, spacing, typography } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { ItemsTable, type ItemTableRow } from "./items-table";
import { RegisterItemForm } from "./register-item-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products — Aquarela Business Control" };

/* ----------------------------- query / formatting -------------------------- */

type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Next's `searchParams` record → a plain `URLSearchParams` (first value wins). */
function toSearchParams(record: SearchParamsRecord): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value) && value[0] !== undefined) {
      params.set(key, value[0]);
    }
  }
  return params;
}

function readParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/** `cleaning_supply` → "cleaning supply"; no label source exists yet. */
function humanize(code: string): string {
  return code.replace(/_/g, " ");
}

/** Monetary numeric(19,4) string → 2dp display string, HALF_UP (DEC-024). */
function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

function pageHref(params: URLSearchParams, offset: number): string {
  const next = new URLSearchParams(params);
  next.set("offset", String(offset));
  return `/products?${next.toString()}`;
}

/* ---------------------------------- page ----------------------------------- */

const filterRow = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: spacing[3],
} as const;

const fieldLabel = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[1],
  fontSize: typography.fontSize.sm,
  color: color.text.muted,
} as const;

/**
 * Products: the item list (08_UI_UX.md §8.3) — code, name, type, base unit,
 * inventory policy, current cost, lot tracking and active range — with a
 * search/type filter carried in the query string and drill-down to item detail.
 *
 * The items are read directly through the same application service the read API
 * uses (`listItems` over `createPostgresMasterDataStore`) rather than an HTTP
 * round-trip.
 */
export default async function ProductsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const params = toSearchParams(await searchParams);
  const search = readParam(params, "search");
  const itemTypeRaw = readParam(params, "itemType");
  const itemType =
    itemTypeRaw !== undefined && (ITEM_TYPE as readonly string[]).includes(itemTypeRaw)
      ? itemTypeRaw
      : undefined;
  const limitRaw = readParam(params, "limit");
  const offsetRaw = readParam(params, "offset");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  const offset = offsetRaw === undefined ? undefined : Number(offsetRaw);

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const organization = await store.findOrganization(organizationId);
  const currency = organization?.currency ?? null;

  let page: ListItemsResult;
  try {
    page = await listItems(store, {
      organizationId,
      ...(search === undefined ? {} : { search }),
      ...(itemType === undefined ? {} : { itemType }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
  } catch {
    // A malformed page in the URL falls back to the default first page.
    page = await listItems(store, {
      organizationId,
      ...(search === undefined ? {} : { search }),
      ...(itemType === undefined ? {} : { itemType }),
    });
  }

  const rows: ItemTableRow[] = page.items.map((item) => ({
    id: item.id,
    code: item.code,
    sku: item.sku,
    name: item.name,
    typeLabel: humanize(item.itemType),
    baseUnitCode: item.baseUnitCode,
    policyLabel: humanize(item.inventoryPolicy),
    lotTracked: item.lotTracked,
    currentCost: item.currentCost === null ? null : formatMoneyAmount(item.currentCost),
    activeTo: item.activeTo,
  }));

  const firstOnPage = page.total === 0 ? 0 : page.offset + 1;
  const lastOnPage = page.offset + page.items.length;
  const hasPrev = page.offset > 0;
  const hasNext = lastOnPage < page.total;
  const filterQuery = new URLSearchParams(params);
  filterQuery.delete("offset");

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
        title="Products"
        scope="Aquarela Business Control"
        description="Items and their supplier packs, base units and current cost. Select an item for its conversions and stock."
      />

      <p style={{ margin: 0 }}>
        Looking for what we sell? <a href="/products/sellables">Products and variants →</a>
      </p>

      <SectionCard title="Register an item" meta="W2 · create">
        <details>
          <summary
            style={{
              cursor: "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              fontSize: typography.fontSize.md,
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New item
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <RegisterItemForm itemTypes={ITEM_TYPE} inventoryPolicies={INVENTORY_POLICY} />
          </div>
        </details>
      </SectionCard>

      <SectionCard
        title="Items"
        meta={`${page.total} ${page.total === 1 ? "item" : "items"} · showing ${firstOnPage}–${lastOnPage}`}
      >
        <form method="get" action="/products" style={{ marginBottom: spacing[4] }}>
          <div style={filterRow}>
            <label style={{ ...fieldLabel, flex: "1 1 260px" }}>
              Search
              <input
                type="search"
                name="search"
                defaultValue={search ?? ""}
                placeholder="Code, SKU or name"
                style={{
                  minHeight: 44,
                  padding: `0 ${spacing[3]}px`,
                  border: "1px solid #c8c2b8",
                  borderRadius: 6,
                  fontSize: typography.fontSize.md,
                }}
              />
            </label>
            <label style={{ ...fieldLabel, flex: "0 1 200px" }}>
              Item type
              <select
                name="itemType"
                defaultValue={itemType ?? ""}
                style={{
                  minHeight: 44,
                  padding: `0 ${spacing[3]}px`,
                  border: "1px solid #c8c2b8",
                  borderRadius: 6,
                  fontSize: typography.fontSize.md,
                }}
              >
                <option value="">All types</option>
                {ITEM_TYPE.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              style={{
                minHeight: 44,
                padding: `0 ${spacing[5]}px`,
                border: "1px solid #16243d",
                borderRadius: 6,
                backgroundColor: "#16243d",
                color: "#faf6ef",
                fontSize: typography.fontSize.md,
                fontWeight: typography.fontWeight.semibold,
                cursor: "pointer",
              }}
            >
              Filter
            </button>
          </div>
        </form>

        <ItemsTable rows={rows} currency={currency} />

        {page.total > page.limit ? (
          <nav
            aria-label="Item pages"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: spacing[3],
              marginTop: spacing[4],
            }}
          >
            {hasPrev ? (
              <a href={pageHref(filterQuery, Math.max(0, page.offset - page.limit))}>← Previous</a>
            ) : (
              <span />
            )}
            <span style={{ fontSize: typography.fontSize.sm }}>
              Page {Math.floor(page.offset / page.limit) + 1} of{" "}
              {Math.max(1, Math.ceil(page.total / page.limit))}
            </span>
            {hasNext ? (
              <a href={pageHref(filterQuery, page.offset + page.limit)}>Next →</a>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </SectionCard>
    </div>
  );
}
