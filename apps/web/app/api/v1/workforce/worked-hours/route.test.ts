import type { UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    // The application slice is authored in parallel; pin the page default the
    // shared row module reads so this suite does not depend on its arrival.
    DEFAULT_SHIFT_ADJUSTMENT_LIMIT: 50,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    computeWorkedHours: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";
import { parseWorkedHoursQuery } from "../workforce-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-03-08T00:00:00.000Z";
const PATH = "/api/v1/workforce/worked-hours";
const QUERY = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

function report(
  overrides: Partial<Awaited<ReturnType<typeof application.computeWorkedHours>>> = {},
) {
  return {
    from: FROM,
    to: TO,
    rows: [
      {
        employeeId: EMPLOYEE_ID,
        employeeName: "Ada Cook",
        roleCode: "line_cook",
        hours: "37.50",
      },
    ],
    totalHours: "37.50",
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = QUERY): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.computeWorkedHours).mockResolvedValue(report() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/workforce/worked-hours", () => {
  it("returns the derived report for the period", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.computeWorkedHours).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, from: FROM, to: TO }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      from: FROM,
      to: TO,
      rows: [
        {
          employeeId: EMPLOYEE_ID,
          employeeName: "Ada Cook",
          roleCode: "line_cook",
          hours: "37.50",
        },
      ],
      totalHours: "37.50",
    });
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin"])(
    "allows %s to read the report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read payroll-input data",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.computeWorkedHours).not.toHaveBeenCalled();
    },
  );

  it("passes the optional locationId and employeeId filters through for an unscoped caller", async () => {
    const response = await GET(
      getRequest(`${QUERY}&locationId=${LOCATION}&employeeId=${EMPLOYEE_ID}`),
    );

    expect(response.status).toBe(200);
    expect(application.computeWorkedHours).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: LOCATION, employeeId: EMPLOYEE_ID }),
    );
  });

  it("denies a scoped caller an explicit out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.computeWorkedHours).not.toHaveBeenCalled();
  });

  it("pins a single-location caller to their location when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.computeWorkedHours).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: LOCATION }),
    );
  });

  it("requires a locationId from a multi-location caller with no filter", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "locationId is required for a multi-location caller",
    });
    expect(application.computeWorkedHours).not.toHaveBeenCalled();
  });

  it("allows a multi-location caller an in-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.computeWorkedHours).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: OTHER_LOCATION }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.computeWorkedHours).not.toHaveBeenCalled();
  });

  it.each([
    `?to=${encodeURIComponent(TO)}`,
    `?from=${encodeURIComponent(FROM)}`,
    `?from=2026-03-01T00:00:00&to=${encodeURIComponent(TO)}`,
    `?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`,
    `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(FROM)}`,
    `${QUERY}&locationId=not-a-uuid`,
    `${QUERY}&employeeId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.computeWorkedHours).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.computeWorkedHours).mockRejectedValue(
      new DomainError("worked-hours period is too long"),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "worked-hours period is too long" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.computeWorkedHours).mockRejectedValue(
      new NotFoundError("employee not found in organization"),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(404);
  });
});

describe("parseWorkedHoursQuery", () => {
  it("parses the required period and optional UUID filters", () => {
    const parsed = parseWorkedHoursQuery(
      new URLSearchParams({ from: FROM, to: TO, locationId: LOCATION, employeeId: EMPLOYEE_ID }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      from: FROM,
      to: TO,
      locationId: LOCATION,
      employeeId: EMPLOYEE_ID,
    });
  });

  it.each([
    new URLSearchParams({ to: TO }),
    new URLSearchParams({ from: FROM }),
    new URLSearchParams({ from: "2026-03-01T00:00:00", to: TO }),
    new URLSearchParams({ from: TO, to: FROM }),
    new URLSearchParams({ from: FROM, to: FROM }),
    new URLSearchParams({ from: FROM, to: TO, locationId: "nope" }),
    new URLSearchParams({ from: FROM, to: TO, employeeId: "nope" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseWorkedHoursQuery(searchParams).ok).toBe(false);
  });
});
