import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  createDb,
  createEmployeeDocument as createEmployeeDocumentRow,
  findEmployee as findEmployeeRow,
  listAuditEventsForEntity,
  location,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmployeeDocument } from "./create-employee-document";
import { findEmployee } from "./find-employee";
import { findEmployeeDocument } from "./find-employee-document";
import { listEmployeeDocuments } from "./list-employee-documents";
import { listEmployees } from "./list-employees";
import { createPostgresWorkforceStore } from "./postgres-store";
import { registerEmployee } from "./register-employee";
import { retireEmployee } from "./retire-employee";
import { updateEmployeeDocument } from "./update-employee-document";
import { updateEmployee } from "./update-employee";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
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

async function seedLocation(tx: DatabaseTransaction, orgId: string, code: string): Promise<string> {
  const rows = await tx
    .insert(location)
    .values({ organizationId: orgId, code, name: "Workforce IT location" })
    .returning();
  return rows[0]!.id;
}

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

/** Awaits `operation` expecting it to reject, returning the underlying driver error. */
async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
}

describe.skipIf(!databaseUrl)("workforce against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Workforce IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every employee, document and location is created inside a rolled-back
      // transaction, so only the organization is committed.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("registers, updates and retires an employee with the actor audit columns", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `wf_${suffix}`);
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();

      const employee = await registerEmployee(store, {
        organizationId: orgId,
        actorId,
        name: "Nora Nordmann",
        roleCode: "barista",
        employmentType: "part_time",
        baseHourlyRate: "215.5000",
        primaryLocationId: locationId,
        activeFrom: "2026-01-01",
        activeTo: "2026-06-30",
      });
      expect(employee).toMatchObject({
        organizationId: orgId,
        name: "Nora Nordmann",
        roleCode: "barista",
        employmentType: "part_time",
        baseHourlyRate: "215.5000",
        primaryLocationId: locationId,
        activeFrom: "2026-01-01",
        activeTo: "2026-06-30",
        retiredAt: null,
        createdBy: actorId,
      });

      const editorId = randomUUID();
      const updated = await updateEmployee(store, {
        organizationId: orgId,
        actorId: editorId,
        employeeId: employee.id,
        name: "Nora N.",
        baseHourlyRate: "240.0000",
      });
      expect(updated).toMatchObject({
        id: employee.id,
        name: "Nora N.",
        baseHourlyRate: "240.0000",
        createdBy: actorId,
        updatedBy: editorId,
      });

      const retired = await retireEmployee(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
      });
      expect(retired.retiredAt).not.toBeNull();
      expect(new Date(retired.retiredAt!).toISOString()).toBe(retired.retiredAt);

      const found = await findEmployee(store, { organizationId: orgId, employeeId: employee.id });
      expect(found).toMatchObject({ id: employee.id, retiredAt: retired.retiredAt });
    });
  });

  it("makes a repeated retire a no-op: instant, audit columns and audit fact unchanged", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const employee = await registerEmployee(store, {
        organizationId: orgId,
        actorId,
        name: "Retire Twice",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        activeFrom: "2026-01-01",
      });

      const readStored = async (): Promise<{
        readonly updatedAt: Date | null | undefined;
        readonly updatedBy: string | null | undefined;
      }> => {
        const row = await findEmployeeRow(tx, { organizationId: orgId, employeeId: employee.id });
        return { updatedAt: row?.updatedAt, updatedBy: row?.updatedBy };
      };
      const retiredFactCount = async (): Promise<number> =>
        (await listAuditEventsForEntity(tx, "employee", employee.id)).filter(
          (row) => row.action === "workforce.employee.retired",
        ).length;

      const first = await retireEmployee(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
      });
      const afterFirst = await readStored();
      expect(await retiredFactCount()).toBe(1);

      // A repeat must not rewrite the row (the audit columns stay put) nor
      // append a second retirement fact.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await retireEmployee(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
      });

      expect(second.retiredAt).toBe(first.retiredAt);
      const afterSecond = await readStored();
      expect(afterSecond.updatedAt?.toISOString()).toBe(afterFirst.updatedAt?.toISOString());
      expect(afterSecond.updatedBy).toBe(afterFirst.updatedBy);
      expect(await retiredFactCount()).toBe(1);
    });
  });

  it("creates and updates a personnel document with the actor audit columns", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const employee = await registerEmployee(store, {
        organizationId: orgId,
        actorId,
        name: "Doc Holder",
        roleCode: "front_of_house",
        employmentType: "part_time",
        baseHourlyRate: "210.0000",
        activeFrom: "2026-01-01",
      });

      const document = await createEmployeeDocument(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
        kind: "certificate",
        title: "Food hygiene certificate",
        issuedAt: "2025-05-01",
        expiresAt: "2027-05-01",
      });
      expect(document).toMatchObject({
        organizationId: orgId,
        employeeId: employee.id,
        kind: "certificate",
        title: "Food hygiene certificate",
        fileObjectId: null,
        issuedAt: "2025-05-01",
        expiresAt: "2027-05-01",
        createdBy: actorId,
      });

      const editorId = randomUUID();
      const updated = await updateEmployeeDocument(store, {
        organizationId: orgId,
        actorId: editorId,
        employeeDocumentId: document.id,
        kind: "other",
        title: "Renewed certificate",
        expiresAt: "2028-05-01",
      });
      expect(updated).toMatchObject({
        id: document.id,
        kind: "other",
        title: "Renewed certificate",
        issuedAt: "2025-05-01",
        expiresAt: "2028-05-01",
        createdBy: actorId,
        updatedBy: editorId,
      });

      const found = await findEmployeeDocument(store, {
        organizationId: orgId,
        employeeDocumentId: document.id,
      });
      expect(found?.title).toBe("Renewed certificate");
    });
  });

  it("rejects invalid money, range and vocabulary at the command boundary", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const base = {
        organizationId: orgId,
        actorId,
        name: "Invalid",
        roleCode: "barista",
        employmentType: "part_time",
        activeFrom: "2026-01-01",
      } as const;

      await expect(registerEmployee(store, { ...base, baseHourlyRate: "1.23456" })).rejects.toThrow(
        DomainError,
      );
      await expect(registerEmployee(store, { ...base, baseHourlyRate: "-1.0000" })).rejects.toThrow(
        /must not be negative/,
      );
      await expect(
        registerEmployee(store, {
          ...base,
          baseHourlyRate: 215.5 as unknown as string,
        }),
      ).rejects.toThrow(/baseHourlyRate must be a decimal string/);
      await expect(
        registerEmployee(store, { ...base, baseHourlyRate: "1.0000", activeTo: "2025-12-31" }),
      ).rejects.toThrow(/activeTo must be after activeFrom/);
      await expect(
        registerEmployee(store, { ...base, baseHourlyRate: "1.0000", employmentType: "seasonal" }),
      ).rejects.toThrow(/employmentType must be one of/);

      expect(await listEmployees(store, { organizationId: orgId })).toEqual([]);
    });
  });

  it("resolves the employee organization-scoped for a document", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const { otherOrgId, otherLocationId } = await seedForeignOrg(tx, `resolve_${suffix}`);

      const otherEmployee = await registerEmployee(store, {
        organizationId: otherOrgId,
        actorId,
        name: "Other Tenant",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        primaryLocationId: otherLocationId,
        activeFrom: "2026-01-01",
      });

      await expect(
        createEmployeeDocument(store, {
          organizationId: orgId,
          actorId,
          employeeId: randomUUID(),
          kind: "contract",
          title: "Orphan",
        }),
      ).rejects.toThrow(NotFoundError);
      // A cross-organization employee id does not leak: the resolve is
      // organization-scoped, so the foreign row is invisible before the insert.
      await expect(
        createEmployeeDocument(store, {
          organizationId: orgId,
          actorId,
          employeeId: otherEmployee.id,
          kind: "contract",
          title: "Foreign",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("isolates employees and documents by organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const { otherOrgId, otherLocationId } = await seedForeignOrg(tx, `isolate_${suffix}`);

      const otherEmployee = await registerEmployee(store, {
        organizationId: otherOrgId,
        actorId,
        name: "Other Tenant",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        primaryLocationId: otherLocationId,
        activeFrom: "2026-01-01",
      });
      const otherDocument = await createEmployeeDocument(store, {
        organizationId: otherOrgId,
        actorId,
        employeeId: otherEmployee.id,
        kind: "contract",
        title: "Other tenant contract",
      });

      // The org filter is load-bearing: dropping it would leak the other rows.
      expect(await listEmployees(store, { organizationId: orgId })).toEqual([]);
      expect(
        await findEmployee(store, { organizationId: orgId, employeeId: otherEmployee.id }),
      ).toBeUndefined();
      expect(await listEmployeeDocuments(store, { organizationId: orgId })).toEqual([]);
      expect(
        await findEmployeeDocument(store, {
          organizationId: orgId,
          employeeDocumentId: otherDocument.id,
        }),
      ).toBeUndefined();
    });
  });

  it("filters and pages the employee list", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `wf_list_${suffix}`);
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const register = (name: string, primaryLocationId: string | null = null) =>
        registerEmployee(store, {
          organizationId: orgId,
          actorId,
          name,
          roleCode: "barista",
          employmentType: "part_time",
          baseHourlyRate: "200.0000",
          activeFrom: "2026-01-01",
          primaryLocationId,
        });

      const alice = await register("Alice", locationId);
      await register("Bob");
      const carol = await register("Carol");
      await retireEmployee(store, { organizationId: orgId, actorId, employeeId: carol.id });

      expect((await listEmployees(store, { organizationId: orgId })).map((e) => e.name)).toEqual([
        "Alice",
        "Bob",
        "Carol",
      ]);
      expect(
        (await listEmployees(store, { organizationId: orgId, primaryLocationId: locationId })).map(
          (e) => e.name,
        ),
      ).toEqual(["Alice"]);
      expect(
        (await listEmployees(store, { organizationId: orgId, active: true })).map((e) => e.name),
      ).toEqual(["Alice", "Bob"]);
      expect(
        (await listEmployees(store, { organizationId: orgId, retired: true })).map((e) => e.name),
      ).toEqual(["Carol"]);
      expect(
        (await listEmployees(store, { organizationId: orgId, limit: 2, offset: 1 })).map(
          (e) => e.name,
        ),
      ).toEqual(["Bob", "Carol"]);
      expect(alice.retiredAt).toBeNull();
    });
  });

  it("filters the document list by employee and kind", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const employee = await registerEmployee(store, {
        organizationId: orgId,
        actorId,
        name: "Doc Lister",
        roleCode: "barista",
        employmentType: "part_time",
        baseHourlyRate: "200.0000",
        activeFrom: "2026-01-01",
      });
      await createEmployeeDocument(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
        kind: "contract",
        title: "Contract",
      });
      await createEmployeeDocument(store, {
        organizationId: orgId,
        actorId,
        employeeId: employee.id,
        kind: "certificate",
        title: "Certificate",
      });

      expect(
        (
          await listEmployeeDocuments(store, {
            organizationId: orgId,
            employeeId: employee.id,
          })
        ).map((d) => d.title),
      ).toEqual(["Certificate", "Contract"]);
      expect(
        (
          await listEmployeeDocuments(store, {
            organizationId: orgId,
            employeeId: employee.id,
            kind: "certificate",
          })
        ).map((d) => d.title),
      ).toEqual(["Certificate"]);
    });
  });

  it("refuses an employee whose primary location belongs to another organization (0047 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const { otherLocationId } = await seedForeignOrg(tx, `guard_employee_${suffix}`);

      const cause = await rejectionCause(
        registerEmployee(store, {
          organizationId: orgId,
          actorId,
          name: "Wrong organization location",
          roleCode: "barista",
          employmentType: "part_time",
          baseHourlyRate: "200.0000",
          primaryLocationId: otherLocationId,
          activeFrom: "2026-01-01",
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee\.primary_location_id/);
    });
  });

  it("refuses a document for another organization's employee (0047 guard, 23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresWorkforceStore(tx);
      const actorId = randomUUID();
      const { otherOrgId, otherLocationId } = await seedForeignOrg(tx, `guard_document_${suffix}`);

      const otherEmployee = await registerEmployee(store, {
        organizationId: otherOrgId,
        actorId,
        name: "Other Tenant",
        roleCode: "kitchen",
        employmentType: "full_time",
        baseHourlyRate: "200.0000",
        primaryLocationId: otherLocationId,
        activeFrom: "2026-01-01",
      });

      // The command resolves the employee organization-scoped and refuses the
      // foreign id before the insert; bypass the command to exercise the
      // `employee_document.employee_id` 23514 backstop directly.
      const cause = await rejectionCause(
        createEmployeeDocumentRow(tx, {
          organizationId: orgId,
          employeeId: otherEmployee.id,
          kind: "contract",
          title: "Foreign employee document",
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/employee_document\.employee_id/);
    });
  });
});

/**
 * Creates, inside the surrounding rolled-back transaction, a second organization
 * plus one location, returning both ids; the stores then exercise
 * cross-organization paths against the returned `otherOrgId`.
 */
async function seedForeignOrg(
  tx: DatabaseTransaction,
  codeSuffix: string,
): Promise<{ otherOrgId: string; otherLocationId: string }> {
  const rows = await tx
    .insert(organization)
    .values({ legalName: `Workforce IT other ${codeSuffix}` })
    .returning();
  const otherOrgId = rows[0]!.id;
  const otherLocationId = await seedLocation(tx, otherOrgId, `wf_other_${codeSuffix}`);
  return { otherOrgId, otherLocationId };
}
