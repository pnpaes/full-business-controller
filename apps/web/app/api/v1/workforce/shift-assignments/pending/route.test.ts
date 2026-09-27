import type { PendingSelfAssignmentRow, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    listPendingSelfAssignments: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  getAuthStore: vi.fn(() => ({})),
  requireSession: vi.fn(),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";

function pendingRow(overrides: Partial<PendingSelfAssignmentRow> = {}): PendingSelfAssignmentRow {
  return {
    assignmentId: ASSIGNMENT_ID,
    assignedAt: "2026-02-02T08:00:00.000Z",
    employeeId: EMPLOYEE_ID,
    employeeName: "Nora Nordmann",
    shiftId: SHIFT_ID,
    locationId: LOCATION,
    roleCode: "barista",
    startsAt: "2026-03-01T09:00:00.000Z",
    endsAt: "2026-03-01T17:00:00.000Z",
    breakMinutes: 30,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function request(query = ""): Request {
  return new Request(`http://localhost/api/v1/workforce/shift-assignments/pending${query}`);
}

describe("GET /api/v1/workforce/shift-assignments/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
    vi.mocked(application.listPendingSelfAssignments).mockResolvedValue([pendingRow()]);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  });

  it("returns the pending self-assignment queue", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(application.listPendingSelfAssignments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      rows: [{ assignmentId: ASSIGNMENT_ID, employeeId: EMPLOYEE_ID, shiftId: SHIFT_ID }],
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to read the queue",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(request());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not review assignments",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(request());

      expect(response.status).toBe(403);
      expect(application.listPendingSelfAssignments).not.toHaveBeenCalled();
    },
  );

  it("filters a location-scoped caller to their own locations", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listPendingSelfAssignments).mockResolvedValue([
      pendingRow(),
      pendingRow({
        assignmentId: "77777777-7777-4777-8777-777777777777",
        locationId: OTHER_LOCATION,
      }),
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ assignmentId: ASSIGNMENT_ID, locationId: LOCATION }],
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(application.listPendingSelfAssignments).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed paging", async () => {
    const response = await GET(request("?limit=999999"));

    expect(response.status).toBe(400);
    expect(application.listPendingSelfAssignments).not.toHaveBeenCalled();
  });
});
