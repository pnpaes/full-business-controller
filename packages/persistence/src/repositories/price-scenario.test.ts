import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization, product, productVariant } from "../schema";
import {
  approvePriceScenarioIfApprovable,
  createPriceScenario,
  findPriceScenario,
  updatePriceScenario,
} from "./price-scenario";
import {
  createTestOrganization,
  createTestProduct,
  createTestProductVariant,
  inRollback,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("price-scenario repository", () => {
  let client: DbClient;
  let orgId: string;
  let variantId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const prod = await createTestProduct(client.db, orgId);
    const variant = await createTestProductVariant(client.db, orgId, prod.id);
    variantId = variant.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(productVariant).where(eq(productVariant.organizationId, orgId));
      await client.db.delete(product).where(eq(product.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("round-trips a scenario including the four priced columns", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "12.5",
        netPrice: "10.25",
        targetContributionPct: "0.35",
        volumeAssumption: "100",
        feeBreakdown: { commission_pct: "0.03" },
        outcome: { marginPct: "0.42" },
      });

      expect(created.state).toBe("draft");
      expect(created.grossPrice).toBe("12.5000");
      expect(created.netPrice).toBe("10.2500");
      expect(created.targetContributionPct).toBe("0.350000");
      expect(created.volumeAssumption).toBe("100.000000");
      expect(created.feeBreakdown).toEqual({ commission_pct: "0.03" });
      expect(created.outcome).toEqual({ marginPct: "0.42" });

      const found = await findPriceScenario(tx, created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.targetContributionPct).toBe("0.350000");
      expect(found?.volumeAssumption).toBe("100.000000");
    });
  });

  it("defaults fee_breakdown and outcome to an empty object", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "9",
      });
      expect(created.feeBreakdown).toEqual({});
      expect(created.outcome).toEqual({});
      expect(created.targetContributionPct).toBeNull();
      expect(created.volumeAssumption).toBeNull();
    });
  });

  it("updates state, outcome and prices", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "10",
      });
      const updated = await updatePriceScenario(tx, created.id, {
        state: "submitted",
        outcome: { breakEven: "8.10" },
        grossPrice: "13.5",
        netPrice: "11.475",
      });
      expect(updated.state).toBe("submitted");
      expect(updated.outcome).toEqual({ breakEven: "8.10" });
      expect(updated.grossPrice).toBe("13.5000");
      expect(updated.netPrice).toBe("11.4750");
    });
  });

  it("compare-and-swaps draft/submitted to approved only once", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "10",
        netPrice: "8",
      });

      const approved = await approvePriceScenarioIfApprovable(tx, {
        organizationId: orgId,
        priceScenarioId: created.id,
      });
      expect(approved?.id).toBe(created.id);
      expect(approved?.state).toBe("approved");

      // The row no longer matches `state IN ('draft','submitted')`.
      expect(
        await approvePriceScenarioIfApprovable(tx, {
          organizationId: orgId,
          priceScenarioId: created.id,
        }),
      ).toBeUndefined();
    });
  });

  it("approves a submitted scenario but not a foreign org or a rejected one", async () => {
    await inRollback(client.db, async (tx) => {
      const submitted = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "10",
        netPrice: "8",
      });
      await updatePriceScenario(tx, submitted.id, { state: "submitted" });
      expect(
        (
          await approvePriceScenarioIfApprovable(tx, {
            organizationId: orgId,
            priceScenarioId: submitted.id,
          })
        )?.state,
      ).toBe("approved");

      const draft = await createPriceScenario(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "10",
        netPrice: "8",
      });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await approvePriceScenarioIfApprovable(tx, {
          organizationId: otherOrgId,
          priceScenarioId: draft.id,
        }),
      ).toBeUndefined();

      await updatePriceScenario(tx, draft.id, { state: "rejected" });
      expect(
        await approvePriceScenarioIfApprovable(tx, {
          organizationId: orgId,
          priceScenarioId: draft.id,
        }),
      ).toBeUndefined();
    });
  });
});
