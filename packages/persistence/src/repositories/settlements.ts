import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { settlement } from "../schema";

export type Settlement = typeof settlement.$inferSelect;
export type NewSettlement = typeof settlement.$inferInsert;

/*
 * Slice-12 settlement reads/writes (`REC-001`, `REC-002`; `DEC-026`, `DEC-040`).
 *
 * `settlement` carries `organization_id` directly, so every read is
 * organization-scoped (`DEC-061`). `source_file_id` is a plain uuid
 * (`file_object` absent — open point (e)); `status` is unconstrained text
 * because no `settlement_status` vocabulary exists (open point (i)). This module
 * stores payout-report facts only; it does not reconcile or post.
 */

export async function createSettlement(db: Database, input: NewSettlement): Promise<Settlement> {
  const rows = await db.insert(settlement).values(input).returning();
  return rows[0]!;
}

export interface FindSettlementQuery {
  readonly organizationId: string;
  readonly settlementId: string;
}

/** One settlement by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findSettlement(
  db: Database,
  query: FindSettlementQuery,
): Promise<Settlement | undefined> {
  const rows = await db
    .select()
    .from(settlement)
    .where(
      and(
        eq(settlement.id, query.settlementId),
        eq(settlement.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListSettlementsQuery {
  readonly organizationId: string;
  readonly provider?: string;
  readonly channelId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Settlements for one organization, newest period first (`period_start`, then
 * `id`), with optional provider/channel filters. Every filter is optional except
 * the organization, so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listSettlements(
  db: Database,
  query: ListSettlementsQuery,
): Promise<Settlement[]> {
  const statement = db
    .select()
    .from(settlement)
    .where(
      and(
        eq(settlement.organizationId, query.organizationId),
        query.provider === undefined ? undefined : eq(settlement.provider, query.provider),
        query.channelId === undefined ? undefined : eq(settlement.channelId, query.channelId),
      ),
    )
    .orderBy(desc(settlement.periodStart), desc(settlement.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
