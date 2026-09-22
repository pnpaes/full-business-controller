import type { ShiftRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    listShifts: vi.fn(),
    createShift: vi.fn(),
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
import { AuthHttpError } from "../../../../../lib/errors";
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const THIRD_LOCATION = "44444444-4444-4444-8444-444444444444";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const STARTS = "2026-03-01T09:00:00.000Z";
const ENDS = "2026-03-01T17:00:00.000Z";

function shiftRecord(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: SHIFT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    roleCode: "line_cook",
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

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/workforce/shifts${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/workforce/shifts", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  locationId: LOCATION,
  roleCode: "line_cook",
  startsAt: STARTS,
  endsAt: ENDS,
  breakMinutes: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.listShifts).mockResolvedValue([]);
  vi.mocked(application.createShift).mockResolvedValue(shiftRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/shifts", () => {
  it("lists the organization's shifts", async () => {
    vi.mocked(application.listShifts).mockResolvedValue([shiftRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: SHIFT_ID,
          locationId: LOCATION,
          roleCode: "line_cook",
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
      ],
    });
    expect(application.listShifts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the location, state, window and paging filters through", async () => {
    const response = await GET(
      getRequest(
        `?locationId=${LOCATION}&state=published&from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.000Z&limit=10&offset=5`,
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listShifts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        locationId: LOCATION,
        state: "published",
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.000Z",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it("pins a single-location caller and hides shifts at other locations", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listShifts).mockResolvedValue([
      shiftRecord(),
      shiftRecord({ id: "row-2", locationId: OTHER_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listShifts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, locationId: LOCATION }),
    );
    await expect(response.json()).resolves.toMatchObject({ rows: [{ locationId: LOCATION }] });
  });

  it("filters a multi-location caller's page in memory", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );
    vi.mocked(application.listShifts).mockResolvedValue([
      shiftRecord(),
      shiftRecord({ id: "row-2", locationId: OTHER_LOCATION }),
      shiftRecord({ id: "row-3", locationId: THIRD_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const listCalls = vi.mocked(application.listShifts).mock.calls;
    expect(listCalls[0]?.[1]).not.toHaveProperty("locationId");
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ locationId: LOCATION }, { locationId: OTHER_LOCATION }],
    });
  });

  it("denies an explicit filter outside the caller's location scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "front_of_house",
    "finance",
    "admin",
  ])("allows %s to read the rota", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listShifts).toHaveBeenCalled();
  });

  it.each(["analyst", "purchasing"])(
    "returns 403 for %s, which has no shift access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listShifts).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed location filter", async () => {
    const response = await GET(getRequest("?locationId=nope"));

    expect(response.status).toBe(400);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it("returns 400 for a state outside the vocabulary", async () => {
    const response = await GET(getRequest("?state=bogus"));

    expect(response.status).toBe(400);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed instant", async () => {
    const response = await GET(getRequest("?from=2026-03-01"));

    expect(response.status).toBe(400);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it("returns 400 for an inverted window", async () => {
    const response = await GET(
      getRequest("?from=2026-04-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z"),
    );

    expect(response.status).toBe(400);
    expect(application.listShifts).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listShifts).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/workforce/shifts", () => {
  it("plans a shift for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.createShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        locationId: LOCATION,
        roleCode: "line_cook",
        startsAt: STARTS,
        endsAt: ENDS,
        breakMinutes: 30,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      shift: { id: SHIFT_ID, state: "open" },
    });
  });

  it("defaults an omitted breakMinutes to the command default", async () => {
    const response = await POST(
      postRequest({
        locationId: LOCATION,
        startsAt: STARTS,
        endsAt: ENDS,
      }),
    );

    expect(response.status).toBe(200);
    expect(application.createShift).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ breakMinutes: expect.anything() }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to plan a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(200);
      expect(application.createShift).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "finance", "analyst", "purchasing"])(
    "returns 403 for %s, which may not write a shift",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(403);
      expect(application.createShift).not.toHaveBeenCalled();
    },
  );

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.createShift).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.createShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID locationId", async () => {
    const response = await POST(postRequest({ ...validBody, locationId: "nope" }));

    expect(response.status).toBe(400);
    expect(application.createShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a date-only startsAt", async () => {
    const response = await POST(postRequest({ ...validBody, startsAt: "2026-03-01" }));

    expect(response.status).toBe(400);
    expect(application.createShift).not.toHaveBeenCalled();
  });

  it("returns 400 for a fractional breakMinutes", async () => {
    const response = await POST(postRequest({ ...validBody, breakMinutes: 12.5 }));

    expect(response.status).toBe(400);
    expect(application.createShift).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.createShift).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createShift).mockRejectedValue(
      new DomainError("endsAt must be after startsAt"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "endsAt must be after startsAt" });
  });
});
