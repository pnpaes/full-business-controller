import {
  createPostgresMasterDataStore,
  listItems,
  type ListItemsResult,
} from "@aquarela/application";
import { MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";
import { ITEM_PURPOSE, ITEM_TYPE, INVENTORY_POLICY } from "@aquarela/persistence";
import {
  PageHeader,
  SectionCard,
  Button,
  Tabs,
  color,
  geometry,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { ItemsTable, type ItemTableRow } from "./items-table";
import { NewItemModal } from "./new-item-modal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock items — Aquarela Business Control" };

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

const paginationLink = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: geometry.touchTarget,
} as const;

/**
 * Items: the item register (08_UI_UX.md §8.3) — code, name, type, base unit,
 * inventory policy, current cost, lot tracking and active range — with a
 * search/type filter carried in the query string and drill-down to item detail.
 * These are the things this organization buys, makes or stocks; what it sells
 * lives on the sellables register.
 *
 * Creating an item is the header's single primary action, opening the form in a
 * modal (`docs/ux/README.md` "Creation and hierarchy").
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
  const purposeRaw = readParam(params, "purpose");
  const purpose =
    purposeRaw !== undefined && (ITEM_PURPOSE as readonly string[]).includes(purposeRaw)
      ? purposeRaw
      : undefined;
  const limitRaw = readParam(params, "limit");
  const offsetRaw = readParam(params, "offset");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  const offset = offsetRaw === undefined ? undefined : Number(offsetRaw);

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const organization = await store.findOrganization(organizationId);
  const currency = organization?.currency ?? null;

  const baseFilters = {
    organizationId,
    ...(search === undefined ? {} : { search }),
    ...(itemType === undefined ? {} : { itemType }),
    ...(purpose === undefined ? {} : { purpose }),
  };

  let page: ListItemsResult;
  try {
    page = await listItems(store, {
      ...baseFilters,
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
  } catch {
    // A malformed page in the URL falls back to the default first page.
    page = await listItems(store, baseFilters);
  }

  // `DEC-150` tab counts: the same base filters, one headcount per purpose.
  const purposeTotals = await Promise.all(
    (ITEM_PURPOSE as readonly string[]).map(async (value) => {
      const countPage = await listItems(store, { ...baseFilters, purpose: value, limit: 1 });
      return countPage.total;
    }),
  );
  const forSaleCount = purposeTotals[0] ?? 0;
  const forUseCount = purposeTotals[1] ?? 0;

  const purposeLabel = (value: string): string => (value === "for_sale" ? "For sale" : "For use");

  const rows: ItemTableRow[] = page.items.map((item) => ({
    id: item.id,
    code: item.code,
    sku: item.sku,
    name: item.name,
    typeLabel: humanize(item.itemType),
    purposeLabel: purposeLabel(item.purpose),
    baseUnitCode: item.baseUnitCode,
    policyLabel: humanize(item.inventoryPolicy),
    lotTracked: item.lotTracked,
    currentCost: item.currentCost === null ? null : formatMoneyAmount(item.currentCost),
    activeTo: item.activeTo,
  }));

  /** A tab href keeps the current filters, resets paging and sets/clears purpose. */
  const tabHref = (value: string | undefined): string => {
    const next = new URLSearchParams(params);
    next.delete("offset");
    if (value === undefined) {
      next.delete("purpose");
    } else {
      next.set("purpose", value);
    }
    const query = next.toString();
    return query.length === 0 ? "/products" : `/products?${query}`;
  };

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
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <PageHeader
        title="Stock items"
        scope="Aquarela Business Control"
        description="The things we stock and cost. Each item is either for sale (a sellable is fulfilled from it) or for use (an input consumed by production and operations) — with its supplier packs, base unit and current cost."
        actions={
          <NewItemModal
            itemTypes={ITEM_TYPE}
            inventoryPolicies={INVENTORY_POLICY}
            itemPurposes={ITEM_PURPOSE}
          />
        }
      />

      <Tabs
        ariaLabel="Filter items by purpose"
        items={[
          {
            label: `All (${forSaleCount + forUseCount})`,
            href: tabHref(undefined),
            active: purpose === undefined,
          },
          {
            label: `For sale (${forSaleCount})`,
            href: tabHref("for_sale"),
            active: purpose === "for_sale",
          },
          {
            label: `For use (${forUseCount})`,
            href: tabHref("for_use"),
            active: purpose === "for_use",
          },
        ]}
      />

      <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.muted }}>
        Selling something? <a href="/products/sellables">Products and variants →</a>
      </p>

      <SectionCard
        title="All items"
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
                  minHeight: geometry.touchTarget,
                  padding: `0 ${spacing[3]}px`,
                  border: `1px solid ${color.border.default}`,
                  borderRadius: radius.md,
                  backgroundColor: color.surface.base,
                  color: color.text.primary,
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
                  minHeight: geometry.touchTarget,
                  padding: `0 ${spacing[3]}px`,
                  border: `1px solid ${color.border.default}`,
                  borderRadius: radius.md,
                  backgroundColor: color.surface.base,
                  color: color.text.primary,
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
            <Button type="submit">Filter</Button>
          </div>
        </form>

        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <ItemsTable rows={rows} currency={currency} />
        </div>

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
              <a
                href={pageHref(filterQuery, Math.max(0, page.offset - page.limit))}
                style={paginationLink}
              >
                ← Previous
              </a>
            ) : (
              <span />
            )}
            <span style={{ fontSize: typography.fontSize.sm }}>
              Page {Math.floor(page.offset / page.limit) + 1} of{" "}
              {Math.max(1, Math.ceil(page.total / page.limit))}
            </span>
            {hasNext ? (
              <a href={pageHref(filterQuery, page.offset + page.limit)} style={paginationLink}>
                Next →
              </a>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </SectionCard>
    </div>
  );
}
