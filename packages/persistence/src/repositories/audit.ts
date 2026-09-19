import type { Database } from "../client";
import { auditEvent } from "../schema";

export type AuditEvent = typeof auditEvent.$inferSelect;
export type NewAuditEvent = typeof auditEvent.$inferInsert;

/**
 * Appends one audit fact. The table is append-only: `audit_event_immutable` and
 * `audit_event_no_truncate` triggers reject UPDATE/DELETE/TRUNCATE, and this
 * module deliberately exposes no update or delete function. It is itself written
 * to be called inside the same transaction as the security change it records.
 */
export async function writeAuditEvent(db: Database, input: NewAuditEvent): Promise<AuditEvent> {
  const rows = await db.insert(auditEvent).values(input).returning();
  return rows[0]!;
}
