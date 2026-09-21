import type {
  MonitoringPointRecord,
  MonitoringReadingRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findMonitoringPoint: vi.fn(),
    listMonitoringReadings: vi.fn(),
    recordMonitoringReading: vi.fn(),
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
import { getServerSession } from "../../../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const POINT_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/hms/monitoring-points/${POINT_ID}/readings`;

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

function readingRecord(overrides: Partial<MonitoringReadingRecord> = {}): MonitoringReadingRecord {
  return {
    id: "reading-1",
    organizationId: ORG,
    monitoringPointId: POINT_ID,
    value: "2.000000",
    unit: "celsius",
    measuredAt: "2026-02-01T08:00:00.000Z",
    recordedBy: USER,
    inRange: true,
    notes: null,
    createdAt: "2026-02-01T08:00:01.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = POINT_ID): { readonly params: Promise<{ readonly id: string }> } {
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

const validBody = { value: "2", measuredAt: "2026-02-01T08:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findMonitoringPoint).mockResolvedValue(pointRecord());
  vi.mocked(application.listMonitoringReadings).mockResolvedValue([]);
  vi.mocked(application.recordMonitoringReading).mockResolvedValue(readingRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/monitoring-points/[id]/readings", () => {
  it("lists the point's readings newest first", async () => {
    vi.mocked(application.listMonitoringReadings).mockResolvedValue([readingRecord()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: "reading-1",
          monitoringPointId: POINT_ID,
          value: "2.000000",
          unit: "celsius",
          measuredAt: "2026-02-01T08:00:00.000Z",
          recordedBy: USER,
          inRange: true,
          notes: null,
          createdAt: "2026-02-01T08:00:01.000Z",
        },
      ],
    });
    expect(application.listMonitoringReadings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, monitoringPointId: POINT_ID, limit: 50 }),
    );
  });

  it("lets an analyst read (matrix: HMS monitoring logs — Read)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.listMonitoringReadings).toHaveBeenCalled();
  });

  it("denies a location-scoped caller a point at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findMonitoringPoint).mockResolvedValue(
      pointRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listMonitoringReadings).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown point", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findMonitoringPoint).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listMonitoringReadings).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listMonitoringReadings).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the read set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listMonitoringReadings).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID point id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.listMonitoringReadings).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/monitoring-points/[id]/readings", () => {
  it("records a reading for the session actor and point", async () => {
    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordMonitoringReading).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        monitoringPointId: POINT_ID,
        value: "2",
        measuredAt: "2026-02-01T08:00:00.000Z",
        notes: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      monitoringReadingId: "reading-1",
      value: "2.000000",
      unit: "celsius",
      inRange: true,
    });
  });

  it("returns 400 for a missing value", async () => {
    const response = await POST(postRequest({ measuredAt: "2026-02-01T08:00:00.000Z" }), context());

    expect(response.status).toBe(400);
    expect(application.recordMonitoringReading).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the operational record set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMonitoringReading).not.toHaveBeenCalled();
  });

  it("allows a location_manager scoped to the point's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordMonitoringReading).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findMonitoringPoint).mockResolvedValue(
      pointRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMonitoringReading).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown point", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findMonitoringPoint).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(404);
    expect(application.recordMonitoringReading).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.recordMonitoringReading).mockRejectedValue(
      new DomainError("measuredAt must be an ISO instant"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "measuredAt must be an ISO instant",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.recordMonitoringReading).mockRejectedValue(
      new NotFoundError("monitoring point not found in organization"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(404);
  });
});
