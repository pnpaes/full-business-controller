import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    buildMenuEngineeringReport: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";
import { parseMenuEngineeringQuery } from "../../reports/reporting-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/insights/menu-engineering";
const QUERY = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`;

function report(overrides: Record<string, unknown> = {}) {
  const scope = { locationIds: null, channelId: null };
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    scope,
    period: { from: FROM, to: TO },
    grain: "month",
    currency: "NOK",
    threshold: {
      popularity: {
        statistic: "median",
        source: "computed",
        value: "5.000000",
        scope,
        sourcePeriod: { start: FROM, end: TO },
      },
      contribution: {
        statistic: "category_median",
        source: "computed",
        value: null,
        scope,
        sourcePeriod: { start: FROM, end: TO },
      },
    },
    rows: [],
    unmapped: null,
    truncated: false,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresReportingStore).mockReturnValue({} as never);
  vi.mocked(application.buildMenuEngineeringReport).mockResolvedValue(report() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/insights/menu-engineering", () => {
  it("returns the report for the period", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildMenuEngineeringReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        from: FROM,
        to: TO,
        grain: "month",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...report() });
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s to read the report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which may not read consolidated margin",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.buildMenuEngineeringReport).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.buildMenuEngineeringReport).not.toHaveBeenCalled();
  });

  it("passes the optional dimension filters through for an unscoped caller", async () => {
    const response = await GET(getRequest(`${QUERY}&locationId=${LOCATION}&channelId=${LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.buildMenuEngineeringReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION], channelId: LOCATION }),
    );
  });

  it("denies a scoped caller an explicit out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.buildMenuEngineeringReport).not.toHaveBeenCalled();
  });

  it("pins a single-location caller to their location when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildMenuEngineeringReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("requires a locationId from a multi-location caller with no filter", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "locationId is required for a multi-location caller",
    });
    expect(application.buildMenuEngineeringReport).not.toHaveBeenCalled();
  });

  it("allows a multi-location caller an in-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.buildMenuEngineeringReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [OTHER_LOCATION] }),
    );
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.buildMenuEngineeringReport).mockRejectedValue(
      new DomainError("from must be on or before to"),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "from must be on or before to" });
  });

  it.each([
    `?to=${encodeURIComponent(TO)}&grain=month`,
    `?from=${encodeURIComponent(FROM)}&grain=month`,
    `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=quarter`,
    `?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}&grain=month`,
    `${QUERY}&locationId=not-a-uuid`,
    `${QUERY}&channelId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.buildMenuEngineeringReport).not.toHaveBeenCalled();
  });
});

describe("parseMenuEngineeringQuery", () => {
  it("parses the required fields and optional filters", () => {
    const parsed = parseMenuEngineeringQuery(
      new URLSearchParams({
        from: FROM,
        to: TO,
        grain: "week",
        locationId: LOCATION,
        channelId: LOCATION,
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      from: FROM,
      to: TO,
      grain: "week",
      locationId: LOCATION,
      channelId: LOCATION,
    });
  });

  it("ignores a groupBy parameter (the report is always per product)", () => {
    const parsed = parseMenuEngineeringQuery(
      new URLSearchParams({ from: FROM, to: TO, grain: "month", groupBy: "category" }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.query).not.toHaveProperty("groupBy");
  });

  it.each([
    new URLSearchParams({ to: TO, grain: "month" }),
    new URLSearchParams({ from: FROM, grain: "month" }),
    new URLSearchParams({ from: FROM, to: TO }),
    new URLSearchParams({ from: FROM, to: TO, grain: "quarter" }),
    new URLSearchParams({ from: TO, to: FROM, grain: "month" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", locationId: "nope" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", channelId: "nope" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseMenuEngineeringQuery(searchParams).ok).toBe(false);
  });
});
