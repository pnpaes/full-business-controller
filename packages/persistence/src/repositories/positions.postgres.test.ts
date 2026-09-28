import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../client";
import type { DbClient } from "../client";
import { employee, employeePosition, organization, shift } from "../schema";
import {
  createTestEmployee,
  createTestLocation,
  createTestOrganization,
  ensureTestRole,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";
import {
  createPosition,
  findPosition,
  findPositionByCode,
  listEmployeePositionIds,
  listPositions,
  replaceEmployeePositions,
  updatePosition,
} from "./positions";
import { findRoleByCode } from "./bootstrap";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The PostgreSQL error code of a rejection's cause (e.g. `23505`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

describe.skipIf(!databaseUrl)("position repository", () => {
  let client: DbClient;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, `${suffix}_a`);
    otherOrgId = await createTestOrganization(client.db, `${suffix}_b`);
  });

  afterAll(async () => {
    if (client) {
      // Every row is written inside a rolled-back transaction, so the committed
      // fixtures are the two organizations.
      await client.db.delete(organization).where(inArray(organization.id, [orgId, otherOrgId]));
      await client.close();
    }
  });

  it("creates a position and reads it back organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPosition(tx, {
        organizationId: orgId,
        code: "barista",
        name: "Barista",
        activeFrom: "2026-01-01",
      });

      expect(created).toMatchObject({ organizationId: orgId, code: "barista", activeTo: null });
      expect(
        await findPosition(tx, { organizationId: orgId, positionId: created.id }),
      ).toMatchObject({ id: created.id });
      expect(
        await findPosition(tx, { organizationId: otherOrgId, positionId: created.id }),
      ).toBeUndefined();
      expect(
        await findPositionByCode(tx, { organizationId: orgId, code: "barista" }),
      ).toMatchObject({ id: created.id });
    });
  });

  it("keeps the code unique per organization (23505)", async () => {
    await inRollback(client.db, async (tx) => {
      await createPosition(tx, {
        organizationId: orgId,
        code: "cook",
        name: "Cook",
        activeFrom: "2026-01-01",
      });

      const cause = await rejectionCause(
        createPosition(tx, {
          organizationId: orgId,
          code: "cook",
          name: "Cook again",
          activeFrom: "2026-01-01",
        }),
      );
      expect(errorCode(cause)).toBe("23505");
    });
  });

  it("updates a position and lists with the active filter", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPosition(tx, {
        organizationId: orgId,
        code: "helper",
        name: "Helper",
        activeFrom: "2026-01-01",
      });
      const updated = await updatePosition(tx, {
        organizationId: orgId,
        positionId: created.id,
        name: "Kitchen helper",
        activeTo: "2026-06-30",
      });
      expect(updated).toMatchObject({ name: "Kitchen helper", activeTo: "2026-06-30" });

      const active = await listPositions(tx, { organizationId: orgId, active: true });
      expect(active.map((row) => row.id)).not.toContain(created.id);
      const inactive = await listPositions(tx, { organizationId: orgId, active: false });
      expect(inactive.map((row) => row.id)).toContain(created.id);
    });
  });

  it("replaces an employee's position set (the join table)", async () => {
    await inRollback(client.db, async (tx) => {
      const employeeRow = await createTestEmployee(tx, orgId);
      const barista = await createPosition(tx, {
        organizationId: orgId,
        code: "line_barista",
        name: "Barista",
        activeFrom: "2026-01-01",
      });
      const cook = await createPosition(tx, {
        organizationId: orgId,
        code: "line_cook",
        name: "Cook",
        activeFrom: "2026-01-01",
      });

      await replaceEmployeePositions(tx, {
        organizationId: orgId,
        employeeId: employeeRow.id,
        positionIds: [barista.id, cook.id, barista.id],
      });
      expect(
        await listEmployeePositionIds(tx, { organizationId: orgId, employeeId: employeeRow.id }),
      ).toEqual(expect.arrayContaining([barista.id, cook.id]));

      await replaceEmployeePositions(tx, {
        organizationId: orgId,
        employeeId: employeeRow.id,
        positionIds: [cook.id],
      });
      expect(
        await listEmployeePositionIds(tx, { organizationId: orgId, employeeId: employeeRow.id }),
      ).toEqual([cook.id]);

      await replaceEmployeePositions(tx, {
        organizationId: orgId,
        employeeId: employeeRow.id,
        positionIds: [],
      });
      expect(
        await listEmployeePositionIds(tx, { organizationId: orgId, employeeId: employeeRow.id }),
      ).toEqual([]);
    });
  });

  it("rejects a cross-organization employee↔position grant (0080 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const employeeRow = await createTestEmployee(tx, orgId);
      const foreignPosition = await createPosition(tx, {
        organizationId: otherOrgId,
        code: "foreign_role",
        name: "Foreign",
        activeFrom: "2026-01-01",
      });

      const cause = await rejectionCause(
        tx.insert(employeePosition).values({
          organizationId: orgId,
          employeeId: employeeRow.id,
          positionId: foreignPosition.id,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
    });
  });

  it("validates the employee role reference (0080 FK)", async () => {
    await inRollback(client.db, async (tx) => {
      // The organization's fixed vocabulary holds `kitchen`; an unknown code is
      // refused by the composite FK, not silently.
      await ensureTestRole(tx, orgId, "kitchen");
      expect(await findRoleByCode(tx, orgId, "kitchen")).toBeDefined();

      const cause = await rejectionCause(
        tx.insert(employee).values({
          organizationId: orgId,
          name: "No role",
          roleCode: "not_a_role",
          employmentType: "part_time",
          baseHourlyRate: "200.0000",
          activeFrom: "2026-01-01",
        }),
      );
      expect(errorCode(cause)).toBe("23503");
    });
  });

  it("links a shift to its position and rejects a foreign-organization position (23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = (await createTestLocation(tx, orgId)).id;
      const positionRow = await createPosition(tx, {
        organizationId: orgId,
        code: "shift_pos",
        name: "Shift position",
        activeFrom: "2026-01-01",
      });
      const foreign = await createPosition(tx, {
        organizationId: otherOrgId,
        code: "shift_pos_foreign",
        name: "Foreign",
        activeFrom: "2026-01-01",
      });

      const rows = await tx
        .insert(shift)
        .values({
          organizationId: orgId,
          locationId,
          positionId: positionRow.id,
          roleCode: "barista",
          startsAt: new Date("2026-07-01T08:00:00.000Z"),
          endsAt: new Date("2026-07-01T16:00:00.000Z"),
        })
        .returning();
      expect(rows[0]!.positionId).toBe(positionRow.id);

      const cause = await rejectionCause(
        tx.insert(shift).values({
          organizationId: orgId,
          locationId,
          positionId: foreign.id,
          startsAt: new Date("2026-07-02T08:00:00.000Z"),
          endsAt: new Date("2026-07-02T16:00:00.000Z"),
        }),
      );
      expect(errorCode(cause)).toBe("23514");
    });
  });
});
