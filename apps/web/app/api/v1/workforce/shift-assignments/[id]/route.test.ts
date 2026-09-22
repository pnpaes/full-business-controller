import type { ShiftAssignmentRecord, ShiftRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findShiftAssignment: vi.fn(),
    findShift: vi.fn(),
    withdrawShiftAssignment: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../lib/errors";
import { getServerSession } from "../../../../../../lib/server-session";

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNED_AT = "2026-02-02T08:00:00.000Z";
const PATH = `/api/v1/workforce/shift-assignments/${ASSIGNMENT_ID}`;

function assignmentRecord(overrides: Partial<ShiftAssignmentRecord> = {}): ShiftAssignmentRecord {
  return {
    id: ASSIGNMENT_ID,
    organizationId: ORG,
    shiftId: SHIFT_ID,
    employeeId: EMPLOYEE_ID,
    state: "approved",
    assignedBy: USER,
    assignedAt: ASSIGNED_AT,
    createdAt: ASSIGNED_AT,
    updatedAt: null,
    ...overrides,
  };
}

function shiftRecord(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: SHIFT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    roleCode: "line_cook",
    startsAt: "2026-03-01T09:00:00.000Z",
    endsAt: "2026-03-01T17:00:00.000Z",
    breakMinutes: 30,
    state: "assigned",
    publishedAt: "2026-02-02T07:00:00.000Z",
    actualStart: null,
    actualEnd: null,
    createdAt: "2026-02-01T08:00:00.000Z",
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

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.findShiftAssignment).mockResolvedValue(assignmentRecord());
  vi.mocked(application.findShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.withdrawShiftAssignment).mockResolvedValue(
    assignmentRecord({ state: "withdrawn" }),
  );
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/shift-assignments/[id]", () => {
  it("returns one assignment", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findShiftAssignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, shiftAssignmentId: ASSIGNMENT_ID }),
    );
    expect(application.findShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, shiftId: SHIFT_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      shiftAssignment: {
        id: ASSIGNMENT_ID,
        shiftId: SHIFT_ID,
        employeeId: EMPLOYEE_ID,
        state: "approved",
        assignedBy: USER,
        assignedAt: ASSIGNED_AT,
        createdAt: ASSIGNED_AT,
        updatedAt: null,
      },
    });
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "front_of_house",
    "finance",
    "admin",
  ])("allows %s to read one assignment", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
  });

  it.each(["analyst", "purchasing"])(
    "returns 403 for %s, which has no shift access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(application.findShiftAssignment).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an assignment on a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
  });

  it("returns 404 for an unknown assignment", async () => {
    vi.mocked(application.findShiftAssignment).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.findShift).not.toHaveBeenCalled();
  });

  it("returns 404 when the assignment's shift is missing", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findShiftAssignment).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/workforce/shift-assignments/[id]", () => {
  it("withdraws the assignment for the session actor", async () => {
    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(200);
    expect(application.withdrawShiftAssignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        shiftAssignmentId: ASSIGNMENT_ID,
        actorId: USER,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shiftAssignment: { id: ASSIGNMENT_ID, state: "withdrawn" },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to withdraw an assignment",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

      expect(response.status).toBe(200);
      expect(application.withdrawShiftAssignment).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not withdraw an assignment",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

      expect(response.status).toBe(403);
      expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an assignment on a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(403);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it.each(["approved", "withdrawn ", "cancelled", ""])(
    "returns 400 for the state %j, which is not the withdraw transition",
    async (state) => {
      const response = await PATCH(patchRequest({ state }), context());

      expect(response.status).toBe(400);
      expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a missing state", async () => {
    const response = await PATCH(patchRequest({}), context());

    expect(response.status).toBe(400);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown assignment", async () => {
    vi.mocked(application.findShiftAssignment).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(404);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 404 when the assignment's shift is missing", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(404);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ state: "withdrawn" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(401);
    expect(application.withdrawShiftAssignment).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.withdrawShiftAssignment).mockRejectedValue(
      new DomainError("shift assignment in state withdrawn cannot be withdrawn"),
    );

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "shift assignment in state withdrawn cannot be withdrawn",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.withdrawShiftAssignment).mockRejectedValue(
      new NotFoundError("shift assignment not found in organization"),
    );

    const response = await PATCH(patchRequest({ state: "withdrawn" }), context());

    expect(response.status).toBe(404);
  });
});
