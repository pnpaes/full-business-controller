import type { CompetitorSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    listCompetitorSources: vi.fn(),
    registerCompetitorSource: vi.fn(),
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

import {
  parseCompetitorSourceListQuery,
  parseRegisterCompetitorSourceBody,
} from "../competitor-rows";
import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const PATH = "/api/v1/competitors/sources";

function sourceRecord(overrides: Partial<CompetitorSourceRecord> = {}): CompetitorSourceRecord {
  return {
    id: SOURCE_ID,
    organizationId: ORG,
    competitorName: "Rival Cafe",
    competitorId: null,
    sourceType: "website",
    urlOrIdentifier: "https://rival.example/menu",
    collectionMode: "manual",
    termsStatus: "pending",
    approvedBy: null,
    approvedAt: null,
    rateLimitNote: null,
    activeFrom: "2026-09-01",
    activeTo: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: USER,
    updatedAt: null,
    updatedBy: null,
    version: 1,
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

const MANUAL_BODY = {
  competitorName: "Rival Cafe",
  sourceType: "website",
  urlOrIdentifier: "https://rival.example/menu",
  collectionMode: "manual",
  activeFrom: "2026-09-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.listCompetitorSources).mockResolvedValue([]);
  vi.mocked(application.registerCompetitorSource).mockResolvedValue(sourceRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/competitors/sources", () => {
  it("lists the organization's sources", async () => {
    vi.mocked(application.listCompetitorSources).mockResolvedValue([sourceRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 100,
      offset: 0,
      sources: [
        {
          id: SOURCE_ID,
          competitorName: "Rival Cafe",
          competitorId: null,
          sourceType: "website",
          urlOrIdentifier: "https://rival.example/menu",
          collectionMode: "manual",
          termsStatus: "pending",
          approvedBy: null,
          approvedAt: null,
          rateLimitNote: null,
          activeFrom: "2026-09-01",
          activeTo: null,
          createdAt: "2026-09-01T09:00:00.000Z",
          updatedAt: null,
          version: 1,
        },
      ],
    });
  });

  it("passes the active filter through", async () => {
    await GET(getRequest("?active=true"));
    expect(application.listCompetitorSources).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true }),
    );
  });

  it("returns 401 signed out, 403 for a reader-less role, 400 for a bad filter", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    expect((await GET(getRequest("?active=maybe"))).status).toBe(400);
    expect((await GET(getRequest("?limit=0"))).status).toBe(400);
  });
});

describe("POST /api/v1/competitors/sources", () => {
  it("registers a manual source for a write role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    const response = await POST(postRequest(MANUAL_BODY));

    expect(response.status).toBe(200);
    expect(application.registerCompetitorSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        competitorName: "Rival Cafe",
        collectionMode: "manual",
        activeFrom: "2026-09-01",
      }),
    );
  });

  it("denies an automated source to a write-only role and allows owner", async () => {
    const automated = { ...MANUAL_BODY, collectionMode: "automated" };
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    expect((await POST(postRequest(automated))).status).toBe(403);
    expect(application.registerCompetitorSource).not.toHaveBeenCalled();

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    vi.mocked(application.registerCompetitorSource).mockResolvedValue(
      sourceRecord({ collectionMode: "automated", termsStatus: "approved", approvedBy: USER }),
    );
    expect((await POST(postRequest(automated))).status).toBe(200);
  });

  it("returns 400 for a malformed body/source and for a DomainError", async () => {
    expect((await POST(postRequest({}))).status).toBe(400);
    expect((await POST(postRequest({ ...MANUAL_BODY, sourceType: "bogus" }))).status).toBe(400);
    expect((await POST(postRequest({ ...MANUAL_BODY, activeFrom: "2026-09" }))).status).toBe(400);

    vi.mocked(application.registerCompetitorSource).mockRejectedValue(
      new DomainError("competitor source already exists for this organization"),
    );
    const response = await POST(postRequest(MANUAL_BODY));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "competitor source already exists for this organization",
    });
  });
});

describe("source parsers", () => {
  it("parses the active filter and bounds paging", () => {
    expect(parseCompetitorSourceListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 100, offset: 0 },
    });
    expect(parseCompetitorSourceListQuery(new URLSearchParams({ active: "false" }))).toEqual({
      ok: true,
      query: { active: false, limit: 100, offset: 0 },
    });
    expect(parseCompetitorSourceListQuery(new URLSearchParams({ active: "yes" })).ok).toBe(false);
  });

  it("parses a register body and rejects a missing mode or date", () => {
    expect(parseRegisterCompetitorSourceBody(MANUAL_BODY)).toEqual({
      ok: true,
      input: {
        competitorName: "Rival Cafe",
        competitorId: null,
        sourceType: "website",
        urlOrIdentifier: "https://rival.example/menu",
        collectionMode: "manual",
        rateLimitNote: null,
        activeFrom: "2026-09-01",
      },
    });
    expect(
      parseRegisterCompetitorSourceBody({ ...MANUAL_BODY, collectionMode: undefined }).ok,
    ).toBe(false);
    expect(parseRegisterCompetitorSourceBody({ ...MANUAL_BODY, activeFrom: "nope" }).ok).toBe(
      false,
    );
    expect(parseRegisterCompetitorSourceBody(undefined).ok).toBe(false);
  });
});
