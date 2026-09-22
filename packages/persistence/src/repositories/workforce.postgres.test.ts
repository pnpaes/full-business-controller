import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { employee, employeeDocument, location, organization } from "../schema";
import {
  createEmployee,
  createEmployeeDocument,
  findEmployee,
  findEmployeeDocument,
  listEmployeeDocuments,
  listEmployees,
  updateEmployee,
  updateEmployeeDocument,
} from "./workforce";
import {
  createTestEmployee,
  createTestEmployeeDocument,
  createTestFileObject,
  createTestLocation,
  createTestOrganization,
  createTestUser,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

describe.skipIf(!databaseUrl)("workforce repository", () => {
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
      // Every employee and document is created inside a rolled-back transaction,
      // so the committed fixtures to unwind are the location and the
      // organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates an employee and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createEmployee(tx, {
        organizationId: orgId,
        name: "Ada Lovelace",
        roleCode: "kitchen",
        employmentType: "part_time",
        baseHourlyRate: "220.5000",
        costCenterId: "00000000-0000-4000-8000-0000000000cc",
        primaryLocationId: locationId,
        activeFrom: "2026-02-01",
        activeTo: "2026-12-31",
        actorId: "00000000-0000-0000-0000-0000000000aa",
      });
      expect(created.name).toBe("Ada Lovelace");
      expect(created.roleCode).toBe("kitchen");
      expect(created.employmentType).toBe("part_time");
      // The decimal crosses as a string, never a float.
      expect(created.baseHourlyRate).toBe("220.5000");
      expect(created.costCenterId).toBe("00000000-0000-4000-8000-0000000000cc");
      expect(created.primaryLocationId).toBe(locationId);
      expect(created.activeFrom).toBe("2026-02-01");
      expect(created.activeTo).toBe("2026-12-31");
      expect(created.userId).toBeNull();
      expect(created.retiredAt).toBeNull();
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000aa");

      expect((await findEmployee(tx, { organizationId: orgId, employeeId: created.id }))?.id).toBe(
        created.id,
      );

      // A row in another organization is invisible at this scope. If the
      // organization filter were dropped, this lookup would find the row and
      // the assertion would fail.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findEmployee(tx, { organizationId: otherOrgId, employeeId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults an employee's nullable fields to null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId);
      expect(created.employmentType).toBe("full_time");
      expect(created.baseHourlyRate).toBe("200.0000");
      expect(created.userId).toBeNull();
      expect(created.costCenterId).toBeNull();
      expect(created.primaryLocationId).toBeNull();
      expect(created.activeTo).toBeNull();
      expect(created.retiredAt).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists employees by primary location and retirement, ordered by name, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const a = await createTestEmployee(tx, orgId, {
        name: "A-emp",
        primaryLocationId: locationId,
      });
      const b = await createTestEmployee(tx, orgId, {
        name: "B-emp",
        primaryLocationId: locationId,
        retiredAt: new Date("2026-03-01T00:00:00.000Z"),
      });
      const otherLocation = await createTestLocation(tx, orgId);
      const c = await createTestEmployee(tx, orgId, {
        name: "C-emp",
        primaryLocationId: otherLocation.id,
      });

      // Name order (then id).
      const all = await listEmployees(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const here = await listEmployees(tx, {
        organizationId: orgId,
        primaryLocationId: locationId,
      });
      expect(here.map((row) => row.id)).toEqual([a.id, b.id]);

      // `active` is the not-retired filter, `retired` its complement.
      const active = await listEmployees(tx, { organizationId: orgId, active: true });
      expect(active.map((row) => row.id)).toEqual([a.id, c.id]);
      const retired = await listEmployees(tx, { organizationId: orgId, retired: true });
      expect(retired.map((row) => row.id)).toEqual([b.id]);

      const paged = await listEmployees(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's rows never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      await createTestEmployee(tx, otherOrgId, { name: "A-emp" });
      expect((await listEmployees(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        a.id,
        b.id,
        c.id,
      ]);
    });
  });

  it("updates an employee's mutable fields, records the actor and stores a retirement tombstone", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId, { name: "Patch Me" });
      const updated = await updateEmployee(tx, {
        organizationId: orgId,
        employeeId: created.id,
        name: "Renamed",
        roleCode: "front_of_house",
        employmentType: "temporary",
        baseHourlyRate: "199.9900",
        primaryLocationId: locationId,
        activeTo: "2026-06-30",
        retiredAt: new Date("2026-07-01T00:00:00.000Z"),
        actorId: "00000000-0000-0000-0000-0000000000bb",
      });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.roleCode).toBe("front_of_house");
      expect(updated?.employmentType).toBe("temporary");
      expect(updated?.baseHourlyRate).toBe("199.9900");
      expect(updated?.primaryLocationId).toBe(locationId);
      expect(updated?.activeTo).toBe("2026-06-30");
      expect(updated?.retiredAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000bb");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("clears a nullable employee field with an explicit null and leaves an omitted field untouched", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId, {
        name: "Clearable",
        primaryLocationId: locationId,
      });
      const updated = await updateEmployee(tx, {
        organizationId: orgId,
        employeeId: created.id,
        primaryLocationId: null,
        activeTo: null,
      });
      expect(updated?.name).toBe("Clearable");
      expect(updated?.primaryLocationId).toBeNull();
      expect(updated?.activeTo).toBeNull();
    });
  });

  it("does not update an employee through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId, { name: "Original" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateEmployee(tx, {
          organizationId: otherOrgId,
          employeeId: created.id,
          name: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (await findEmployee(tx, { organizationId: orgId, employeeId: created.id }))?.name,
      ).toBe("Original");
    });
  });

  it("rejects an employment type outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEmployee(tx, orgId, { employmentType: "freelance" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_employment_type_check/);
    });
  });

  it("rejects a negative base hourly rate", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEmployee(tx, orgId, { baseHourlyRate: "-1.0000" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_base_hourly_rate_check/);
    });
  });

  it("rejects an active_to that is not after active_from", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEmployee(tx, orgId, { activeFrom: "2026-05-01", activeTo: "2026-01-01" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_active_range_check/);
    });
  });

  it("rejects an employee whose primary location is in another organization (0047)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `location` row (so the single-column FK passes), but
      // the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestEmployee(tx, orgId, { primaryLocationId: otherLocation.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee\.primary_location_id/);
    });
  });

  it("accepts an employee with a NULL primary location (guard skips a null FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId, { primaryLocationId: null });
      expect(created.primaryLocationId).toBeNull();
    });
  });

  it("rejects an employee whose user is in another organization (0047)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `app_user` row (so the single-column FK passes), but
      // `app_user` is organization-scoped and the guard sees the mismatch.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherUser = await createTestUser(tx, otherOrgId);
      const cause = await rejectionCause(createTestEmployee(tx, orgId, { userId: otherUser.id }));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee\.user_id/);
    });
  });

  it("accepts an employee with a NULL user (guard skips a null FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestEmployee(tx, orgId, { userId: null });
      expect(created.userId).toBeNull();
    });
  });

  it("accepts an employee whose user is in the same organization (0047)", async () => {
    await inRollback(client.db, async (tx) => {
      const user = await createTestUser(tx, orgId);
      const created = await createTestEmployee(tx, orgId, { userId: user.id });
      expect(created.userId).toBe(user.id);
    });
  });

  it("creates a personnel document and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const file = await createTestFileObject(tx, orgId);
      const created = await createEmployeeDocument(tx, {
        organizationId: orgId,
        employeeId: person.id,
        kind: "certificate",
        title: "Food safety certificate",
        fileObjectId: file.id,
        issuedAt: "2026-01-01",
        expiresAt: "2028-01-01",
        actorId: "00000000-0000-0000-0000-0000000000dd",
      });
      expect(created.employeeId).toBe(person.id);
      expect(created.kind).toBe("certificate");
      expect(created.title).toBe("Food safety certificate");
      expect(created.fileObjectId).toBe(file.id);
      expect(created.issuedAt).toBe("2026-01-01");
      expect(created.expiresAt).toBe("2028-01-01");
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000dd");

      expect(
        (
          await findEmployeeDocument(tx, {
            organizationId: orgId,
            employeeDocumentId: created.id,
          })
        )?.id,
      ).toBe(created.id);

      // Another organization's scope cannot see the row.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findEmployeeDocument(tx, {
          organizationId: otherOrgId,
          employeeDocumentId: created.id,
        }),
      ).toBeUndefined();
    });
  });

  it("defaults a document's nullable file/date fields to null", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestEmployeeDocument(tx, orgId, person.id);
      expect(created.kind).toBe("contract");
      expect(created.fileObjectId).toBeNull();
      expect(created.issuedAt).toBeNull();
      expect(created.expiresAt).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists documents by employee and kind, ordered by title, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const otherPerson = await createTestEmployee(tx, orgId);

      const a = await createTestEmployeeDocument(tx, orgId, person.id, {
        title: "A-doc",
        kind: "contract",
      });
      const b = await createTestEmployeeDocument(tx, orgId, person.id, {
        title: "B-doc",
        kind: "certificate",
      });
      const c = await createTestEmployeeDocument(tx, orgId, otherPerson.id, {
        title: "C-doc",
        kind: "contract",
      });

      const all = await listEmployeeDocuments(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const here = await listEmployeeDocuments(tx, {
        organizationId: orgId,
        employeeId: person.id,
      });
      expect(here.map((row) => row.id)).toEqual([a.id, b.id]);

      const certificates = await listEmployeeDocuments(tx, {
        organizationId: orgId,
        kind: "certificate",
      });
      expect(certificates.map((row) => row.id)).toEqual([b.id]);

      const paged = await listEmployeeDocuments(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's documents never leak in: the exact id list
      // fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherEmployee = await createTestEmployee(tx, otherOrgId);
      await createTestEmployeeDocument(tx, otherOrgId, otherEmployee.id, { title: "A-doc" });
      expect(
        (await listEmployeeDocuments(tx, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([a.id, b.id, c.id]);
    });
  });

  it("updates a document's mutable fields and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestEmployeeDocument(tx, orgId, person.id, {
        title: "Old title",
        kind: "contract",
      });
      const updated = await updateEmployeeDocument(tx, {
        organizationId: orgId,
        employeeDocumentId: created.id,
        kind: "id_document",
        title: "New title",
        issuedAt: "2026-04-01",
        expiresAt: "2027-04-01",
        actorId: "00000000-0000-0000-0000-0000000000ee",
      });
      expect(updated?.kind).toBe("id_document");
      expect(updated?.title).toBe("New title");
      expect(updated?.issuedAt).toBe("2026-04-01");
      expect(updated?.expiresAt).toBe("2027-04-01");
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000ee");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("does not update a document through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const created = await createTestEmployeeDocument(tx, orgId, person.id, {
        title: "Original",
      });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateEmployeeDocument(tx, {
          organizationId: otherOrgId,
          employeeDocumentId: created.id,
          title: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (
          await findEmployeeDocument(tx, {
            organizationId: orgId,
            employeeDocumentId: created.id,
          })
        )?.title,
      ).toBe("Original");
    });
  });

  it("rejects a document kind outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const cause = await rejectionCause(
        createTestEmployeeDocument(tx, orgId, person.id, { kind: "photo" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_document_kind_check/);
    });
  });

  it("rejects an unregistered employee id (FK, not null)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestEmployeeDocument(tx, orgId, "00000000-0000-4000-8000-0000000000ff"),
      );
      expect(errorCode(cause)).toBe("23503");
      expect(cause.message).toMatch(/employee_document_employee_id_employee_id_fk/);
    });
  });

  it("rejects a document whose employee is in another organization (0047)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherPerson = await createTestEmployee(tx, otherOrgId);
      const cause = await rejectionCause(createTestEmployeeDocument(tx, orgId, otherPerson.id));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_document\.employee_id/);
    });
  });

  it("rejects a document whose file object is in another organization (0047)", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherFile = await createTestFileObject(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestEmployeeDocument(tx, orgId, person.id, { fileObjectId: otherFile.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_document\.file_object_id/);
    });
  });

  it("accepts a document with a NULL file object (guard skips a null FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const created = await createEmployeeDocument(tx, {
        organizationId: orgId,
        employeeId: person.id,
        kind: "other",
        title: "Unfiled note",
        fileObjectId: null,
        issuedAt: null,
        expiresAt: null,
      });
      expect(created.fileObjectId).toBeNull();
      expect(created.issuedAt).toBeNull();
      expect(created.expiresAt).toBeNull();
    });
  });

  it("is not append-only: employee and document rows are mutable in the database", async () => {
    await inRollback(client.db, async (tx) => {
      const person = await createTestEmployee(tx, orgId);
      const doc = await createTestEmployeeDocument(tx, orgId, person.id);
      // `DEC-087` records no append-only trigger on either table, so a plain
      // UPDATE and DELETE succeed (inside the rollback). The repository still
      // exposes the retire/update path rather than a delete command.
      await tx.update(employee).set({ name: "amended in place" }).where(eq(employee.id, person.id));
      await tx.delete(employeeDocument).where(eq(employeeDocument.id, doc.id));
      await tx.delete(employee).where(eq(employee.id, person.id));
    });
  });
});
