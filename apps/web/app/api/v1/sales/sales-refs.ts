import { findLocationById } from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

import type { SalesRefRecord, SalesRefs } from "./sales-rows";

/**
 * Loads the location/channel display labels a page of sales transactions needs —
 * one query per distinct id, never per row, and every record is
 * organization-checked before it is returned so a cross-organization reference
 * resolves to null rather than leaking (the production `loadProductionRefs`
 * precedent).
 *
 * Repository gap bridged here (recorded, not resolved — the web layer must not
 * add a persistence accessor for it): `location` has `findLocationById`, but
 * `channel` has **no repository accessor at all**, so the channel label is read
 * through the composed relational-query client (the production-store precedent).
 * A missing accessor, not a new table or relationship, is what this avoids
 * inventing.
 *
 * Impure by design: kept out of `sales-rows.ts` so the parse/map helpers stay
 * unit-testable without a database.
 */
export async function loadSalesRefs(
  db: Database,
  organizationId: string,
  transactions: readonly {
    readonly locationId: string | null;
    readonly channelId: string | null;
  }[],
): Promise<SalesRefs> {
  const locationIds = distinct(
    transactions.flatMap((transaction) =>
      transaction.locationId === null ? [] : [transaction.locationId],
    ),
  );
  const channelIds = distinct(
    transactions.flatMap((transaction) =>
      transaction.channelId === null ? [] : [transaction.channelId],
    ),
  );

  const locations = new Map<string, SalesRefRecord>();
  for (const id of locationIds) {
    const row = await findLocationById(db, id);
    if (row !== undefined && row.organizationId === organizationId) {
      locations.set(id, { code: row.code, name: row.name });
    }
  }

  const channels = new Map<string, SalesRefRecord>();
  for (const id of channelIds) {
    const row = await db.query.channel.findFirst({
      columns: { id: true, organizationId: true, code: true, name: true },
      where: (fields, { eq }) => eq(fields.id, id),
    });
    if (row !== undefined && row.organizationId === organizationId) {
      channels.set(id, { code: row.code, name: row.name });
    }
  }

  return { locations, channels };
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}
