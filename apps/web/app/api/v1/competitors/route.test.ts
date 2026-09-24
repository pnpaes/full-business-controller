import type { CompetitorRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    listCompetitors: vi.fn(),
    registerCompetitor: vi.fn(),
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

import { parseCompetitorListQuery, parseCreateCompetitorBody } from "./competitor-rows";
import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const COMPETITOR_ID = "55555555-5555-4555-8555-555555555555";
const PATH = "/api/v1/competitors";

function competitorRecord(overrides: Partial<CompetitorRecord> = {}): CompetitorRecord {
  return {
    id: COMPETITOR_ID,
    organizationId: ORG,
    name: "Rival Cafe",
    notes: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    ...overrides,
  };
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
  vi.mocked(application.listCompetitors).mockResolvedValue([]);
  vi.mocked(application.registerCompetitor).mockResolvedValue(competitorRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/competitors", () => {
  it("lists the organization's competitors", async () => {
    vi.mocked(application.listCompetitors).mockResolvedValue([competitorRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 100,
      offset: 0,
      competitors: [
        {
          id: COMPETITOR_ID,
          name: "Rival Cafe",
          notes: null,
          createdAt: "2026-09-24T09:00:00.000Z",
        },
      ],
    });
  });

  it("returns 401 when signed out and 403 for a reader-less role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);
  });

  it.each(["?limit=0", "?limit=201", "?offset=x"])("returns 400 for %j", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(application.listCompetitors).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/competitors", () => {
  it("registers for the session actor and served organization", async () => {
    const response = await POST(postRequest({ name: "Rival Cafe", notes: "across the street" }));

    expect(response.status).toBe(200);
    expect(application.registerCompetitor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        name: "Rival Cafe",
        notes: "across the street",
      }),
    );
  });

  it("returns 403 for a role that may not write", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    expect((await POST(postRequest({ name: "Rival Cafe" }))).status).toBe(403);
    expect(application.registerCompetitor).not.toHaveBeenCalled();
  });

  it("returns 400 for a blank name and for a DomainError", async () => {
    expect((await POST(postRequest({ name: "   " }))).status).toBe(400);

    vi.mocked(application.registerCompetitor).mockRejectedValue(
      new DomainError("name is required"),
    );
    const response = await POST(postRequest({ name: "Rival Cafe" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name is required" });
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(postRequest({ name: "Rival Cafe" }))).status).toBe(401);
  });
});

describe("competitor parsers", () => {
  it("parses and bounds paging", () => {
    expect(parseCompetitorListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 100, offset: 0 },
    });
    expect(parseCompetitorListQuery(new URLSearchParams({ limit: "10", offset: "2" }))).toEqual({
      ok: true,
      query: { limit: 10, offset: 2 },
    });
    expect(parseCompetitorListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
  });

  it("parses a create body and rejects a blank name", () => {
    expect(parseCreateCompetitorBody({ name: "Rival Cafe", notes: "hi" })).toEqual({
      ok: true,
      input: { name: "Rival Cafe", notes: "hi" },
    });
    expect(parseCreateCompetitorBody({})).toEqual({ ok: false });
    expect(parseCreateCompetitorBody({ name: "  " }).ok).toBe(false);
    expect(parseCreateCompetitorBody(undefined).ok).toBe(false);
  });
});
