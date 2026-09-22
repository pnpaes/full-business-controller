import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { equipment, location, maintenanceLog, organization } from "../schema";
import {
  createEquipment,
  createMaintenanceLog,
  findEquipment,
  findMaintenanceLog,
  listEquipment,
  listMaintenanceLogs,
  updateEquipment,
} from "./equipment";
import {
  createTestEquipment,
  createTestFileObject,
  createTestLocation,
  createTestMaintenanceLog,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

describe.skipIf(!databaseUrl)("equipment repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    locationId = (await createTestLocation(client.db, orgId)).id;
  });

  afterAll(async () => {
    if (client) {
      // Every equipment and maintenance log is created inside a rolled-back
      // transaction, so the committed fixtures to unwind are the location and
      // the organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates equipment and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createEquipment(tx, {
        organizationId: orgId,
        locationId,
        code: "OVEN-1",
        name: "Deck oven",
        kind: "oven",
        serialNo: "SN-12345",
        installedAt: "2024-05-01",
        warrantyUntil: "2026-05-01",
        actorId: "00000000-0000-0000-0000-0000000000aa",
      });
      expect(created.code).toBe("OVEN-1");
      expect(created.kind).toBe("oven");
      expect(created.serialNo).toBe("SN-12345");
      expect(created.installedAt).toBe("2024-05-01");
      expect(created.warrantyUntil).toBe("2026-05-01");
      expect(created.active).toBe(true);
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000aa");

      expect(
        (await findEquipment(tx, { organizationId: orgId, equipmentId: created.id }))?.id,
      ).toBe(created.id);

      // A row in another organization is invisible at this scope. If the
      // organization filter were dropped, this lookup would find the row and
      // the assertion would fail.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findEquipment(tx, { organizationId: otherOrgId, equipmentId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults active to true and the nullable fields to null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEquipment(tx, orgId, locationId, {
        code: "MINIMAL-1",
        active: undefined,
      });
      expect(created.active).toBe(true);
      expect(created.serialNo).toBeNull();
      expect(created.installedAt).toBeNull();
      expect(created.warrantyUntil).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists equipment by location, kind and active with paging and second-org isolation", async () => {
    await inRollback(client.db, async (tx) => {
      const a = await createTestEquipment(tx, orgId, locationId, {
        code: "A-01",
        kind: "oven",
        active: true,
      });
      const b = await createTestEquipment(tx, orgId, locationId, {
        code: "B-01",
        kind: "fridge",
        active: false,
      });
      const otherLocation = await createTestLocation(tx, orgId);
      const c = await createTestEquipment(tx, orgId, otherLocation.id, {
        code: "C-01",
        kind: "oven",
        active: true,
      });

      // Code order (then id).
      const all = await listEquipment(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const ovens = await listEquipment(tx, { organizationId: orgId, kind: "oven" });
      expect(ovens.map((row) => row.id)).toEqual([a.id, c.id]);

      const active = await listEquipment(tx, { organizationId: orgId, active: true });
      expect(active.map((row) => row.id)).toEqual([a.id, c.id]);

      const here = await listEquipment(tx, { organizationId: orgId, locationId });
      expect(here.map((row) => row.id)).toEqual([a.id, b.id]);

      const paged = await listEquipment(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's rows never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const other = await createTestEquipment(tx, otherOrgId, otherLocationId, { code: "A-01" });
      expect((await listEquipment(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        a.id,
        b.id,
        c.id,
      ]);
      expect(
        (await listEquipment(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("updates equipment's mutable fields and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEquipment(tx, orgId, locationId, { code: "PATCH-1" });
      const updated = await updateEquipment(tx, {
        organizationId: orgId,
        equipmentId: created.id,
        name: "Renamed oven",
        kind: "combi_oven",
        serialNo: "SN-999",
        installedAt: "2025-01-15",
        warrantyUntil: "2027-01-15",
        active: false,
        actorId: "00000000-0000-0000-0000-0000000000bb",
      });
      expect(updated?.name).toBe("Renamed oven");
      expect(updated?.kind).toBe("combi_oven");
      expect(updated?.serialNo).toBe("SN-999");
      expect(updated?.installedAt).toBe("2025-01-15");
      expect(updated?.warrantyUntil).toBe("2027-01-15");
      expect(updated?.active).toBe(false);
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000bb");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("clears a nullable field with an explicit null and leaves an omitted field untouched", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEquipment(tx, orgId, locationId, {
        code: "CLEAR-1",
        name: "Original name",
        serialNo: "SN-keep",
      });
      const updated = await updateEquipment(tx, {
        organizationId: orgId,
        equipmentId: created.id,
        serialNo: null,
        installedAt: null,
      });
      expect(updated?.name).toBe("Original name");
      expect(updated?.serialNo).toBeNull();
      expect(updated?.installedAt).toBeNull();
    });
  });

  it("does not update equipment through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEquipment(tx, orgId, locationId, {
        code: "SCOPED-1",
        name: "Original",
      });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateEquipment(tx, {
          organizationId: otherOrgId,
          equipmentId: created.id,
          name: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (await findEquipment(tx, { organizationId: orgId, equipmentId: created.id }))?.name,
      ).toBe("Original");
    });
  });

  it("rejects a duplicate code within an organization", async () => {
    await inRollback(client.db, async (tx) => {
      await createTestEquipment(tx, orgId, locationId, { code: "DUP-1" });
      const cause = await rejectionCause(
        createTestEquipment(tx, orgId, locationId, { code: "DUP-1" }),
      );
      expect(errorCode(cause)).toBe("23505");
      expect(cause.message).toMatch(/equipment_organization_id_code_key/);
    });
  });

  it("allows the same code in a different organization", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const mine = await createTestEquipment(tx, orgId, locationId, { code: "SHARED-1" });
      const theirs = await createTestEquipment(tx, otherOrgId, otherLocationId, {
        code: "SHARED-1",
      });
      expect(theirs.id).not.toBe(mine.id);
    });
  });

  it("rejects a blank code and a blank name", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEquipment(tx, orgId, locationId, { code: "   " }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/equipment_code_nonempty_check/);
    });
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEquipment(tx, orgId, locationId, { name: "   " }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/equipment_name_nonempty_check/);
    });
  });

  it("rejects equipment whose location is in another organization (0045)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `location` row (so the single-column FK passes), but
      // the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestEquipment(tx, orgId, otherLocation.id, { code: "XR-1" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/equipment\.location_id/);
    });
  });

  it("creates a maintenance log and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const file = await createTestFileObject(tx, orgId);
      const created = await createMaintenanceLog(tx, {
        organizationId: orgId,
        equipmentId: machine.id,
        kind: "repair",
        performedAt: at("2026-02-01T09:30:00.000Z"),
        performedBy: "00000000-0000-0000-0000-0000000000cc",
        notes: "Replaced the thermostat",
        fileObjectId: file.id,
        actorId: "00000000-0000-0000-0000-0000000000dd",
      });
      expect(created.equipmentId).toBe(machine.id);
      expect(created.kind).toBe("repair");
      expect(created.performedAt.toISOString()).toBe("2026-02-01T09:30:00.000Z");
      expect(created.performedBy).toBe("00000000-0000-0000-0000-0000000000cc");
      expect(created.notes).toBe("Replaced the thermostat");
      expect(created.fileObjectId).toBe(file.id);
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000dd");

      expect(
        (await findMaintenanceLog(tx, { organizationId: orgId, maintenanceLogId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findMaintenanceLog(tx, {
          organizationId: otherOrgId,
          maintenanceLogId: created.id,
        }),
      ).toBeUndefined();
    });
  });

  it("defaults a maintenance log's nullable fields to null", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const created = await createTestMaintenanceLog(tx, orgId, machine.id);
      expect(created.kind).toBe("service");
      expect(created.notes).toBeNull();
      expect(created.fileObjectId).toBeNull();
      expect(created.createdBy).toBeNull();
    });
  });

  it("lists maintenance logs by equipment and kind, newest first, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId, { code: "LOG-1" });
      const otherMachine = await createTestEquipment(tx, orgId, locationId, { code: "LOG-2" });

      const old = await createTestMaintenanceLog(tx, orgId, machine.id, {
        kind: "service",
        performedAt: at("2026-01-01T08:00:00.000Z"),
      });
      const newer = await createTestMaintenanceLog(tx, orgId, machine.id, {
        kind: "inspection",
        performedAt: at("2026-03-01T08:00:00.000Z"),
      });
      const elsewhere = await createTestMaintenanceLog(tx, orgId, otherMachine.id, {
        kind: "service",
        performedAt: at("2026-02-01T08:00:00.000Z"),
      });

      // Newest `performed_at` first.
      const all = await listMaintenanceLogs(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([newer.id, elsewhere.id, old.id]);

      const services = await listMaintenanceLogs(tx, { organizationId: orgId, kind: "service" });
      expect(services.map((row) => row.id)).toEqual([elsewhere.id, old.id]);

      const here = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        equipmentId: machine.id,
      });
      expect(here.map((row) => row.id)).toEqual([newer.id, old.id]);

      const paged = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([elsewhere.id]);

      // A second organization's logs never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherMachineRow = await createTestEquipment(tx, otherOrgId, otherLocationId);
      const other = await createTestMaintenanceLog(tx, otherOrgId, otherMachineRow.id);
      expect(
        (await listMaintenanceLogs(tx, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([newer.id, elsewhere.id, old.id]);
      expect(
        (await listMaintenanceLogs(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("filters maintenance logs by an inclusive performed_at window", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId, { code: "WIN-1" });
      const log = (performedAt: string) =>
        createTestMaintenanceLog(tx, orgId, machine.id, { performedAt: at(performedAt) });
      const before = await log("2026-01-31T23:59:59.999Z");
      const lower = await log("2026-02-01T00:00:00.000Z");
      const inside = await log("2026-02-15T12:00:00.000Z");
      const upper = await log("2026-03-01T00:00:00.000Z");
      const after = await log("2026-03-01T00:00:00.001Z");

      // Both bounds inclusive, newest first; the rows just outside are excluded.
      const windowed = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        from: at("2026-02-01T00:00:00.000Z"),
        to: at("2026-03-01T00:00:00.000Z"),
      });
      expect(windowed.map((row) => row.id)).toEqual([upper.id, inside.id, lower.id]);

      // An absent bound is open-ended: `from` alone leaves the upper end open...
      const fromOnly = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        from: at("2026-02-01T00:00:00.000Z"),
      });
      expect(fromOnly.map((row) => row.id)).toEqual([after.id, upper.id, inside.id, lower.id]);

      // ...and `to` alone leaves the lower end open.
      const toOnly = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        to: at("2026-03-01T00:00:00.000Z"),
      });
      expect(toOnly.map((row) => row.id)).toEqual([upper.id, inside.id, lower.id, before.id]);

      // The window composes with the equipment filter and paging.
      const here = await listMaintenanceLogs(tx, {
        organizationId: orgId,
        equipmentId: machine.id,
        from: at("2026-02-01T00:00:00.000Z"),
        to: at("2026-03-01T00:00:00.000Z"),
        limit: 1,
        offset: 1,
      });
      expect(here.map((row) => row.id)).toEqual([inside.id]);

      // A second organization's in-window log never appears.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherMachine = await createTestEquipment(tx, otherOrgId, otherLocationId);
      const other = await createTestMaintenanceLog(tx, otherOrgId, otherMachine.id, {
        performedAt: at("2026-02-10T08:00:00.000Z"),
      });
      expect(windowed.map((row) => row.id)).not.toContain(other.id);
    });
  });

  it("rejects a maintenance kind outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const cause = await rejectionCause(
        createTestMaintenanceLog(tx, orgId, machine.id, { kind: "cleaning" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/maintenance_log_kind_check/);
    });
  });

  it("rejects an unregistered equipment id (FK, not null)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestMaintenanceLog(tx, orgId, "00000000-0000-4000-8000-0000000000ff"),
      );
      expect(errorCode(cause)).toBe("23503");
      expect(cause.message).toMatch(/maintenance_log_equipment_id_equipment_id_fk/);
    });
  });

  it("rejects a maintenance log whose equipment is in another organization (0045)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherMachine = await createTestEquipment(tx, otherOrgId, otherLocationId);
      const cause = await rejectionCause(createTestMaintenanceLog(tx, orgId, otherMachine.id));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/maintenance_log\.equipment_id/);
    });
  });

  it("rejects a maintenance log whose file object is in another organization (0045)", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherFile = await createTestFileObject(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestMaintenanceLog(tx, orgId, machine.id, { fileObjectId: otherFile.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/maintenance_log\.file_object_id/);
    });
  });

  it("accepts a maintenance log with a NULL file object (guard skips a null FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const created = await createMaintenanceLog(tx, {
        organizationId: orgId,
        equipmentId: machine.id,
        kind: "inspection",
        performedAt: at("2026-04-01T08:00:00.000Z"),
        performedBy: "00000000-0000-0000-0000-0000000000ee",
        fileObjectId: null,
      });
      expect(created.fileObjectId).toBeNull();
    });
  });

  it("is not append-only: neither table has an append-only trigger", async () => {
    await inRollback(client.db, async (tx) => {
      const machine = await createTestEquipment(tx, orgId, locationId);
      const log = await createTestMaintenanceLog(tx, orgId, machine.id);
      // `DEC-092` records no append-only trigger on either table, so a plain
      // UPDATE and DELETE succeed (inside the rollback). The repository still
      // exposes create + read only for a maintenance log — this reaches the raw
      // table directly, exactly like the checklists slice's not-append-only test.
      await tx
        .update(maintenanceLog)
        .set({ notes: "amended in place" })
        .where(eq(maintenanceLog.id, log.id));
      await tx.delete(maintenanceLog).where(eq(maintenanceLog.id, log.id));
      await tx.delete(equipment).where(eq(equipment.id, machine.id));
    });
  });
});
