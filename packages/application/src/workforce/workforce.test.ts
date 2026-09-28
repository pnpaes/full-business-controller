import { DomainError, NotFoundError } from "@aquarela/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmployeeDocument } from "./create-employee-document";
import type { CreateEmployeeDocumentInput } from "./create-employee-document";
import { findEmployee } from "./find-employee";
import { findEmployeeDocument } from "./find-employee-document";
import { DEFAULT_EMPLOYEE_DOCUMENT_LIMIT, listEmployeeDocuments } from "./list-employee-documents";
import { DEFAULT_EMPLOYEE_LIMIT, listEmployees } from "./list-employees";
import { registerEmployee } from "./register-employee";
import type { RegisterEmployeeInput } from "./register-employee";
import { retireEmployee } from "./retire-employee";
import { FakeWorkforceStore, seedWorkforceFixture, type WorkforceFixture } from "./test-support";
import type { EmployeeDocumentRecord, EmployeeRecord } from "./types";
import { updateEmployeeDocument } from "./update-employee-document";
import type { UpdateEmployeeDocumentInput } from "./update-employee-document";
import { updateEmployee } from "./update-employee";
import type { UpdateEmployeeInput } from "./update-employee";

function setup(): { store: FakeWorkforceStore; fixture: WorkforceFixture } {
  const store = new FakeWorkforceStore();
  return { store, fixture: seedWorkforceFixture() };
}

function register(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  overrides: Partial<RegisterEmployeeInput> = {},
): Promise<EmployeeRecord> {
  return registerEmployee(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    name: "Nora Nordmann",
    roleCode: "front_of_house",
    employmentType: "part_time",
    baseHourlyRate: "215.5000",
    activeFrom: "2026-01-01",
    ...overrides,
  });
}

function update(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  employee: EmployeeRecord,
  overrides: Partial<UpdateEmployeeInput> = {},
): Promise<EmployeeRecord> {
  return updateEmployee(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    employeeId: employee.id,
    ...overrides,
  });
}

function createDocument(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  employee: EmployeeRecord,
  overrides: Partial<CreateEmployeeDocumentInput> = {},
): Promise<EmployeeDocumentRecord> {
  return createEmployeeDocument(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    employeeId: employee.id,
    kind: "contract",
    title: "Permanent contract",
    ...overrides,
  });
}

function updateDocument(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  document: EmployeeDocumentRecord,
  overrides: Partial<UpdateEmployeeDocumentInput> = {},
): Promise<EmployeeDocumentRecord> {
  return updateEmployeeDocument(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    employeeDocumentId: document.id,
    ...overrides,
  });
}

describe("registerEmployee", () => {
  it("registers an employee with its audit fact", async () => {
    const { store, fixture } = setup();

    const employee = await register(store, fixture, {
      name: "  Nora Nordmann  ",
      roleCode: "  front_of_house  ",
      userId: "user-1",
      costCenterId: "cc-1",
      primaryLocationId: fixture.locationId,
      baseHourlyRate: "215.5000",
      activeTo: "2026-06-30",
    });

    expect(employee).toMatchObject({
      organizationId: fixture.organizationId,
      userId: "user-1",
      name: "Nora Nordmann",
      roleCode: "front_of_house",
      employmentType: "part_time",
      baseHourlyRate: "215.5000",
      costCenterId: "cc-1",
      primaryLocationId: fixture.locationId,
      activeFrom: "2026-01-01",
      activeTo: "2026-06-30",
      retiredAt: null,
      createdBy: fixture.actorId,
      updatedBy: null,
    });
    expect(store.employees.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "workforce.employee.created");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "employee",
      entityId: employee.id,
      after: {
        user_id: "user-1",
        name: "Nora Nordmann",
        role_code: "front_of_house",
        employment_type: "part_time",
        base_hourly_rate: "215.5000",
        cost_center_id: "cc-1",
        primary_location_id: fixture.locationId,
        active_from: "2026-01-01",
        active_to: "2026-06-30",
        retired_at: null,
      },
    });
  });

  it("rejects a blank name, role code or employment type without writing", async () => {
    const { store, fixture } = setup();

    await expect(register(store, fixture, { name: "  " })).rejects.toThrow(/name is required/);
    await expect(register(store, fixture, { roleCode: "" })).rejects.toThrow(
      /roleCode is required/,
    );
    await expect(register(store, fixture, { employmentType: "  " })).rejects.toThrow(
      /employmentType is required/,
    );
    await expect(register(store, fixture, { employmentType: "seasonal" })).rejects.toThrow(
      /employmentType must be one of/,
    );

    expect(store.employees.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a float, an over-precise, a negative or a malformed baseHourlyRate", async () => {
    const { store, fixture } = setup();

    // A JS number is a float, never a decimal string.
    await expect(
      register(store, fixture, { baseHourlyRate: 215.5 as unknown as string }),
    ).rejects.toThrow(/baseHourlyRate must be a decimal string/);
    await expect(register(store, fixture, { baseHourlyRate: "215.54321" })).rejects.toThrow(
      DomainError,
    );
    await expect(register(store, fixture, { baseHourlyRate: "-1" })).rejects.toThrow(
      /must not be negative/,
    );
    await expect(register(store, fixture, { baseHourlyRate: "1e3" })).rejects.toThrow(DomainError);

    expect(store.employees.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects an invalid activeFrom or a non-increasing activeTo", async () => {
    const { store, fixture } = setup();

    await expect(register(store, fixture, { activeFrom: "2026-02-31" })).rejects.toThrow(
      /activeFrom must be a date/,
    );
    await expect(register(store, fixture, { activeFrom: "01-01-2026" })).rejects.toThrow(
      /activeFrom must be a date/,
    );
    await expect(
      register(store, fixture, { activeFrom: "2026-01-01", activeTo: "2026-01-01" }),
    ).rejects.toThrow(/activeTo must be after activeFrom/);
    await expect(
      register(store, fixture, { activeFrom: "2026-06-01", activeTo: "2026-01-01" }),
    ).rejects.toThrow(/activeTo must be after activeFrom/);

    expect(store.employees.size).toBe(0);
  });
});

describe("updateEmployee", () => {
  it("applies a patch and records the before/after diff", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    const updated = await update(store, fixture, employee, {
      name: "Nora N.",
      employmentType: "full_time",
      baseHourlyRate: "240.0000",
      primaryLocationId: fixture.otherLocationId,
      activeTo: "2026-12-31",
    });

    expect(updated).toMatchObject({
      id: employee.id,
      name: "Nora N.",
      employmentType: "full_time",
      baseHourlyRate: "240.0000",
      primaryLocationId: fixture.otherLocationId,
      activeTo: "2026-12-31",
      updatedBy: fixture.actorId,
    });

    const audit = store.audits.find((row) => row.action === "workforce.employee.updated");
    expect(audit).toMatchObject({
      entityId: employee.id,
      before: {
        name: "Nora Nordmann",
        employment_type: "part_time",
        base_hourly_rate: "215.5000",
        primary_location_id: null,
        active_to: null,
      },
      after: {
        name: "Nora N.",
        employment_type: "full_time",
        base_hourly_rate: "240.0000",
        primary_location_id: fixture.otherLocationId,
        active_to: "2026-12-31",
      },
    });
  });

  it("clears an optional id with an explicit null", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture, { primaryLocationId: fixture.locationId });

    const updated = await update(store, fixture, employee, { primaryLocationId: null });

    expect(updated.primaryLocationId).toBeNull();
  });

  it("rejects an empty patch", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    await expect(update(store, fixture, employee)).rejects.toThrow(/no updatable fields provided/);
    expect(store.audits.filter((row) => row.action === "workforce.employee.updated")).toHaveLength(
      0,
    );
  });

  it("re-validates a supplied field before writing anything", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    await expect(update(store, fixture, employee, { name: "  " })).rejects.toThrow(
      /name is required/,
    );
    await expect(update(store, fixture, employee, { baseHourlyRate: "1.23456" })).rejects.toThrow(
      DomainError,
    );
    await expect(update(store, fixture, employee, { employmentType: "seasonal" })).rejects.toThrow(
      /employmentType must be one of/,
    );

    expect(store.employees.get(employee.id)?.name).toBe("Nora Nordmann");
    expect(store.audits.filter((row) => row.action === "workforce.employee.updated")).toHaveLength(
      0,
    );
  });

  it("rejects an activeTo that is not after the immutable activeFrom", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture, { activeFrom: "2026-03-01" });

    await expect(update(store, fixture, employee, { activeTo: "2026-02-28" })).rejects.toThrow(
      /activeTo must be after activeFrom/,
    );
    expect(store.employees.get(employee.id)?.activeTo).toBeNull();
  });

  it("reports an unknown or cross-organization row as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      primaryLocationId: fixture.otherLocationId,
    });

    await expect(
      updateEmployee(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeId: "missing",
        name: "Ghost",
      }),
    ).rejects.toThrow(NotFoundError);
    // The org filter is load-bearing: dropping it would edit the other row.
    await expect(
      updateEmployee(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeId: other.id,
        name: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.employees.get(other.id)?.name).toBe("Nora Nordmann");
  });
});

describe("retireEmployee", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the retirement tombstone and records its own audit action", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    const retired = await retireEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: employee.id,
    });

    expect(retired.retiredAt).not.toBeNull();
    expect(retired.updatedBy).toBe(fixture.actorId);
    // Retired, never deleted: the row is still present.
    expect(store.employees.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "workforce.employee.retired");
    expect(audit).toMatchObject({
      entityId: employee.id,
      before: { retired_at: null },
      after: { retired_at: retired.retiredAt },
    });
  });

  it("makes a repeated retire a true no-op: no second audit fact, unchanged record", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
    const first = await retireEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: employee.id,
    });
    expect(first.retiredAt).toBe("2026-01-15T09:00:00.000Z");

    // The stored record after the first retire: the repeat must not rewrite it.
    const storedAfterFirst = store.employees.get(employee.id);
    const retiredFacts = (): number =>
      store.audits.filter((row) => row.action === "workforce.employee.retired").length;
    expect(retiredFacts()).toBe(1);

    vi.setSystemTime(new Date("2026-08-01T09:00:00.000Z"));
    const second = await retireEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: employee.id,
    });

    // The tombstone is preserved and the record is returned untouched (same
    // reference: no update was written, so `updated_by`/`updated_at` cannot
    // move), and no second retirement fact is appended.
    expect(second.retiredAt).toBe("2026-01-15T09:00:00.000Z");
    expect(second).toEqual(first);
    expect(store.employees.get(employee.id)).toBe(storedAfterFirst);
    expect(retiredFacts()).toBe(1);
  });

  it("reports an unknown or cross-organization employee as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });

    await expect(
      retireEmployee(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeId: other.id,
      }),
    ).rejects.toThrow(NotFoundError);
    expect(store.employees.get(other.id)?.retiredAt).toBeNull();
  });
});

describe("findEmployee and listEmployees", () => {
  it("finds a row for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const other = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });

    expect(
      (
        await findEmployee(store, {
          organizationId: fixture.organizationId,
          employeeId: employee.id,
        })
      )?.id,
    ).toBe(employee.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findEmployee(store, { organizationId: fixture.organizationId, employeeId: other.id }),
    ).toBeUndefined();
    expect(
      await findEmployee(store, { organizationId: fixture.organizationId, employeeId: "missing" }),
    ).toBeUndefined();
  });

  it("returns nothing for an organization that holds no rows", async () => {
    const { store, fixture } = setup();
    await register(store, fixture, { organizationId: fixture.otherOrganizationId });

    // Only the other organization has a row: dropping the org filter would leak it.
    expect(await listEmployees(store, { organizationId: fixture.organizationId })).toEqual([]);
  });

  it("orders by name and applies the location, active and retired filters", async () => {
    const { store, fixture } = setup();
    const alice = await register(store, fixture, {
      name: "Alice",
      primaryLocationId: fixture.locationId,
    });
    await register(store, fixture, { name: "Bob", primaryLocationId: fixture.otherLocationId });
    const carol = await register(store, fixture, { name: "Carol" });
    await retireEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: carol.id,
    });

    expect(
      (await listEmployees(store, { organizationId: fixture.organizationId })).map((e) => e.name),
    ).toEqual(["Alice", "Bob", "Carol"]);
    expect(
      (
        await listEmployees(store, {
          organizationId: fixture.organizationId,
          primaryLocationId: fixture.locationId,
        })
      ).map((e) => e.name),
    ).toEqual(["Alice"]);
    expect(
      (await listEmployees(store, { organizationId: fixture.organizationId, active: true })).map(
        (e) => e.name,
      ),
    ).toEqual(["Alice", "Bob"]);
    expect(
      (await listEmployees(store, { organizationId: fixture.organizationId, retired: true })).map(
        (e) => e.name,
      ),
    ).toEqual(["Carol"]);
    expect(
      (await listEmployees(store, { organizationId: fixture.organizationId, retired: false })).map(
        (e) => e.name,
      ),
    ).toEqual(["Alice", "Bob"]);
    expect(alice.retiredAt).toBeNull();
  });

  it("rejects contradictory active/retired filters as a DomainError", async () => {
    const { store, fixture } = setup();
    await register(store, fixture);

    // `active` is the not-retired filter and `retired` its complement, so a
    // caller asking for the same value on both can only ever get nothing.
    await expect(
      listEmployees(store, { organizationId: fixture.organizationId, active: true, retired: true }),
    ).rejects.toThrow(DomainError);
    await expect(
      listEmployees(store, {
        organizationId: fixture.organizationId,
        active: false,
        retired: false,
      }),
    ).rejects.toThrow(DomainError);
    // The consistent pairs (both sides of the same axis) still work.
    await expect(
      listEmployees(store, {
        organizationId: fixture.organizationId,
        active: true,
        retired: false,
      }),
    ).resolves.toHaveLength(1);
  });

  it("caps a direct store read at the default limit when the caller omits one", async () => {
    const { store, fixture } = setup();
    for (let index = 0; index < DEFAULT_EMPLOYEE_LIMIT + 2; index += 1) {
      await register(store, fixture, { name: `Employee ${String(index).padStart(3, "0")}` });
    }

    // The fake mirrors the adapter: an omitted `limit` is bounded, not unbounded.
    expect(await store.listEmployees({ organizationId: fixture.organizationId })).toHaveLength(
      DEFAULT_EMPLOYEE_LIMIT,
    );
  });

  it("pages after the ordering and caps an unbounded read at the default limit", async () => {
    const { store, fixture } = setup();
    for (let index = 0; index < DEFAULT_EMPLOYEE_LIMIT + 3; index += 1) {
      await register(store, fixture, { name: `Employee ${String(index).padStart(3, "0")}` });
    }

    const firstPage = await listEmployees(store, { organizationId: fixture.organizationId });
    expect(firstPage).toHaveLength(DEFAULT_EMPLOYEE_LIMIT);
    expect(firstPage[0]?.name).toBe("Employee 000");

    const secondPage = await listEmployees(store, {
      organizationId: fixture.organizationId,
      offset: DEFAULT_EMPLOYEE_LIMIT,
    });
    expect(secondPage.map((e) => e.name)).toEqual(["Employee 050", "Employee 051", "Employee 052"]);

    const windowed = await listEmployees(store, {
      organizationId: fixture.organizationId,
      limit: 2,
      offset: 1,
    });
    expect(windowed.map((e) => e.name)).toEqual(["Employee 001", "Employee 002"]);
  });
});

describe("createEmployeeDocument", () => {
  it("creates a personnel-document metadata row and its audit fact", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture, { primaryLocationId: fixture.locationId });

    const document = await createDocument(store, fixture, employee, {
      kind: "certificate",
      title: "  Food hygiene certificate  ",
      issuedAt: "2025-05-01",
      expiresAt: "2027-05-01",
    });

    expect(document).toMatchObject({
      organizationId: fixture.organizationId,
      employeeId: employee.id,
      kind: "certificate",
      title: "Food hygiene certificate",
      fileObjectId: null,
      issuedAt: "2025-05-01",
      expiresAt: "2027-05-01",
      createdBy: fixture.actorId,
      updatedBy: null,
    });
    expect(store.employeeDocuments.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "workforce.employee_document.created");
    expect(audit).toMatchObject({
      entityType: "employee_document",
      entityId: document.id,
      after: {
        employee_id: employee.id,
        kind: "certificate",
        title: "Food hygiene certificate",
        file_object_id: null,
        issued_at: "2025-05-01",
        expires_at: "2027-05-01",
      },
    });
  });

  it("rejects a bad kind, a blank title or an inverted validity window", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    await expect(createDocument(store, fixture, employee, { kind: "passport" })).rejects.toThrow(
      /kind must be one of/,
    );
    await expect(createDocument(store, fixture, employee, { title: "  " })).rejects.toThrow(
      /title is required/,
    );
    await expect(
      createDocument(store, fixture, employee, {
        issuedAt: "2027-01-01",
        expiresAt: "2026-01-01",
      }),
    ).rejects.toThrow(/expiresAt must not precede issuedAt/);
    await expect(
      createDocument(store, fixture, employee, { issuedAt: "2026-02-31" }),
    ).rejects.toThrow(/issuedAt must be a date/);

    expect(store.employeeDocuments.size).toBe(0);
    expect(
      store.audits.filter((row) => row.action === "workforce.employee_document.created"),
    ).toHaveLength(0);
  });

  it("accepts an equal issuedAt and expiresAt", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);

    const document = await createDocument(store, fixture, employee, {
      issuedAt: "2026-01-01",
      expiresAt: "2026-01-01",
    });

    expect(document.expiresAt).toBe("2026-01-01");
  });

  it("reports an unregistered or cross-organization employee as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });

    await expect(
      createEmployeeDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeId: "missing",
        kind: "contract",
        title: "Orphan contract",
      }),
    ).rejects.toThrow(NotFoundError);
    // A cross-organization employee id does not leak: the resolve is org-scoped,
    // so the foreign employee is invisible before the document is created.
    await expect(createDocument(store, fixture, other)).rejects.toThrow(NotFoundError);

    expect(store.employeeDocuments.size).toBe(0);
  });
});

describe("updateEmployeeDocument", () => {
  it("applies a patch and records the before/after diff", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const document = await createDocument(store, fixture, employee, {
      issuedAt: "2025-01-01",
      expiresAt: "2026-01-01",
    });

    const updated = await updateDocument(store, fixture, document, {
      kind: "other",
      title: "Renewed contract",
      fileObjectId: "file-1",
      expiresAt: "2027-01-01",
    });

    expect(updated).toMatchObject({
      id: document.id,
      kind: "other",
      title: "Renewed contract",
      fileObjectId: "file-1",
      issuedAt: "2025-01-01",
      expiresAt: "2027-01-01",
      updatedBy: fixture.actorId,
    });

    const audit = store.audits.find((row) => row.action === "workforce.employee_document.updated");
    expect(audit).toMatchObject({
      entityId: document.id,
      before: { kind: "contract", title: "Permanent contract", file_object_id: null },
      after: { kind: "other", title: "Renewed contract", file_object_id: "file-1" },
    });
  });

  it("rejects an empty patch", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const document = await createDocument(store, fixture, employee);

    await expect(updateDocument(store, fixture, document)).rejects.toThrow(
      /no updatable fields provided/,
    );
    expect(
      store.audits.filter((row) => row.action === "workforce.employee_document.updated"),
    ).toHaveLength(0);
  });

  it("re-validates a supplied field and keeps the window coherent", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const document = await createDocument(store, fixture, employee, {
      issuedAt: "2025-01-01",
      expiresAt: "2026-01-01",
    });

    await expect(updateDocument(store, fixture, document, { kind: "passport" })).rejects.toThrow(
      /kind must be one of/,
    );
    await expect(updateDocument(store, fixture, document, { title: "  " })).rejects.toThrow(
      /title is required/,
    );
    // Moving only the expires side must still respect the stored issued date.
    await expect(
      updateDocument(store, fixture, document, { expiresAt: "2024-12-31" }),
    ).rejects.toThrow(/expiresAt must not precede issuedAt/);
    // Moving only the issued side must still respect the stored expiry date.
    await expect(
      updateDocument(store, fixture, document, { issuedAt: "2026-06-01" }),
    ).rejects.toThrow(/expiresAt must not precede issuedAt/);

    expect(store.employeeDocuments.get(document.id)).toMatchObject({
      kind: "contract",
      title: "Permanent contract",
      issuedAt: "2025-01-01",
      expiresAt: "2026-01-01",
    });
  });

  it("reports an unknown or cross-organization document as NotFoundError", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const otherEmployee = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });
    const otherDocument = await createDocument(store, fixture, otherEmployee, {
      organizationId: fixture.otherOrganizationId,
    });

    await expect(
      updateEmployeeDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeDocumentId: "missing",
        title: "Ghost",
      }),
    ).rejects.toThrow(NotFoundError);
    // The org filter is load-bearing: dropping it would edit the other row.
    await expect(
      updateEmployeeDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        employeeDocumentId: otherDocument.id,
        title: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.employeeDocuments.get(otherDocument.id)?.title).toBe("Permanent contract");
    expect(employee.id).not.toBe(otherEmployee.id);
  });
});

describe("findEmployeeDocument and listEmployeeDocuments", () => {
  it("finds a document for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const document = await createDocument(store, fixture, employee);
    const otherEmployee = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });
    const otherDocument = await createDocument(store, fixture, otherEmployee, {
      organizationId: fixture.otherOrganizationId,
    });

    expect(
      (
        await findEmployeeDocument(store, {
          organizationId: fixture.organizationId,
          employeeDocumentId: document.id,
        })
      )?.id,
    ).toBe(document.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findEmployeeDocument(store, {
        organizationId: fixture.organizationId,
        employeeDocumentId: otherDocument.id,
      }),
    ).toBeUndefined();
    expect(
      await findEmployeeDocument(store, {
        organizationId: fixture.organizationId,
        employeeDocumentId: "missing",
      }),
    ).toBeUndefined();
  });

  it("returns nothing for an organization that holds no documents", async () => {
    const { store, fixture } = setup();
    const otherEmployee = await register(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });
    await createDocument(store, fixture, otherEmployee, {
      organizationId: fixture.otherOrganizationId,
    });

    expect(await listEmployeeDocuments(store, { organizationId: fixture.organizationId })).toEqual(
      [],
    );
  });

  it("caps a direct document store read at the default limit when the caller omits one", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    for (let index = 0; index < DEFAULT_EMPLOYEE_DOCUMENT_LIMIT + 2; index += 1) {
      await createDocument(store, fixture, employee, {
        title: `Doc ${String(index).padStart(3, "0")}`,
      });
    }

    // The fake mirrors the document command: an omitted `limit` is bounded.
    expect(
      await store.listEmployeeDocuments({ organizationId: fixture.organizationId }),
    ).toHaveLength(DEFAULT_EMPLOYEE_DOCUMENT_LIMIT);
  });

  it("orders by title and applies the employee, kind and paging filters", async () => {
    const { store, fixture } = setup();
    const employee = await register(store, fixture);
    const otherEmployee = await register(store, fixture, { name: "Zara" });
    await createDocument(store, fixture, employee, { title: "Contract", kind: "contract" });
    await createDocument(store, fixture, employee, { title: "Diploma", kind: "certificate" });
    await createDocument(store, fixture, otherEmployee, { title: "Passport", kind: "id_document" });

    expect(
      (await listEmployeeDocuments(store, { organizationId: fixture.organizationId })).map(
        (d) => d.title,
      ),
    ).toEqual(["Contract", "Diploma", "Passport"]);
    expect(
      (
        await listEmployeeDocuments(store, {
          organizationId: fixture.organizationId,
          employeeId: employee.id,
        })
      ).map((d) => d.title),
    ).toEqual(["Contract", "Diploma"]);
    expect(
      (
        await listEmployeeDocuments(store, {
          organizationId: fixture.organizationId,
          kind: "certificate",
        })
      ).map((d) => d.title),
    ).toEqual(["Diploma"]);
    expect(
      await listEmployeeDocuments(store, {
        organizationId: fixture.organizationId,
        limit: DEFAULT_EMPLOYEE_DOCUMENT_LIMIT,
        offset: 1,
      }),
    ).toHaveLength(2);
  });
});
