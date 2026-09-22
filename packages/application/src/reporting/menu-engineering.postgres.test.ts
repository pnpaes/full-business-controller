import {
  createDb,
  item,
  location,
  product,
  productVariant,
  salesLine,
  salesTransaction,
  stockMovement,
  storageArea,
  unit,
  wasteEvent,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildMenuEngineeringReport } from "./menu-engineering";
import { createPostgresReportingStore } from "./postgres-store";

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

interface Refs {
  readonly locationId: string;
  readonly unitId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly flatWhiteId: string;
  readonly bunId: string;
  readonly syrupId: string;
}

async function seedRefs(tx: DatabaseTransaction, orgId: string): Promise<Refs> {
  const loc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Menu location" })
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
      name: "Menu ingredient",
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
      name: "Menu storage",
      kind: "dry_store",
    })
    .returning();

  async function seedVariant(
    code: string,
    productName: string,
    category: string,
    productKind: string,
    sku: string,
  ): Promise<string> {
    const prod = await tx
      .insert(product)
      .values({
        organizationId: orgId,
        code: `${code}_${suffix}`,
        name: productName,
        category,
        productKind,
      })
      .returning();
    const variant = await tx
      .insert(productVariant)
      .values({
        organizationId: orgId,
        productId: prod[0]!.id,
        code: `v_${code}_${suffix}`,
        sku: `${sku}_${suffix}`,
        name: productName,
      })
      .returning();
    return variant[0]!.id;
  }

  return {
    locationId: loc[0]!.id,
    unitId: baseUnit[0]!.id,
    itemId: stockItem[0]!.id,
    storageAreaId: area[0]!.id,
    flatWhiteId: await seedVariant("flat", "Flat white", "coffee", "base", "flat"),
    bunId: await seedVariant("bun", "Cinnamon bun", "food", "base", "bun"),
    syrupId: await seedVariant("syrup", "Vanilla syrup", "food", "add_on", "syrup"),
  };
}

async function seedLine(
  tx: DatabaseTransaction,
  orgId: string,
  refs: Refs,
  values: Partial<typeof salesLine.$inferInsert> & { readonly netAmount: string },
): Promise<string> {
  const txn = await tx
    .insert(salesTransaction)
    .values({
      organizationId: orgId,
      locationId: refs.locationId,
      sourceSystem: "frontline",
      externalTransactionId: `txn_${randomUUID()}`,
      occurredAt: new Date(MARCH),
      currency: "NOK",
    })
    .returning();
  const rows = await tx
    .insert(salesLine)
    .values({
      organizationId: orgId,
      salesTransactionId: txn[0]!.id,
      quantity: "1",
      grossAmount: values.netAmount,
      ...values,
    })
    .returning();
  return rows[0]!.id;
}

async function seedCost(
  tx: DatabaseTransaction,
  orgId: string,
  refs: Refs,
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

describe.skipIf(!databaseUrl)("menu engineering against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Menu IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("classifies products and joins waste by variant", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      const flatWhite = await seedLine(tx, orgId, refs, {
        productVariantId: refs.flatWhiteId,
        quantity: "10.000000",
        netAmount: "100.0000",
      });
      await seedCost(tx, orgId, refs, flatWhite, "-40.0000");
      const bun = await seedLine(tx, orgId, refs, {
        productVariantId: refs.bunId,
        quantity: "6.000000",
        netAmount: "60.0000",
      });
      await seedCost(tx, orgId, refs, bun, "-50.0000");
      const syrup = await seedLine(tx, orgId, refs, {
        productVariantId: refs.syrupId,
        optionKind: "attached",
        parentLineId: flatWhite,
        quantity: "2.000000",
        netAmount: "40.0000",
      });
      await seedCost(tx, orgId, refs, syrup, "-10.0000");
      // An item-only line with no resolved variant: the unmapped bucket.
      await seedLine(tx, orgId, refs, { quantity: "3.000000", netAmount: "30.0000" });

      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        productVariantId: refs.flatWhiteId,
        quantity: "1.500000",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "spillage",
        valueMethod: "moving_average",
        value: "12.0000",
        currency: "NOK",
        occurredAt: new Date(MARCH),
        actorId: randomUUID(),
      });

      const report = await buildMenuEngineeringReport(store, {
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
      });

      expect(report.threshold.popularity.value).toBe("6.000000");
      expect(report.threshold.contribution.value).toBeNull();
      expect(report.unmapped).toEqual({ units: "3.000000", netSales: "30.0000" });
      expect(report.rows).toHaveLength(3);

      const byId = new Map(report.rows.map((row) => [row.productVariantId, row]));
      expect(byId.get(refs.flatWhiteId)).toMatchObject({
        label: "Flat white",
        category: "coffee",
        productKind: "base",
        optionKinds: ["standalone"],
        units: "10.000000",
        contributionBeforeLabour: "60.0000",
        contributionThreshold: "60.0000",
        popularityHigh: true,
        contributionHigh: true,
        waste: { quantity: "1.500000", value: "12.0000" },
      });
      expect(byId.get(refs.bunId)).toMatchObject({
        category: "food",
        units: "6.000000",
        contributionBeforeLabour: "10.0000",
        contributionThreshold: "20.0000",
        popularityHigh: true,
        contributionHigh: false,
        waste: null,
      });
      expect(byId.get(refs.syrupId)).toMatchObject({
        productKind: "add_on",
        optionKinds: ["attached"],
        units: "2.000000",
        contributionBeforeLabour: "30.0000",
        contributionThreshold: "20.0000",
        popularityHigh: false,
        contributionHigh: true,
      });
    });
  });

  it("values only moving_average waste events (DEC-068)", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);

      await seedLine(tx, orgId, refs, {
        productVariantId: refs.flatWhiteId,
        quantity: "1.000000",
        netAmount: "10.0000",
      });
      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        productVariantId: refs.flatWhiteId,
        quantity: "1.500000",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "spillage",
        valueMethod: "moving_average",
        value: "12.0000",
        currency: "NOK",
        occurredAt: new Date(MARCH),
        actorId: randomUUID(),
      });
      // An unimplemented valuation method (DEC-068): its value must not be
      // summed into the report.
      await tx.insert(wasteEvent).values({
        organizationId: orgId,
        locationId: refs.locationId,
        storageAreaId: refs.storageAreaId,
        productVariantId: refs.flatWhiteId,
        quantity: "2.000000",
        unitId: refs.unitId,
        stage: "preparation",
        reasonCode: "spillage",
        valueMethod: "latest_price",
        value: "99.0000",
        currency: "NOK",
        occurredAt: new Date(MARCH),
        actorId: randomUUID(),
      });

      const report = await buildMenuEngineeringReport(store, {
        organizationId: orgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
      });

      const row = report.rows.find((entry) => entry.productVariantId === refs.flatWhiteId);
      expect(row?.waste).toEqual({ quantity: "1.500000", value: "12.0000" });
    });
  });

  it("does not read another organization's products", async () => {
    await inRollback(client.db, async (tx) => {
      const refs = await seedRefs(tx, orgId);
      const store = createPostgresReportingStore(tx);
      await seedLine(tx, orgId, refs, {
        productVariantId: refs.flatWhiteId,
        quantity: "1.000000",
        netAmount: "10.0000",
      });

      const otherOrgId = `00000000-0000-4000-8000-${suffix.padEnd(12, "0").slice(0, 12)}`;
      const report = await buildMenuEngineeringReport(store, {
        organizationId: otherOrgId,
        from: MARCH,
        to: MARCH_END,
        grain: "month",
      });

      expect(report.rows).toHaveLength(0);
      expect(report.threshold.popularity.value).toBeNull();
      expect(report.unmapped).toBeNull();
    });
  });
});
