import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresForecastStore: vi.fn(() => ({})),
    computeForecastTracking: vi.fn(),
    recordForecastSnapshot: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";
import { parseForecastSnapshotBody, parseForecastTrackingQuery } from "../analytics-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/api/v1/analytics/forecasts";
const QUERY = "?metric=revenue";

function report(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-25T00:00:00.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    grain: "day_location",
    scope: { locationId: null, channelId: null, category: null, productVariantId: null },
    status: "ok",
    snapshotId: "snap-1",
    snapshotAsOf: "2026-09-01T00:00:00.000Z",
    snapshotGeneratedAt: "2026-09-01T00:00:00.000Z",
    model: "least_squares_linear",
    completedPeriods: 4,
    minimumCompletedPeriods: 4,
    periods: [],
    accuracy: { method: "mape", methodNote: "note", mape: "0.100000", periods: 4 },
    overrides: [],
    reason: null,
    notes: [],
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = QUERY): Request {
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
  vi.mocked(application.createPostgresForecastStore).mockReturnValue({} as never);
  vi.mocked(application.computeForecastTracking).mockResolvedValue(report() as never);
  vi.mocked(application.recordForecastSnapshot).mockResolvedValue({
    forecastSnapshotId: "snap-1",
  });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/analytics/forecasts", () => {
  it("returns the tracking report and defaults the grain to day_location", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.computeForecastTracking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, metric: "revenue", grain: "day_location" }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...report() });
  });

  it("passes an explicit supported grain and channel through", async () => {
    const response = await GET(
      getRequest(`?metric=revenue&grain=day_location&channelId=${LOCATION_ID}`),
    );

    expect(response.status).toBe(200);
    expect(application.computeForecastTracking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grain: "day_location", channelId: LOCATION_ID }),
    );
  });

  it("pins a single-location caller to their location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION_ID]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.computeForecastTracking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: LOCATION_ID }),
    );
  });

  it("returns 403 when an explicit locationId is outside the caller's scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION_ID]),
    );

    const response = await GET(
      getRequest(`?metric=revenue&locationId=22222222-2222-4222-8222-222222222222`),
    );

    expect(response.status).toBe(403);
    expect(application.computeForecastTracking).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out and 403 for a denied role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);
    expect(application.computeForecastTracking).not.toHaveBeenCalled();
  });

  it.each([
    "?grain=day_location",
    "?metric=x",
    "?metric=revenue&grain=month",
    "?metric=revenue&grain=day_location_category",
    `?metric=revenue&locationId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(application.computeForecastTracking).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/analytics/forecasts", () => {
  it("records a snapshot for the session actor and organization", async () => {
    const response = await POST(
      postRequest({
        metric: "revenue",
        grain: "day_location",
        historyPeriods: 6,
        horizonPeriods: 3,
      }),
    );

    expect(response.status).toBe(200);
    expect(application.recordForecastSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        metric: "revenue",
        grain: "day_location",
        historyPeriods: 6,
        horizonPeriods: 3,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, forecastSnapshotId: "snap-1" });
  });

  it("defaults the grain and omits scope the caller did not send", async () => {
    await POST(postRequest({ metric: "revenue" }));

    const input = vi.mocked(application.recordForecastSnapshot).mock.calls[0]?.[1];
    expect(input).toEqual(
      expect.objectContaining({ grain: "day_location", organizationId: ORG, actorId: USER }),
    );
    expect(input).not.toHaveProperty("locationId");
    expect(input).not.toHaveProperty("channelId");
    expect(input).not.toHaveProperty("historyPeriods");
  });

  it("rejects a read-only role with 403", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest({ metric: "revenue" }));

    expect(response.status).toBe(403);
    expect(application.recordForecastSnapshot).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest({ metric: "revenue" }));

    expect(response.status).toBe(401);
    expect(application.recordForecastSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before the handler", async () => {
    const response = await POST(
      new Request(`http://localhost${PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric: "revenue" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(application.recordForecastSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ metric: "x" }],
    [{ metric: "revenue", grain: "month" }],
    [{ metric: "revenue", historyPeriods: 0 }],
    [{ metric: "revenue", historyPeriods: "6" }],
    [{ metric: "revenue", locationId: "not-a-uuid" }],
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));
    expect(response.status).toBe(400);
    expect(application.recordForecastSnapshot).not.toHaveBeenCalled();
  });

  it("maps a command DomainError (insufficient history) to 400 with its message", async () => {
    vi.mocked(application.recordForecastSnapshot).mockRejectedValue(
      new DomainError("cannot record a forecast snapshot: only 2 history points"),
    );

    const response = await POST(postRequest({ metric: "revenue" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "cannot record a forecast snapshot: only 2 history points",
    });
  });
});

describe("forecast tracking parsers", () => {
  it("parses the tracking query and defaults the grain", () => {
    const parsed = parseForecastTrackingQuery(new URLSearchParams({ metric: "revenue" }));
    expect(parsed.ok && parsed.query).toEqual({ metric: "revenue", grain: "day_location" });
  });

  it("refuses an unsupported tracking grain", () => {
    expect(
      parseForecastTrackingQuery(
        new URLSearchParams({ metric: "revenue", grain: "day_location_product" }),
      ).ok,
    ).toBe(false);
  });

  it("parses a snapshot body and treats a blank location as organization-wide", () => {
    const parsed = parseForecastSnapshotBody({ metric: "units", locationId: "   " });
    expect(parsed.ok && parsed.fields).toEqual({ metric: "units", grain: "day_location" });
  });

  it("refuses a snapshot body with a non-integer window", () => {
    expect(parseForecastSnapshotBody({ metric: "units", horizonPeriods: 1.5 }).ok).toBe(false);
  });
});
