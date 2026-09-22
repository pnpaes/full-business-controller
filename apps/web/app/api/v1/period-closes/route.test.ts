import type { PeriodCloseRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    DEFAULT_PERIOD_CLOSE_LIMIT: 50,
    createPostgresPeriodCloseStore: vi.fn(() => ({})),
    listPeriodCloses: vi.fn(),
    beginPeriodClose: vi.fn(),
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

import { parseBeginPeriodCloseBody, parseListPeriodClosesQuery } from "./period-close-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const CLOSE_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const DAY = "2026-03-05";
const ORG_UUID = "11111111-1111-4111-8111-111111111111";
const PATH = "/api/v1/period-closes";

function closeRecord(overrides: Partial<PeriodCloseRecord> = {}): PeriodCloseRecord {
  return {
    id: CLOSE_ID,
    organizationId: ORG,
    scopeType: "location",
    scopeId: LOCATION_ID,
    periodStart: DAY,
    periodEnd: DAY,
    status: "closing",
    checklist: [],
    snapshot: { schemaVersion: 1 },
    correctionPolicy: null,
    lockedBy: null,
    lockedAt: null,
    reopenedBy: null,
    reopenedAt: null,
    reopenReason: null,
    createdAt: "2026-03-05T22:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<PeriodCloseRecord> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...closeRecord(overrides) };
  delete record.organizationId;
  return record;
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
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
  vi.mocked(application.createPostgresPeriodCloseStore).mockReturnValue({} as never);
  vi.mocked(application.listPeriodCloses).mockResolvedValue([]);
  vi.mocked(application.beginPeriodClose).mockResolvedValue(closeRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/period-closes", () => {
  it("lists the organization's closes", async () => {
    vi.mocked(application.listPeriodCloses).mockResolvedValue([closeRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      periodCloses: [row()],
    });
    expect(application.listPeriodCloses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the scope, status and period filters through", async () => {
    const response = await GET(
      getRequest(
        `?scopeType=location&scopeId=${LOCATION_ID}&status=locked&from=2026-03-01&to=2026-03-31&limit=10&offset=5`,
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listPeriodCloses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        scopeType: "location",
        scopeId: LOCATION_ID,
        status: "locked",
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
  ])("allows %s to read closes", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listPeriodCloses).toHaveBeenCalled();
  });

  it.each(["kitchen", "purchasing"])(
    "returns 403 for %s, which may not read closes",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listPeriodCloses).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listPeriodCloses).not.toHaveBeenCalled();
  });

  it.each([
    "?status=bogus",
    "?scopeType=bogus",
    "?scopeId=not-a-uuid",
    "?from=2026-13-01",
    "?from=2026-03-31&to=2026-03-01",
    "?limit=0",
    "?limit=201",
    "?offset=201",
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listPeriodCloses).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/period-closes", () => {
  it("begins a location close for the session actor and served organization", async () => {
    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(200);
    expect(application.beginPeriodClose).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        scopeType: "location",
        scopeId: LOCATION_ID,
        periodStart: DAY,
        checklist: [],
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, periodClose: row() });
  });

  it("begins a company close for an owner", async () => {
    vi.mocked(application.beginPeriodClose).mockResolvedValue(
      closeRecord({
        scopeType: "company",
        scopeId: ORG_UUID,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
    );

    const response = await POST(
      postRequest({ scopeType: "company", scopeId: ORG_UUID, periodStart: "2026-03-01" }),
    );

    expect(response.status).toBe(200);
    expect(application.beginPeriodClose).toHaveBeenCalled();
  });

  it.each(["owner", "general_manager", "location_manager", "front_of_house", "finance", "admin"])(
    "allows %s to begin a location close",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(
        postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
      );

      expect(response.status).toBe(200);
      expect(application.beginPeriodClose).toHaveBeenCalled();
    },
  );

  it("returns 403 for analyst, which is read-only", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(403);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a location-scoped caller outside the close's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION_ID]),
    );

    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(403);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a location_manager beginning a company close", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION_ID]),
    );

    const response = await POST(
      postRequest({ scopeType: "company", scopeId: ORG_UUID, periodStart: "2026-03-01" }),
    );

    expect(response.status).toBe(403);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a front_of_house caller beginning a company close", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await POST(
      postRequest({ scopeType: "company", scopeId: ORG_UUID, periodStart: "2026-03-01" }),
    );

    expect(response.status).toBe(403);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { scopeType: "location", scopeId: LOCATION_ID },
    { scopeType: "bogus", scopeId: LOCATION_ID, periodStart: DAY },
    { scopeType: "location", scopeId: "not-a-uuid", periodStart: DAY },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: "2026-13-01" },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY, checklist: "nope" },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY, checklist: null },
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(401);
    expect(application.beginPeriodClose).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.beginPeriodClose).mockRejectedValue(
      new DomainError("period is locked; reopen it first"),
    );

    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "period is locked; reopen it first" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.beginPeriodClose).mockRejectedValue(
      new NotFoundError("period close not found in organization"),
    );

    const response = await POST(
      postRequest({ scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY }),
    );

    expect(response.status).toBe(404);
  });
});

describe("parseListPeriodClosesQuery", () => {
  it("parses the optional filters and paging", () => {
    const parsed = parseListPeriodClosesQuery(
      new URLSearchParams({
        scopeType: "company",
        scopeId: LOCATION_ID,
        status: "locked",
        from: "2026-03-01",
        to: "2026-03-31",
        limit: "25",
        offset: "2",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      scopeType: "company",
      scopeId: LOCATION_ID,
      status: "locked",
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 25,
      offset: 2,
    });
  });

  it("defaults the page to the application limit and offset 0", () => {
    const parsed = parseListPeriodClosesQuery(new URLSearchParams());

    expect(parsed.ok && parsed.query).toEqual({ limit: 50, offset: 0 });
  });

  it.each([
    new URLSearchParams({ status: "bogus" }),
    new URLSearchParams({ scopeType: "bogus" }),
    new URLSearchParams({ scopeId: "nope" }),
    new URLSearchParams({ from: "2026-13-01" }),
    new URLSearchParams({ from: "2026-03-31", to: "2026-03-01" }),
    new URLSearchParams({ limit: "0" }),
    new URLSearchParams({ limit: "201" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseListPeriodClosesQuery(searchParams).ok).toBe(false);
  });
});

describe("parseBeginPeriodCloseBody", () => {
  it("parses a location close with a checklist", () => {
    const parsed = parseBeginPeriodCloseBody({
      scopeType: "location",
      scopeId: LOCATION_ID,
      periodStart: DAY,
      checklist: [{ key: "cash_counted", label: "Count the till", done: true }],
    });

    expect(parsed.ok && parsed.input).toEqual({
      scopeType: "location",
      scopeId: LOCATION_ID,
      periodStart: DAY,
      checklist: [{ key: "cash_counted", label: "Count the till", done: true }],
    });
  });

  it("defaults an absent checklist to an empty array", () => {
    const parsed = parseBeginPeriodCloseBody({
      scopeType: "company",
      scopeId: ORG_UUID,
      periodStart: "2026-03-01",
    });

    expect(parsed.ok && parsed.input.checklist).toEqual([]);
  });

  it.each([
    undefined,
    {},
    { scopeType: "bogus", scopeId: LOCATION_ID, periodStart: DAY },
    { scopeType: "location", scopeId: "nope", periodStart: DAY },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: "2026-02-31" },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY, checklist: {} },
    { scopeType: "location", scopeId: LOCATION_ID, periodStart: DAY, checklist: null },
  ])("rejects the malformed body %j", (body) => {
    expect(parseBeginPeriodCloseBody(body as Record<string, unknown> | undefined).ok).toBe(false);
  });
});
