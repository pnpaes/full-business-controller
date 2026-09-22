import type {
  ShiftAdjustmentRecord,
  ShiftAssignmentRecord,
  ShiftRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    // The application slice is authored in parallel; pin the page default the
    // parser reads so this suite does not depend on its arrival.
    DEFAULT_SHIFT_ADJUSTMENT_LIMIT: 50,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findShiftAssignment: vi.fn(),
    findShift: vi.fn(),
    listShiftAdjustments: vi.fn(),
    createShiftAdjustment: vi.fn(),
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
import { AuthHttpError } from "../../../../../../../lib/errors";
import { getServerSession } from "../../../../../../../lib/server-session";
import {
  parseCreateShiftAdjustmentBody,
  parseShiftAdjustmentListQuery,
} from "../../../workforce-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ADJUSTMENT_ID = "77777777-7777-4777-8777-777777777777";
const ASSIGNED_AT = "2026-02-02T08:00:00.000Z";
const PATH = `/api/v1/workforce/shift-assignments/${ASSIGNMENT_ID}/adjustments`;

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

function adjustmentRecord(overrides: Partial<ShiftAdjustmentRecord> = {}): ShiftAdjustmentRecord {
  return {
    id: ADJUSTMENT_ID,
    organizationId: ORG,
    shiftAssignmentId: ASSIGNMENT_ID,
    adjustedHours: "8.50",
    reason: "late clock-out correction",
    approvedBy: null,
    approvedAt: null,
    createdAt: ASSIGNED_AT,
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

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.findShiftAssignment).mockResolvedValue(assignmentRecord());
  vi.mocked(application.findShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.listShiftAdjustments).mockResolvedValue([]);
  vi.mocked(application.createShiftAdjustment).mockResolvedValue(adjustmentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/shift-assignments/[id]/adjustments", () => {
  it("lists the assignment's adjustments", async () => {
    vi.mocked(application.listShiftAdjustments).mockResolvedValue([adjustmentRecord()]);

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
    expect(application.listShiftAdjustments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        shiftAssignmentId: ASSIGNMENT_ID,
        limit: 50,
        offset: 0,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: ADJUSTMENT_ID,
          shiftAssignmentId: ASSIGNMENT_ID,
          adjustedHours: "8.50",
          reason: "late clock-out correction",
          approvedBy: null,
          approvedAt: null,
          createdAt: ASSIGNED_AT,
        },
      ],
    });
  });

  it("passes the paging through", async () => {
    const response = await GET(getRequest("?limit=5&offset=10"), context());

    expect(response.status).toBe(200);
    expect(application.listShiftAdjustments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5, offset: 10 }),
    );
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "front_of_house",
    "finance",
    "admin",
  ])("allows %s to read the adjustments", async (role) => {
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
      expect(application.listShiftAdjustments).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an assignment on a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listShiftAdjustments).not.toHaveBeenCalled();
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
    expect(application.listShiftAdjustments).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listShiftAdjustments).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findShiftAssignment).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"), context());

    expect(response.status).toBe(400);
    expect(application.findShiftAssignment).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/workforce/shift-assignments/[id]/adjustments", () => {
  it("records the adjustment for the session actor", async () => {
    const response = await POST(
      postRequest({ adjustedHours: "8.50", reason: "late clock-out correction" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(application.createShiftAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        shiftAssignmentId: ASSIGNMENT_ID,
        adjustedHours: "8.50",
        reason: "late clock-out correction",
        actorId: USER,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shiftAdjustment: { id: ADJUSTMENT_ID, adjustedHours: "8.50" },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to record an adjustment",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(
        postRequest({ adjustedHours: "8", reason: "correction" }),
        context(),
      );

      expect(response.status).toBe(200);
      expect(application.createShiftAdjustment).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not record an adjustment",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(
        postRequest({ adjustedHours: "8", reason: "correction" }),
        context(),
      );

      expect(response.status).toBe(403);
      expect(application.createShiftAdjustment).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an assignment on a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown assignment", async () => {
    vi.mocked(application.findShiftAssignment).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it("returns 404 when the assignment's shift is missing", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { adjustedHours: "8" },
    { adjustedHours: "8", reason: "   " },
    { adjustedHours: 8, reason: "correction" },
    { adjustedHours: 8.5, reason: "correction" },
    { adjustedHours: "-1", reason: "correction" },
    { adjustedHours: "8.555", reason: "correction" },
    { adjustedHours: "8", reason: 42 },
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body), context());

    expect(response.status).toBe(400);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(application.createShiftAdjustment).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createShiftAdjustment).mockRejectedValue(
      new DomainError("adjusted hours must not exceed the shift length"),
    );

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "adjusted hours must not exceed the shift length",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.createShiftAdjustment).mockRejectedValue(
      new NotFoundError("shift assignment not found in organization"),
    );

    const response = await POST(
      postRequest({ adjustedHours: "8", reason: "correction" }),
      context(),
    );

    expect(response.status).toBe(404);
  });
});

describe("parseCreateShiftAdjustmentBody", () => {
  it.each(["0", "8", "8.5", "8.50", "12.25"])("accepts the decimal string %j", (hours) => {
    const parsed = parseCreateShiftAdjustmentBody({ adjustedHours: hours, reason: "correction" });

    expect(parsed.ok).toBe(true);
  });

  it.each([8, 8.5, -1, "8.555", "-0.5", ".5", "1e3", "abc", ""])(
    "rejects the adjustedHours value %j",
    (adjustedHours) => {
      const parsed = parseCreateShiftAdjustmentBody({ adjustedHours, reason: "correction" });

      expect(parsed.ok).toBe(false);
    },
  );

  it("rejects a blank reason", () => {
    expect(parseCreateShiftAdjustmentBody({ adjustedHours: "8", reason: "  " }).ok).toBe(false);
  });
});

describe("parseShiftAdjustmentListQuery", () => {
  it("defaults limit and offset", () => {
    const parsed = parseShiftAdjustmentListQuery(new URLSearchParams());

    expect(parsed.ok && parsed.query).toEqual({ limit: 50, offset: 0 });
  });

  it("rejects an out-of-range offset", () => {
    expect(parseShiftAdjustmentListQuery(new URLSearchParams("offset=999999999999")).ok).toBe(
      false,
    );
  });
});
