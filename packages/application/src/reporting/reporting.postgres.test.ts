import { netSalesFromLine, periodBucket } from "@aquarela/domain";
import {
  channel,
  createDb,
  externalMapping,
  item,
  location,
  product,
  productVariant,
  salesLine,
  salesTransaction,
  stockMovement,
  storageArea,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresReportingStore } from "./postgres-store";
import { buildSalesReport } from "./build-sales-report";
import { listSalesReportRecords } from "./list-sales-report-records";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const MARCH = "2026-03-01T00:00:00.000Z";
const MARCH_END = "2026-03-31T23:59:59.000Z";

class RollbackSignal extends Error {}

async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

interface SeedRefs {
  readonly locationId: string;
  readonly otherLocationId: string;
  readonly unitId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly channelId: string;
  readonly productVariantId: string;
  readonly productVariantSku: string;
  readonly productCategory: string;
  readonly otherProductVariantId: string;
  readonly otherProductVariantSku: string;
  readonly otherProductCategory: string;
}

async function seedRefs(tx: DatabaseTransaction, orgId: string): Promise<SeedRefs> {
  const loc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Reporting location A" })
    .returning();
  const otherLoc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc2_${suffix}`, name: "Reporting location B" })
    .returning();
  const baseUnit = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `unit_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const stockItem = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `item_${suffix}`,
      sku: `item_sku_${suffix}`,
      name: "Reporting ingredient",
      itemType: "ingredient",
      baseUnitId: baseUnit[0]!.id,
    })
    .returning();
  const area = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: loc[0]!.id,
      code: `area_${suffix}`,
      name: "Reporting storage",
      kind: "dry_store",
    })
    .returning();
  const chan = await tx
    .insert(channel)
    .values({ organizationId: orgId, code: `chan_${suffix}`, name: "Reporting channel" })
    .returning();
  const prod = await tx
    .insert(product)
    .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Coffee", category: "coffee" })
    .returning();
  const variant = await tx
    .insert(productVariant)
    .values({
      organizationId: orgId,
      productId: prod[0]!.id,
      code: `var_${suffix}`,
      sku: `sku_${suffix}`,
      name: "Flat white",
    })
    .returning();
  const otherProd = await tx
    .insert(product)
    .values({ organizationId: orgId, code: `prod2_${suffix}`, name: "Bun", category: "food" })
    .returning();
  const otherVariant = await tx
    .insert(productVariant)
    .values({
      organizationId: orgId,
      productId: otherProd[0]!.id,
      code: `var2_${suffix}`,
      sku: `sku2_${suffix}`,
      name: "Cinnamon bun",
    })
    .returning();

  return {
    locationId: loc[0]!.id,
    otherLocationId: otherLoc[0]!.id,
    unitId: baseUnit[0]!.id,
    itemId: stockItem[0]!.id,
    storageAreaId: area[0]!.id,
    channelId: chan[0]!.id,
    productVariantId: variant[0]!.id,
    productVariantSku: variant[0]!.sku,
    productCategory: "coffee",
    otherProductVariantId: otherVariant[0]!.id,
    otherProductVariantSku: otherVariant[0]!.sku,
    otherProductCategory: "food",
  };
}

async function seedTransaction(
  tx: DatabaseTransaction,
  orgId: string,
  refs: { readonly locationId: string; readonly occurredAt: string },
): Promise<string> {
  const rows = await tx
    .insert(salesTransaction)
    .values({
      organizationId: orgId,
      locationId: refs.locationId,
      sourceSystem: "frontline",
      externalTransactionId: `txn_${randomUUID()}`,
      occurredAt: new Date(refs.occurredAt),
      currency: "NOK",
    })
    .returning();
  return rows[0]!.id;
}

async function seedLine(
  tx: DatabaseTransaction,
  orgId: string,
  transactionId: string,
  values: Partial<typeof salesLine.$inferInsert> = {},
): Promise<string> {
  const rows = await tx
    .insert(salesLine)
    .values({ organizationId: orgId, salesTransactionId: transactionId, quantity: "1", ...values })
    .returning();
  return rows[0]!.id;
}

async function seedConsumptionCost(
  tx: DatabaseTransaction,
  orgId: string,
  refs: SeedRefs,
  salesLineId: string,
  valueDelta: string,
): Promise<void> {
  await tx.insert(stockMovement).values({
    organizationId: orgId,
    locationId: refs.locationId,
    storageAreaId: refs.storageAreaId,
    itemId: refs.itemId,
    movementType: "sale_consumption",
    quantityDelta: "-1",
    unitId: refs.unitId,
    valueDelta,
    currency: "NOK",
    sourceType: "sales_line",
    sourceId: salesLineId,
    occurredAt: new Date(MARCH),
    postedBy: randomUUID(),
  });
}

describe.skipIf(!databaseUrl)("reporting against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Reporting IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("groups by location, excludes included lines and joins the ledger cost", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txnA = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      const lineA = await seedLine(tx, orgId, txnA, {
        productVariantId: refs.productVariantId,
        channelId: refs.channelId,
        quantity: "2.000000",
        grossAmount: "125.0000",
        netAmount: "100.0000",
        taxAmount: "25.0000",
      });
      // An included option is retained for consumption but excluded from
      // revenue/margin (SALE-011) — including its ledger cost.
      const lineB = await seedLine(tx, orgId, txnA, {
        productVariantId: refs.productVariantId,
        optionKind: "included",
        parentLineId: lineA,
        quantity: "1.000000",
        grossAmount: "0.0000",
        netAmount: "0.0000",
      });
      await seedConsumptionCost(tx, orgId, refs, lineA, "-30.0000");
      await seedConsumptionCost(tx, orgId, refs, lineB, "-5.0000");

      const txnB = await seedTransaction(tx, orgId, {
        locationId: refs.otherLocationId,
        occurredAt: "2026-03-10T12:00:00.000Z",
      });
      const lineC = await seedLine(tx, orgId, txnB, {
        quantity: "1.000000",
        grossAmount: "50.0000",
        taxAmount: "5.0000",
      });
      await seedConsumptionCost(tx, orgId, refs, lineC, "-10.0000");

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "location",
      });

      expect(rows).toHaveLength(2);
      const locationA = rows.find((row) => row.locationId === refs.locationId);
      const locationB = rows.find((row) => row.locationId === refs.otherLocationId);
      expect(locationA).toMatchObject({
        transactions: 1,
        units: "2.000000",
        grossSales: "125.0000",
        netSales: "100.0000",
        taxAmount: "25.0000",
        ingredientCost: "30.0000",
      });
      expect(locationB).toMatchObject({
        transactions: 1,
        units: "1.000000",
        grossSales: "50.0000",
        // No reported net amount: derived as gross − tax.
        netSales: "45.0000",
        ingredientCost: "10.0000",
      });
    });
  });

  it("groups by product, bucketing an unmapped line as null", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      await seedLine(tx, orgId, txn, {
        productVariantId: refs.productVariantId,
        quantity: "2.000000",
        grossAmount: "125.0000",
        netAmount: "100.0000",
      });
      await seedLine(tx, orgId, txn, {
        quantity: "1.000000",
        grossAmount: "50.0000",
        netAmount: "45.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "product",
      });

      const mapped = rows.find((row) => row.productVariantId === refs.productVariantId);
      const unmapped = rows.find((row) => row.productVariantId === null);
      expect(mapped).toMatchObject({ label: "Flat white", netSales: "100.0000" });
      expect(unmapped).toMatchObject({ key: "unmapped", label: "Unmapped", netSales: "45.0000" });
    });
  });

  it("nets reversal lines and buckets the period like the domain", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        // A Sunday; its ISO week must match the domain's.
        occurredAt: "2026-03-01T12:00:00.000Z",
      });
      const original = await seedLine(tx, orgId, txn, {
        productVariantId: refs.otherProductVariantId,
        quantity: "1.000000",
        grossAmount: "20.0000",
        netAmount: "16.0000",
        taxAmount: "4.0000",
      });
      await seedLine(tx, orgId, txn, {
        productVariantId: refs.otherProductVariantId,
        reversalOfId: original,
        quantity: "-1.000000",
        grossAmount: "-20.0000",
        netAmount: "-16.0000",
        taxAmount: "-4.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "week",
        groupBy: "period",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.periodBucket).toBe(periodBucket("week", "2026-03-01T12:00:00.000Z"));
      expect(rows[0]).toMatchObject({ netSales: "0.0000", units: "0.000000" });
    });
  });

  it("buckets an ISO week year boundary like the domain", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      // 2021-01-01 is a Friday: ISO week 2020-W53, not 2021-W01.
      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: "2021-01-01T12:00:00.000Z",
      });
      await seedLine(tx, orgId, txn, {
        quantity: "1.000000",
        grossAmount: "10.0000",
        netAmount: "9.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: "2020-12-28T00:00:00.000Z",
        to: "2021-01-03T23:59:59.000Z",
        grain: "week",
        groupBy: "period",
      });

      expect(rows.map((row) => row.periodBucket)).toEqual([
        periodBucket("week", "2021-01-01T12:00:00.000Z"),
      ]);
      expect(rows[0]?.periodBucket).toBe("2020-W53");
    });
  });

  it("lists the drill-down lines and flags truncation", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      const first = await seedLine(tx, orgId, txn, {
        productVariantId: refs.productVariantId,
        externalLineId: "L1",
        quantity: "1.000000",
        grossAmount: "10.0000",
        netAmount: "9.0000",
      });
      await seedConsumptionCost(tx, orgId, refs, first, "-4.0000");
      await seedLine(tx, orgId, txn, {
        externalLineId: "L2",
        quantity: "1.000000",
        grossAmount: "20.0000",
        netAmount: "18.0000",
      });
      await seedLine(tx, orgId, txn, {
        externalLineId: "L3",
        optionKind: "included",
        parentLineId: first,
        quantity: "1.000000",
        grossAmount: "0.0000",
      });

      const all = await store.listSalesLineRecords({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        limit: 10,
        offset: 0,
      });
      expect(all.rows).toHaveLength(2);
      expect(all.truncated).toBe(false);
      const firstRow = all.rows.find((row) => row.externalLineId === "L1");
      expect(firstRow).toMatchObject({ ingredientCost: "4.0000", netAmount: "9.0000" });

      const page = await store.listSalesLineRecords({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        limit: 1,
        offset: 0,
      });
      expect(page.rows).toHaveLength(1);
      expect(page.truncated).toBe(true);
    });
  });

  it("does not read another organization's lines", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);
      const otherOrgId = `00000000-0000-4000-8000-${suffix.padEnd(12, "0").slice(0, 12)}`;

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      await seedLine(tx, orgId, txn, {
        productVariantId: refs.productVariantId,
        quantity: "1.000000",
        grossAmount: "10.0000",
        netAmount: "9.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: otherOrgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "location",
      });
      expect(rows).toHaveLength(0);
    });
  });

  it("resolves a sku-only line to its variant, product and category (DEC-108 item 5)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      // No product_variant_id (the importer never writes it): the SKU resolves.
      await seedLine(tx, orgId, txn, {
        sku: refs.productVariantSku,
        quantity: "1.000000",
        grossAmount: "125.0000",
        netAmount: "100.0000",
      });
      // Neither id, sku nor external ref: stays unmapped.
      await seedLine(tx, orgId, txn, {
        quantity: "1.000000",
        grossAmount: "50.0000",
        netAmount: "45.0000",
      });

      const { rows: productGroups } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "product",
      });
      const mapped = productGroups.find((row) => row.productVariantId === refs.productVariantId);
      const unmapped = productGroups.find((row) => row.productVariantId === null);
      expect(mapped).toMatchObject({ label: "Flat white", netSales: "100.0000" });
      expect(unmapped).toMatchObject({ key: "unmapped", label: "Unmapped", netSales: "45.0000" });

      const { rows: categoryGroups } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "category",
      });
      expect(categoryGroups.find((row) => row.category === refs.productCategory)).toMatchObject({
        netSales: "100.0000",
      });
    });
  });

  it("resolves a variant through the effective external mapping (DEC-108 item 5)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      await tx.insert(externalMapping).values({
        organizationId: orgId,
        sourceSystem: "frontline",
        entityType: "product",
        externalId: "EXT-1",
        sku: null,
        internalEntityType: "product_variant",
        internalEntityId: refs.otherProductVariantId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
      });

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      // No id or sku, but the POS external ref maps to the other variant.
      await seedLine(tx, orgId, txn, {
        externalProductRef: "EXT-1",
        quantity: "1.000000",
        grossAmount: "50.0000",
        netAmount: "45.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "product",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productVariantId: refs.otherProductVariantId,
        label: "Cinnamon bun",
        netSales: "45.0000",
      });
    });
  });

  it("buckets an unmapped category line (F11)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      await seedLine(tx, orgId, txn, {
        sku: refs.productVariantSku,
        quantity: "1.000000",
        grossAmount: "125.0000",
        netAmount: "100.0000",
      });
      await seedLine(tx, orgId, txn, {
        quantity: "1.000000",
        grossAmount: "50.0000",
        netAmount: "45.0000",
      });

      const { rows } = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "category",
      });
      expect(rows.find((row) => row.category === refs.productCategory)).toMatchObject({
        netSales: "100.0000",
      });
      expect(rows.find((row) => row.category === null)).toMatchObject({
        key: "unmapped",
        label: "Unmapped",
        netSales: "45.0000",
      });
    });
  });

  it("counts a transaction once across groups at the window level (F2)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      // One transaction, two lines, two different categories.
      await seedLine(tx, orgId, txn, {
        productVariantId: refs.productVariantId,
        quantity: "1.000000",
        grossAmount: "125.0000",
        netAmount: "100.0000",
      });
      await seedLine(tx, orgId, txn, {
        productVariantId: refs.otherProductVariantId,
        quantity: "1.000000",
        grossAmount: "50.0000",
        netAmount: "45.0000",
      });

      const summary = await store.summarizeSales({
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "category",
      });
      expect(summary.rows).toHaveLength(2);
      // Each group sees the transaction once...
      expect(summary.rows.map((row) => row.transactions)).toEqual([1, 1]);
      // ...but the window total counts it once, not twice.
      expect(summary.transactions).toBe(1);

      const report = await buildSalesReport(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        groupBy: "category",
      });
      expect(report.totals.transactions).toBe(1);
    });
  });

  it("resolves drill-down net sales like the domain source preference (F11)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const txn = await seedTransaction(tx, orgId, {
        locationId: refs.locationId,
        occurredAt: MARCH,
      });
      await seedLine(tx, orgId, txn, {
        externalLineId: "reported",
        productVariantId: refs.productVariantId,
        quantity: "1.000000",
        grossAmount: "125.0000",
        netAmount: "99.0000",
      });
      await seedLine(tx, orgId, txn, {
        externalLineId: "derived",
        productVariantId: refs.productVariantId,
        quantity: "1.000000",
        grossAmount: "125.0000",
        taxAmount: "25.0000",
      });

      const page = await listSalesReportRecords(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        from: MARCH,
        to: MARCH_END,
        grain: "month",
        limit: 10,
        offset: 0,
      });
      const reported = page.records.find((record) => record.externalLineId === "reported");
      const derived = page.records.find((record) => record.externalLineId === "derived");
      expect(reported?.netSales).toBe(
        netSalesFromLine({
          grossAmount: "125.0000",
          taxAmount: null,
          discountAmount: null,
          refundAmount: null,
          netAmount: "99.0000",
        }),
      );
      expect(reported?.netSales).toBe("99.0000");
      expect(derived?.netSales).toBe(
        netSalesFromLine({
          grossAmount: "125.0000",
          taxAmount: "25.0000",
          discountAmount: null,
          refundAmount: null,
          netAmount: null,
        }),
      );
      expect(derived?.netSales).toBe("100.0000");
    });
  });
});
