import type { EmployeeRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    listEmployees: vi.fn(),
    registerEmployee: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../lib/auth";
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";

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
    retiredAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/workforce/employees${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/workforce/employees", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Ana Silva",
  roleCode: "line_cook",
  employmentType: "full_time",
  baseHourlyRate: "12.5000",
  primaryLocationId: LOCATION,
  activeFrom: "2026-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.listEmployees).mockResolvedValue([]);
  vi.mocked(application.registerEmployee).mockResolvedValue(employeeRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/employees", () => {
  it("lists the organization's employees", async () => {
    vi.mocked(application.listEmployees).mockResolvedValue([employeeRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: EMPLOYEE_ID,
          userId: null,
          name: "Ana Silva",
          roleCode: "line_cook",
          employmentType: "full_time",
          baseHourlyRate: "12.5000",
          costCenterId: null,
          primaryLocationId: LOCATION,
          activeFrom: "2026-01-01",
          activeTo: null,
          retiredAt: null,
          createdAt: "2026-01-01T08:00:00.000Z",
          createdBy: USER,
        },
      ],
    });
    expect(application.listEmployees).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the location, active and retired filters through", async () => {
    const response = await GET(
      getRequest(`?primaryLocationId=${LOCATION}&active=true&retired=false&limit=10`),
    );

    expect(response.status).toBe(200);
    expect(application.listEmployees).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        primaryLocationId: LOCATION,
        active: true,
        retired: false,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("restricts a single-location caller and hides NULL-primary-location rows", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listEmployees).mockResolvedValue([
      employeeRecord(),
      employeeRecord({ id: "row-2", primaryLocationId: OTHER_LOCATION }),
      employeeRecord({ id: "row-3", primaryLocationId: null }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listEmployees).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, primaryLocationId: LOCATION }),
    );
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ primaryLocationId: LOCATION }],
    });
  });

  it("denies an explicit filter outside the caller's location scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?primaryLocationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listEmployees).not.toHaveBeenCalled();
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin"])(
    "allows %s to read the register",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(application.listEmployees).toHaveBeenCalled();
    },
  );

  it.each(["analyst", "kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which has no employee access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listEmployees).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listEmployees).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?primaryLocationId=nope"));

    expect(response.status).toBe(400);
    expect(application.listEmployees).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listEmployees).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/workforce/employees", () => {
  it("registers an employee for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerEmployee).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        name: "Ana Silva",
        roleCode: "line_cook",
        employmentType: "full_time",
        baseHourlyRate: "12.5000",
        primaryLocationId: LOCATION,
        activeFrom: "2026-01-01",
        activeTo: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      employeeId: EMPLOYEE_ID,
    });
  });

  it("allows finance to create an employee", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerEmployee).toHaveBeenCalled();
  });

  it.each(["analyst", "kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which may not write an employee",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(403);
      expect(application.registerEmployee).not.toHaveBeenCalled();
    },
  );

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerEmployee).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("denies a scoped caller an employee with no primary location (fail-closed)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    const withoutLocation = {
      name: validBody.name,
      roleCode: validBody.roleCode,
      employmentType: validBody.employmentType,
      baseHourlyRate: validBody.baseHourlyRate,
      activeFrom: validBody.activeFrom,
    };

    const response = await POST(postRequest(withoutLocation));

    expect(response.status).toBe(403);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad employmentType", async () => {
    const response = await POST(postRequest({ ...validBody, employmentType: "freelance" }));

    expect(response.status).toBe(400);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 for a float baseHourlyRate", async () => {
    const response = await POST(postRequest({ ...validBody, baseHourlyRate: 12.5 }));

    expect(response.status).toBe(400);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 for a 5-decimal baseHourlyRate", async () => {
    const response = await POST(postRequest({ ...validBody, baseHourlyRate: "12.50000" }));

    expect(response.status).toBe(400);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 when activeTo is not after activeFrom", async () => {
    const response = await POST(
      postRequest({ ...validBody, activeFrom: "2026-02-01", activeTo: "2026-01-01" }),
    );

    expect(response.status).toBe(400);
    expect(application.registerEmployee).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.registerEmployee).mockRejectedValue(
      new DomainError("employmentType must be one of full_time, part_time"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "employmentType must be one of full_time, part_time",
    });
  });
});
