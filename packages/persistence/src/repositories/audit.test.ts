import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { appUser, auditEvent, organization } from "../schema";
import { writeAuditEvent } from "./audit";
import { createTestOrganization, createTestUser, inRollback, uniqueSuffix } from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("audit repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(appUser).where(eq(appUser.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("appends an event and returns the stored shape", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const event = await writeAuditEvent(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: "auth.login.success",
        entityType: "app_user",
        entityId: user.id,
        before: { status: "active" },
        after: { lastLoginAt: "now" },
        reason: "test",
        requestId: "req-1",
        correlationId: "corr-1",
      });

      expect(event.action).toBe("auth.login.success");
      expect(event.entityType).toBe("app_user");
      expect(event.actorId).toBe(user.id);
      expect(event.organizationId).toBe(orgId);
      expect(event.occurredAt).toBeInstanceOf(Date);

      const rows = await tx.select().from(auditEvent).where(eq(auditEvent.id, event.id));
      expect(rows).toHaveLength(1);
    });
  });

  it("allows a null actor and entity (system-originated event)", async () => {
    await inRollback(client.db, async (tx) => {
      const event = await writeAuditEvent(tx, {
        organizationId: orgId,
        action: "auth.session.expired",
        entityType: "auth_session",
      });
      expect(event.actorId).toBeNull();
      expect(event.entityId).toBeNull();
      expect(event.before).toBeNull();
    });
  });

  it("rejects an update (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const event = await writeAuditEvent(tx, {
        organizationId: orgId,
        action: "auth.login.failure",
        entityType: "app_user",
      });

      await expect(
        tx.update(auditEvent).set({ reason: "tampered" }).where(eq(auditEvent.id, event.id)),
      ).rejects.toThrow(/append-only/);
    });
  });

  it("rejects a delete (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const event = await writeAuditEvent(tx, {
        organizationId: orgId,
        action: "auth.logout",
        entityType: "auth_session",
      });

      await expect(tx.delete(auditEvent).where(eq(auditEvent.id, event.id))).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
