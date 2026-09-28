import type { ShiftAssignmentRecord, ShiftRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findShift: vi.fn(),
    findShiftAssignment: vi.fn(),
    decideSelfAssignment: vi.fn(),
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

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNED_AT = "2026-02-02T08:00:00.000Z";
const PATH = `/api/v1/workforce/shift-assignments/${ASSIGNMENT_ID}/decide`;

function shiftRecord(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: SHIFT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    roleCode: "barista",
    positionId: null,
    startsAt: "2026-03-01T09:00:00.000Z",
    endsAt: "2026-03-01T17:00:00.000Z",
    breakMinutes: 30,
    state: "open",
    publishedAt: null,
    actualStart: null,
    actualEnd: null,
    createdAt: "2026-02-01T08:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function assignmentRecord(overrides: Partial<ShiftAssignmentRecord> = {}): ShiftAssignmentRecord {
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

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = ASSIGNMENT_ID): {
  readonly params: Promise<{ readonly id: string }>;
} {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/workforce/shift-assignments/[id]/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
    vi.mocked(application.findShiftAssignment).mockResolvedValue(assignmentRecord());
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord());
    vi.mocked(application.decideSelfAssignment).mockResolvedValue(
      assignmentRecord({ state: "approved", assignedBy: USER }),
    );
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    vi.mocked(requireSession).mockResolvedValue({
      session: { userId: USER },
      token: "token",
    } as never);
  });

  it("approves a pending self-assignment for the session manager", async () => {
    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(200);
    expect(application.decideSelfAssignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        assignmentId: ASSIGNMENT_ID,
        decision: "approved",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shiftAssignment: { id: ASSIGNMENT_ID, state: "approved" },
    });
  });

  it("passes the rejection reason through", async () => {
    vi.mocked(application.decideSelfAssignment).mockResolvedValue(
      assignmentRecord({ state: "rejected" }),
    );

    const response = await POST(
      postRequest({ decision: "rejected", reason: "Already covered" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(application.decideSelfAssignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "rejected", reason: "Already covered" }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to decide",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ decision: "approved" }), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not decide an assignment",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ decision: "approved" }), context());

      expect(response.status).toBe(403);
      expect(application.decideSelfAssignment).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller the shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(403);
    expect(application.decideSelfAssignment).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown assignment", async () => {
    vi.mocked(application.findShiftAssignment).mockResolvedValue(undefined);

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(404);
    expect(application.decideSelfAssignment).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing shift", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(404);
    expect(application.decideSelfAssignment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id and a malformed decision", async () => {
    const badId = await POST(postRequest({ decision: "approved" }), context("not-a-uuid"));
    expect(badId.status).toBe(400);

    const badBody = await POST(postRequest({ decision: "maybe" }), context());
    expect(badBody.status).toBe(400);

    const missing = await POST(postRequest({}), context());
    expect(missing.status).toBe(400);

    expect(application.decideSelfAssignment).not.toHaveBeenCalled();
  });

  it("maps the missing-reason DomainError to 400 with its message", async () => {
    vi.mocked(application.decideSelfAssignment).mockRejectedValue(
      new DomainError("reason is required to reject a self-assignment"),
    );

    const response = await POST(postRequest({ decision: "rejected" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "reason is required to reject a self-assignment",
    });
  });

  it("maps a wrong-state DomainError to 400", async () => {
    vi.mocked(application.decideSelfAssignment).mockRejectedValue(
      new DomainError("shift assignment in state approved cannot be decided"),
    );

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(400);
  });

  it("maps a NotFoundError to 404", async () => {
    vi.mocked(application.decideSelfAssignment).mockRejectedValue(
      new NotFoundError("shift assignment not found in organization"),
    );

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ decision: "approved" }), context());

    expect(response.status).toBe(401);
    expect(application.decideSelfAssignment).not.toHaveBeenCalled();
  });
});
