import type { EmployeeRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    findEmployee: vi.fn(),
    retireEmployee: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const RETIRED_AT = "2026-03-01T09:00:00.000Z";
const PATH = `/api/v1/workforce/employees/${EMPLOYEE_ID}/retire`;

function employeeRecord(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id: EMPLOYEE_ID,
    organizationId: ORG,
    userId: null,
    name: "Ana Silva",
    roleCode: "line_cook",
    employmentType: "full_time",
    baseHourlyRate: "12.5000",
    costCenterId: null,
    primaryLocationId: LOCATION,
    activeFrom: "2026-01-01",
    activeTo: null,
    retiredAt: RETIRED_AT,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = EMPLOYEE_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function retireRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.findEmployee).mockResolvedValue(employeeRecord({ retiredAt: null }));
  vi.mocked(application.retireEmployee).mockResolvedValue(employeeRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/workforce/employees/[id]/retire", () => {
  it("retires the employee for the session actor and served organization", async () => {
    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(200);
    expect(application.retireEmployee).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        employeeId: EMPLOYEE_ID,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      employeeId: EMPLOYEE_ID,
      retiredAt: RETIRED_AT,
    });
  });

  it("allows finance to retire an employee", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(200);
    expect(application.retireEmployee).toHaveBeenCalled();
  });

  it.each(["analyst", "kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which may not retire an employee",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(retireRequest(), context());

      expect(response.status).toBe(403);
      expect(application.retireEmployee).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an employee at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEmployee).mockResolvedValue(
      employeeRecord({ primaryLocationId: OTHER_LOCATION }),
    );

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(403);
    expect(application.retireEmployee).not.toHaveBeenCalled();
  });

  it("denies a scoped caller an employee with a NULL primary location (fail-closed)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEmployee).mockResolvedValue(
      employeeRecord({ primaryLocationId: null }),
    );

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(403);
    expect(application.retireEmployee).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown employee", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEmployee).mockResolvedValue(undefined);

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(404);
    expect(application.retireEmployee).not.toHaveBeenCalled();
  });

  it("maps a typed NotFoundError from the command to 404", async () => {
    vi.mocked(application.retireEmployee).mockRejectedValue(
      new NotFoundError("employee not found in organization"),
    );

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(retireRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.retireEmployee).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.retireEmployee).mockRejectedValue(
      new DomainError("employeeId is required"),
    );

    const response = await POST(retireRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "employeeId is required" });
  });
});
