import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresForecastStore: vi.fn(() => ({})),
    recordForecastOverride: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";
import { parseForecastOverrideBody } from "../../analytics-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/api/v1/analytics/forecasts/overrides";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  metric: "revenue",
  period: "2026-09-25",
  reason: "The local festival moved demand a day later.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresForecastStore).mockReturnValue({} as never);
  vi.mocked(application.recordForecastOverride).mockResolvedValue({
    forecastOverrideId: "override-1",
  });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("POST /api/v1/analytics/forecasts/overrides", () => {
  it("appends the override for the session actor and organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.recordForecastOverride).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        metric: "revenue",
        grain: "day_location",
        period: "2026-09-25",
        reason: "The local festival moved demand a day later.",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, forecastOverrideId: "override-1" });
  });

  it("passes an optional snapshot id through", async () => {
    await POST(postRequest({ ...validBody, snapshotId: SNAPSHOT_ID }));

    expect(application.recordForecastOverride).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ snapshotId: SNAPSHOT_ID }),
    );
  });

  it("returns 403 for a read-only role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.recordForecastOverride).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    expect((await POST(postRequest(validBody))).status).toBe(401);
    expect(application.recordForecastOverride).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ ...validBody, metric: "x" }],
    [{ ...validBody, grain: "day_location_product" }],
    [{ ...validBody, period: "September" }],
    [{ ...validBody, reason: "   " }],
    [{ ...validBody, snapshotId: "not-a-uuid" }],
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));
    expect(response.status).toBe(400);
    expect(application.recordForecastOverride).not.toHaveBeenCalled();
  });

  it("maps the mandatory-reason DomainError to 400 with its message", async () => {
    vi.mocked(application.recordForecastOverride).mockRejectedValue(
      new DomainError("reason is required: an override must state why"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "reason is required: an override must state why",
    });
  });
});

describe("parseForecastOverrideBody", () => {
  it("requires a reason and a day-bucket period", () => {
    expect(parseForecastOverrideBody({ metric: "revenue", period: "2026-09-25" }).ok).toBe(false);
    expect(
      parseForecastOverrideBody({ metric: "revenue", period: "2026-09-25", reason: "why" }).ok,
    ).toBe(true);
  });
});
