import type { ShiftRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findShift: vi.fn(),
    updateShift: vi.fn(),
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
const STARTS = "2026-03-01T09:00:00.000Z";
const ENDS = "2026-03-01T17:00:00.000Z";
const PATH = `/api/v1/workforce/shifts/${SHIFT_ID}`;

function shiftRecord(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: SHIFT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    roleCode: "line_cook",
    positionId: null,
    startsAt: STARTS,
    endsAt: ENDS,
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

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = SHIFT_ID): { readonly params: Promise<{ readonly id: string }> } {
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
  vi.mocked(application.findShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.updateShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/shifts/[id]", () => {
  it("returns one shift", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, shiftId: SHIFT_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      shift: {
        id: SHIFT_ID,
        locationId: LOCATION,
        roleCode: "line_cook",
        positionId: null,
        startsAt: STARTS,
        endsAt: ENDS,
        breakMinutes: 30,
        state: "open",
        publishedAt: null,
        actualStart: null,
        actualEnd: null,
        createdAt: "2026-02-01T08:00:00.000Z",
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
  ])("allows %s to read one shift", async (role) => {
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
      expect(application.findShift).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
  });

  it("returns 404 for an unknown shift", async () => {
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findShift).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/workforce/shifts/[id]", () => {
  it("amends a shift for the session actor", async () => {
    vi.mocked(application.updateShift).mockResolvedValue(
      shiftRecord({ breakMinutes: 45, roleCode: null }),
    );

    const response = await PATCH(patchRequest({ breakMinutes: 45, roleCode: null }), context());

    expect(response.status).toBe(200);
    expect(application.updateShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        shiftId: SHIFT_ID,
        breakMinutes: 45,
        roleCode: null,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shift: { breakMinutes: 45, roleCode: null },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to amend a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

      expect(response.status).toBe(200);
      expect(application.updateShift).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not write a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

      expect(response.status).toBe(403);
      expect(application.updateShift).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller a shift at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(shiftRecord({ locationId: OTHER_LOCATION }));

    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

    expect(response.status).toBe(403);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown shift", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findShift).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

    expect(response.status).toBe(404);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a fractional breakMinutes", async () => {
    const response = await PATCH(patchRequest({ breakMinutes: 12.5 }), context());

    expect(response.status).toBe(400);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed instant", async () => {
    const response = await PATCH(patchRequest({ startsAt: "2026-03-01" }), context());

    expect(response.status).toBe(400);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

    expect(response.status).toBe(401);
    expect(application.updateShift).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateShift).mockRejectedValue(
      new DomainError("no updatable fields provided"),
    );

    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "no updatable fields provided" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateShift).mockRejectedValue(
      new NotFoundError("shift not found in organization"),
    );

    const response = await PATCH(patchRequest({ breakMinutes: 45 }), context());

    expect(response.status).toBe(404);
  });
});
