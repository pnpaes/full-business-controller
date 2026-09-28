import type { MyShiftRow, SchedulingEmployeeRecord } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findSelfEmployee: vi.fn(),
    listMyShifts: vi.fn(),
    listAvailableShifts: vi.fn(),
  };
});

vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";

function employee(): SchedulingEmployeeRecord {
  return {
    id: EMPLOYEE_ID,
    organizationId: ORG,
    userId: USER,
    primaryLocationId: LOCATION,
    roleCode: "barista",
    name: "Nora",
    baseHourlyRate: "215.5000",
  };
}

function myShiftRow(): MyShiftRow {
  return {
    assignmentId: ASSIGNMENT_ID,
    assignmentState: "pending_approval",
    assignedAt: "2026-02-02T08:00:00.000Z",
    shiftId: SHIFT_ID,
    locationId: LOCATION,
    roleCode: "barista",
    positionId: null,
    positionName: null,
    startsAt: "2026-03-01T09:00:00.000Z",
    endsAt: "2026-03-01T17:00:00.000Z",
    breakMinutes: 30,
    shiftState: "open",
  };
}

describe("GET /api/v1/workforce/my-shifts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
    vi.mocked(application.findSelfEmployee).mockResolvedValue(employee());
    vi.mocked(application.listMyShifts).mockResolvedValue([myShiftRow()]);
    vi.mocked(application.listAvailableShifts).mockResolvedValue([]);
    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  });

  it("returns the linked employee's own shifts", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(application.listMyShifts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorUserId: USER }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      rows: [
        { assignmentId: ASSIGNMENT_ID, assignmentState: "pending_approval", shiftId: SHIFT_ID },
      ],
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(application.listMyShifts).not.toHaveBeenCalled();
  });

  it("returns 403 when the account has no employee link", async () => {
    vi.mocked(application.findSelfEmployee).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listMyShifts).not.toHaveBeenCalled();
  });
});
