import type { ShiftRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findShift: vi.fn(),
    completeShift: vi.fn(),
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
const PATH = `/api/v1/workforce/shifts/${SHIFT_ID}/complete`;

function shiftRecord(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: SHIFT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    roleCode: "line_cook",
    startsAt: "2026-03-01T09:00:00.000Z",
    endsAt: "2026-03-01T17:00:00.000Z",
    breakMinutes: 30,
    state: "published",
    publishedAt: "2026-02-02T08:00:00.000Z",
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

function context(id: string = SHIFT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function completeRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.findShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.completeShift).mockResolvedValue(shiftRecord({ state: "completed" }));
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/workforce/shifts/[id]/complete", () => {
  it("completes the shift for the session actor", async () => {
    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(200);
    expect(application.completeShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, shiftId: SHIFT_ID, actorId: USER }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shift: { id: SHIFT_ID, state: "completed" },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to complete a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(completeRequest(), context());

      expect(response.status).toBe(200);
      expect(application.completeShift).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not complete a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(completeRequest(), context());

      expect(response.status).toBe(403);
      expect(application.completeShift).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(403);
    expect(application.completeShift).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown shift", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(404);
    expect(application.completeShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(completeRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.completeShift).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(401);
    expect(application.completeShift).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.completeShift).mockRejectedValue(
      new DomainError("shift in state open cannot be completed"),
    );

    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "shift in state open cannot be completed",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.completeShift).mockRejectedValue(
      new NotFoundError("shift not found in organization"),
    );

    const response = await POST(completeRequest(), context());

    expect(response.status).toBe(404);
  });
});
