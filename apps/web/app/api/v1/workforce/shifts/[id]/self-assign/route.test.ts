import type { SchedulingEmployeeRecord, ShiftAssignmentRecord } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findSelfEmployee: vi.fn(),
    selfAssignShift: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/config", () => ({
  getConfig: vi.fn(() => ({ SELF_ASSIGN_WEEKLY_LIMIT: 2 })),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNED_AT = "2026-02-02T08:00:00.000Z";
const PATH = `/api/v1/workforce/shifts/${SHIFT_ID}/self-assign`;

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

function assignment(overrides: Partial<ShiftAssignmentRecord> = {}): ShiftAssignmentRecord {
  return {
    id: ASSIGNMENT_ID,
    organizationId: ORG,
    shiftId: SHIFT_ID,
    employeeId: EMPLOYEE_ID,
    state: "pending_approval",
    assignedBy: null,
    assignedAt: ASSIGNED_AT,
    createdAt: ASSIGNED_AT,
    updatedAt: null,
    ...overrides,
  };
}

function context(id: string = SHIFT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function request(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/v1/workforce/shifts/[id]/self-assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
    vi.mocked(application.findSelfEmployee).mockResolvedValue(employee());
    vi.mocked(application.selfAssignShift).mockResolvedValue(assignment());
    vi.mocked(requireSession).mockResolvedValue({
      session: { userId: USER },
      token: "token",
    } as never);
  });

  it("records a pending self-assignment for the linked employee", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(application.selfAssignShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorUserId: USER,
        shiftId: SHIFT_ID,
        weeklyLimit: 2,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shiftAssignment: { id: ASSIGNMENT_ID, state: "pending_approval", assignedBy: null },
    });
  });

  it("refuses an account with no linked employee row (403) and never calls the command", async () => {
    vi.mocked(application.findSelfEmployee).mockResolvedValue(undefined);

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(application.selfAssignShift).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    expect(application.selfAssignShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.selfAssignShift).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.selfAssignShift).mockRejectedValue(
      new DomainError("weekly self-assignment limit of 2 reached"),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "weekly self-assignment limit of 2 reached",
    });
  });

  it("maps a missing shift to 404", async () => {
    vi.mocked(application.selfAssignShift).mockRejectedValue(
      new NotFoundError("shift not found in organization"),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
  });
});
