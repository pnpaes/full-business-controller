import type { AdjustmentPeriodRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    DEFAULT_ADJUSTMENT_PERIOD_LIMIT: 50,
    createPostgresAdjustmentPeriodStore: vi.fn(() => ({})),
    listAdjustmentPeriods: vi.fn(),
    openAdjustmentPeriod: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../lib/auth";
import { AuthHttpError } from "../../../../lib/errors";
import { getServerSession } from "../../../../lib/server-session";

import {
  parseListAdjustmentPeriodsQuery,
  parseOpenAdjustmentPeriodBody,
} from "./adjustment-period-rows";
import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PERIOD_ID = "55555555-5555-4555-8555-555555555555";
const FROM = "2026-03-01";
const TO = "2026-03-05";
const PATH = "/api/v1/adjustment-periods";

function periodRecord(overrides: Partial<AdjustmentPeriodRecord> = {}): AdjustmentPeriodRecord {
  return {
    id: PERIOD_ID,
    organizationId: ORG,
    openedFrom: FROM,
    openedTo: TO,
    reason: "late corrections",
    approvedBy: USER,
    approvedAt: "2026-03-06T10:00:00.000Z",
    status: "open",
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<AdjustmentPeriodRecord> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...periodRecord(overrides) };
  delete record.organizationId;
  return record;
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
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
  vi.mocked(application.createPostgresAdjustmentPeriodStore).mockReturnValue({} as never);
  vi.mocked(application.listAdjustmentPeriods).mockResolvedValue([]);
  vi.mocked(application.openAdjustmentPeriod).mockResolvedValue(periodRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/adjustment-periods", () => {
  it("lists the organization's adjustment periods", async () => {
    vi.mocked(application.listAdjustmentPeriods).mockResolvedValue([periodRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      adjustmentPeriods: [row()],
    });
    expect(application.listAdjustmentPeriods).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the status and period filters through", async () => {
    const response = await GET(
      getRequest(`?status=closed&from=2026-03-01&to=2026-03-31&limit=10&offset=5`),
    );

    expect(response.status).toBe(200);
    expect(application.listAdjustmentPeriods).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "closed",
        from: "2026-03-01",
        to: "2026-03-31",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "front_of_house",
    "finance",
    "admin",
    "analyst",
  ])("allows %s to read adjustment periods", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listAdjustmentPeriods).toHaveBeenCalled();
  });

  it.each(["kitchen", "purchasing"])(
    "returns 403 for %s, which may not read adjustment periods",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listAdjustmentPeriods).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listAdjustmentPeriods).not.toHaveBeenCalled();
  });

  it.each([
    "?status=bogus",
    "?from=2026-13-01",
    "?from=2026-03-31&to=2026-03-01",
    "?limit=0",
    "?limit=201",
    "?offset=201",
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listAdjustmentPeriods).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/adjustment-periods", () => {
  it("opens an adjustment period for the session actor and served organization", async () => {
    const response = await POST(postRequest({ openedFrom: FROM, openedTo: TO, reason: "late" }));

    expect(response.status).toBe(200);
    expect(application.openAdjustmentPeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        openedFrom: FROM,
        openedTo: TO,
        reason: "late",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, adjustmentPeriod: row() });
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to open an adjustment period",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ openedFrom: FROM, openedTo: TO, reason: "late" }));

      expect(response.status).toBe(200);
      expect(application.openAdjustmentPeriod).toHaveBeenCalled();
    },
  );

  it.each(["analyst", "location_manager", "front_of_house"])(
    "returns 403 for %s, which may not open an adjustment period",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ openedFrom: FROM, openedTo: TO, reason: "late" }));

      expect(response.status).toBe(403);
      expect(application.openAdjustmentPeriod).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { openedFrom: FROM, openedTo: TO },
    { openedFrom: "2026-13-01", openedTo: TO, reason: "late" },
    { openedFrom: TO, openedTo: FROM, reason: "late" },
    { openedFrom: FROM, openedTo: TO, reason: "   " },
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(application.openAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ openedFrom: FROM, openedTo: TO, reason: "late" }));

    expect(response.status).toBe(401);
    expect(application.openAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.openAdjustmentPeriod).mockRejectedValue(
      new DomainError("an open adjustment period already exists for the organization"),
    );

    const response = await POST(postRequest({ openedFrom: FROM, openedTo: TO, reason: "late" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "an open adjustment period already exists for the organization",
    });
  });
});

describe("parseListAdjustmentPeriodsQuery", () => {
  it("parses the optional filters and paging", () => {
    const parsed = parseListAdjustmentPeriodsQuery(
      new URLSearchParams({
        status: "open",
        from: "2026-03-01",
        to: "2026-03-31",
        limit: "25",
        offset: "2",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      status: "open",
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 25,
      offset: 2,
    });
  });

  it("defaults the page to the application limit and offset 0", () => {
    const parsed = parseListAdjustmentPeriodsQuery(new URLSearchParams());

    expect(parsed.ok && parsed.query).toEqual({ limit: 50, offset: 0 });
  });

  it.each([
    new URLSearchParams({ status: "bogus" }),
    new URLSearchParams({ from: "2026-13-01" }),
    new URLSearchParams({ from: "2026-03-31", to: "2026-03-01" }),
    new URLSearchParams({ limit: "0" }),
    new URLSearchParams({ limit: "201" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseListAdjustmentPeriodsQuery(searchParams).ok).toBe(false);
  });
});

describe("parseOpenAdjustmentPeriodBody", () => {
  it("parses a window with a reason", () => {
    const parsed = parseOpenAdjustmentPeriodBody({
      openedFrom: FROM,
      openedTo: TO,
      reason: "late invoice corrections",
    });

    expect(parsed.ok && parsed.input).toEqual({
      openedFrom: FROM,
      openedTo: TO,
      reason: "late invoice corrections",
    });
  });

  it.each([
    undefined,
    {},
    { openedFrom: FROM, openedTo: TO },
    { openedFrom: "2026-02-31", openedTo: TO, reason: "late" },
    { openedFrom: TO, openedTo: FROM, reason: "late" },
    { openedFrom: FROM, openedTo: TO, reason: "" },
  ])("rejects the malformed body %j", (body) => {
    expect(parseOpenAdjustmentPeriodBody(body as Record<string, unknown> | undefined).ok).toBe(
      false,
    );
  });
});
