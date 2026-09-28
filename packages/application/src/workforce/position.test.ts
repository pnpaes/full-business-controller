import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { findPosition } from "./find-position";
import { listPositions } from "./list-positions";
import { registerEmployee } from "./register-employee";
import { registerPosition } from "./register-position";
import type { RegisterPositionInput } from "./register-position";
import { FakeWorkforceStore, seedWorkforceFixture, type WorkforceFixture } from "./test-support";
import type { EmployeeRecord } from "./types";
import { updateEmployee } from "./update-employee";
import { updatePosition } from "./update-position";

function setup(): { store: FakeWorkforceStore; fixture: WorkforceFixture } {
  const store = new FakeWorkforceStore();
  return { store, fixture: seedWorkforceFixture() };
}

function createPosition(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  overrides: Partial<RegisterPositionInput> = {},
) {
  return registerPosition(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    code: "barista",
    name: "Barista",
    activeFrom: "2026-01-01",
    ...overrides,
  });
}

function registerEmployeeWithPositions(
  store: FakeWorkforceStore,
  fixture: WorkforceFixture,
  positionIds: readonly string[],
  roleCode = "front_of_house",
): Promise<EmployeeRecord> {
  return registerEmployee(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    name: "Nora Nordmann",
    roleCode,
    employmentType: "part_time",
    baseHourlyRate: "215.5000",
    activeFrom: "2026-01-01",
    positionIds,
  });
}

describe("registerPosition", () => {
  it("registers a position, lower-cases its code and writes its audit fact", async () => {
    const { store, fixture } = setup();

    const position = await createPosition(store, fixture, { code: "  BARISTA  " });

    expect(position).toMatchObject({
      organizationId: fixture.organizationId,
      code: "barista",
      name: "Barista",
      activeFrom: "2026-01-01",
      activeTo: null,
      createdBy: fixture.actorId,
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "workforce.position.created",
      entityType: "position",
      entityId: position.id,
      after: { code: "barista", name: "Barista" },
    });
  });

  it("rejects a duplicate code within the organization, case-insensitively", async () => {
    const { store, fixture } = setup();
    await createPosition(store, fixture, { code: "barista" });

    await expect(createPosition(store, fixture, { code: "Barista" })).rejects.toThrow(
      new DomainError("position code barista already exists in the organization"),
    );
    expect(store.positions.size).toBe(1);
  });

  it("allows the same code in another organization", async () => {
    const { store, fixture } = setup();
    await createPosition(store, fixture, { code: "barista" });

    const other = await registerPosition(store, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.actorId,
      code: "barista",
      name: "Barista",
      activeFrom: "2026-01-01",
    });

    expect(other.organizationId).toBe(fixture.otherOrganizationId);
  });

  it("rejects a blank code, a blank name or a non-increasing window", async () => {
    const { store, fixture } = setup();

    await expect(createPosition(store, fixture, { code: "  " })).rejects.toThrow(
      /code is required/,
    );
    await expect(createPosition(store, fixture, { name: "  " })).rejects.toThrow(
      /name is required/,
    );
    await expect(
      createPosition(store, fixture, { activeFrom: "2026-06-01", activeTo: "2026-06-01" }),
    ).rejects.toThrow(/activeTo must be after activeFrom/);
    await expect(createPosition(store, fixture, { activeFrom: "2026-13-01" })).rejects.toThrow(
      DomainError,
    );
    expect(store.positions.size).toBe(0);
  });
});

describe("updatePosition", () => {
  it("renames and re-codes a position, recording the before/after", async () => {
    const { store, fixture } = setup();
    const position = await createPosition(store, fixture);

    const updated = await updatePosition(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      positionId: position.id,
      code: "senior_barista",
      name: "Senior barista",
    });

    expect(updated).toMatchObject({ code: "senior_barista", name: "Senior barista" });
    expect(store.audits.at(-1)).toMatchObject({
      action: "workforce.position.updated",
      before: { code: "barista", name: "Barista" },
      after: { code: "senior_barista", name: "Senior barista" },
    });
  });

  it("deactivates by setting activeTo (there is no delete)", async () => {
    const { store, fixture } = setup();
    const position = await createPosition(store, fixture);

    const deactivated = await updatePosition(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      positionId: position.id,
      activeTo: "2026-06-30",
    });

    expect(deactivated?.activeTo).toBe("2026-06-30");
    expect(store.positions.size).toBe(1);
    // Active filter now excludes it; the inactive filter includes it.
    expect(
      await listPositions(store, { organizationId: fixture.organizationId, active: true }),
    ).toEqual([]);
    expect(
      (await listPositions(store, { organizationId: fixture.organizationId, active: false })).map(
        (row) => row.id,
      ),
    ).toEqual([position.id]);
  });

  it("rejects re-coding onto another position's code", async () => {
    const { store, fixture } = setup();
    const first = await createPosition(store, fixture, { code: "barista" });
    await createPosition(store, fixture, { code: "cook", name: "Cook" });

    await expect(
      updatePosition(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        positionId: first.id,
        code: "cook",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an empty patch and reports a scoped miss as NotFoundError", async () => {
    const { store, fixture } = setup();
    const position = await createPosition(store, fixture);

    await expect(
      updatePosition(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        positionId: position.id,
      }),
    ).rejects.toThrow(/no updatable fields/);
    await expect(
      updatePosition(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        positionId: position.id,
        name: "Nope",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("findPosition and listPositions", () => {
  it("is organization-scoped", async () => {
    const { store, fixture } = setup();
    const position = await createPosition(store, fixture);

    expect(
      await findPosition(store, {
        organizationId: fixture.organizationId,
        positionId: position.id,
      }),
    ).toMatchObject({ id: position.id });
    expect(
      await findPosition(store, {
        organizationId: fixture.otherOrganizationId,
        positionId: position.id,
      }),
    ).toBeUndefined();
  });

  it("orders by name and caps the page at the default limit", async () => {
    const { store, fixture } = setup();
    await createPosition(store, fixture, { code: "cook", name: "Cook" });
    await createPosition(store, fixture, { code: "barista", name: "Barista" });

    const rows = await listPositions(store, { organizationId: fixture.organizationId });

    expect(rows.map((row) => row.name)).toEqual(["Barista", "Cook"]);
  });
});

describe("employee positions", () => {
  it("sets the initial position set, deduped", async () => {
    const { store, fixture } = setup();
    const barista = await createPosition(store, fixture, { code: "barista", name: "Barista" });
    const cook = await createPosition(store, fixture, { code: "cook", name: "Cook" });

    const employee = await registerEmployeeWithPositions(store, fixture, [
      barista.id,
      cook.id,
      barista.id,
    ]);

    expect(employee.positionIds).toEqual([barista.id, cook.id]);
  });

  it("rejects an unknown position id", async () => {
    const { store, fixture } = setup();

    await expect(
      registerEmployeeWithPositions(store, fixture, ["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toThrow(/not found in organization/);
    expect(store.employees.size).toBe(0);
  });

  it("rejects a role that is not one of the organization's roles", async () => {
    const { store, fixture } = setup();

    await expect(registerEmployeeWithPositions(store, fixture, [], "head_chef")).rejects.toThrow(
      /not one of the organization's roles/,
    );
  });

  it("replaces the whole set on update and clears it with an empty array", async () => {
    const { store, fixture } = setup();
    const barista = await createPosition(store, fixture, { code: "barista", name: "Barista" });
    const cook = await createPosition(store, fixture, { code: "cook", name: "Cook" });
    const employee = await registerEmployeeWithPositions(store, fixture, [barista.id]);

    const replaced = await updateEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: employee.id,
      positionIds: [cook.id],
    });
    expect(replaced.positionIds).toEqual([cook.id]);
    expect(store.audits.at(-1)).toMatchObject({
      after: { position_ids: [cook.id] },
    });

    const cleared = await updateEmployee(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      employeeId: employee.id,
      positionIds: [],
    });
    expect(cleared.positionIds).toEqual([]);
  });
});
