import type { MonitoringPointRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    listMonitoringPoints: vi.fn(),
    registerMonitoringPoint: vi.fn(),
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
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const POINT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_POINT_ID = "44444444-4444-4444-8444-444444444444";

function pointRecord(overrides: Partial<MonitoringPointRecord> = {}): MonitoringPointRecord {
  return {
    id: POINT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    storageAreaId: null,
    code: "fridge-1",
    name: "Walk-in fridge",
    kind: "refrigerator",
    unit: "celsius",
    targetMin: "0.000000",
    targetMax: "4.000000",
    checkFrequency: "twice_daily",
    active: true,
    createdAt: "2026-02-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/monitoring-points${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/hms/monitoring-points", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  code: "fridge-1",
  name: "Walk-in fridge",
  kind: "refrigerator",
  unit: "celsius",
  targetMin: "0",
  targetMax: "4",
  checkFrequency: "twice_daily",
  locationId: LOCATION,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.listMonitoringPoints).mockResolvedValue([]);
  vi.mocked(application.registerMonitoringPoint).mockResolvedValue(pointRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/monitoring-points", () => {
  it("lists the organization's points", async () => {
    vi.mocked(application.listMonitoringPoints).mockResolvedValue([pointRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: POINT_ID,
          locationId: LOCATION,
          storageAreaId: null,
          code: "fridge-1",
          name: "Walk-in fridge",
          kind: "refrigerator",
          unit: "celsius",
          targetMin: "0.000000",
          targetMax: "4.000000",
          checkFrequency: "twice_daily",
          active: true,
          createdAt: "2026-02-01T08:00:00.000Z",
          createdBy: USER,
        },
      ],
    });
    expect(application.listMonitoringPoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the location and active-only filters through", async () => {
    const response = await GET(getRequest(`?locationId=${LOCATION}&activeOnly=true&limit=10`));

    expect(response.status).toBe(200);
    expect(application.listMonitoringPoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        locationId: LOCATION,
        activeOnly: true,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("lets an analyst read (matrix: HMS monitoring logs — Read)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listMonitoringPoints).toHaveBeenCalled();
  });

  it("restricts a location-scoped caller to their own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listMonitoringPoints).mockResolvedValue([
      pointRecord(),
      pointRecord({ id: OTHER_POINT_ID, locationId: OTHER_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listMonitoringPoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, locationId: LOCATION }),
    );
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ locationId: LOCATION }],
    });
  });

  it("denies an explicit filter outside the caller's location scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listMonitoringPoints).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listMonitoringPoints).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the read set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listMonitoringPoints).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?locationId=nope"));

    expect(response.status).toBe(400);
    expect(application.listMonitoringPoints).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/monitoring-points", () => {
  it("registers a point for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerMonitoringPoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        locationId: LOCATION,
        storageAreaId: null,
        code: "fridge-1",
        checkFrequency: "twice_daily",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      monitoringPointId: POINT_ID,
      code: "fridge-1",
      active: true,
    });
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(postRequest({ ...validBody, code: "" }));

    expect(response.status).toBe(400);
    expect(application.registerMonitoringPoint).not.toHaveBeenCalled();
  });

  it("returns 403 for admin, which has no implicit record access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerMonitoringPoint).not.toHaveBeenCalled();
  });

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerMonitoringPoint).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerMonitoringPoint).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.registerMonitoringPoint).mockRejectedValue(
      new DomainError("targetMin must not be greater than targetMax"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "targetMin must not be greater than targetMax",
    });
  });
});
