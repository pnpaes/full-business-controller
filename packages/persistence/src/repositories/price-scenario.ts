import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { priceScenario } from "../schema";

export type PriceScenario = typeof priceScenario.$inferSelect;

export interface NewPriceScenario {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId?: string | null;
  readonly channelId?: string | null;
  readonly grossPrice?: string | null;
  readonly netPrice?: string | null;
  readonly targetContributionPct?: string | null;
  readonly volumeAssumption?: string | null;
  readonly feeBreakdown?: Record<string, unknown>;
  readonly outcome?: Record<string, unknown>;
  readonly state?: string;
}

export async function createPriceScenario(
  db: Database,
  input: NewPriceScenario,
): Promise<PriceScenario> {
  const rows = await db.insert(priceScenario).values(input).returning();
  return rows[0]!;
}

export async function findPriceScenario(
  db: Database,
  id: string,
): Promise<PriceScenario | undefined> {
  const rows = await db.select().from(priceScenario).where(eq(priceScenario.id, id)).limit(1);
  return rows[0];
}

export interface PriceScenarioViewQuery {
  readonly organizationId: string;
  readonly productVariantId: string;
}

/** All scenarios for a variant, newest first. */
export async function listPriceScenariosForVariant(
  db: Database,
  query: PriceScenarioViewQuery,
): Promise<readonly PriceScenario[]> {
  return db
    .select()
    .from(priceScenario)
    .where(
      and(
        eq(priceScenario.organizationId, query.organizationId),
        eq(priceScenario.productVariantId, query.productVariantId),
      ),
    )
    .orderBy(desc(priceScenario.createdAt));
}

export interface PriceScenarioPatch {
  readonly state?: string;
  readonly outcome?: Record<string, unknown>;
  readonly grossPrice?: string | null;
  readonly netPrice?: string | null;
}

export async function updatePriceScenario(
  db: Database,
  id: string,
  patch: PriceScenarioPatch,
): Promise<PriceScenario> {
  const rows = await db
    .update(priceScenario)
    .set(patch)
    .where(eq(priceScenario.id, id))
    .returning();
  return rows[0]!;
}
