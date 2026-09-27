import type { AiSuggestionRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresAiAdvisoryStore: vi.fn(() => ({})),
    listAiSuggestions: vi.fn(),
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

import { getServerSession } from "../../../../../lib/server-session";

import { parseAiSuggestionsQuery } from "../ai-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const SUGGESTION_ID = "55555555-5555-4555-8555-555555555555";
const PATH = "/api/v1/ai/suggestions";

function suggestionRecord(overrides: Partial<AiSuggestionRecord> = {}): AiSuggestionRecord {
  return {
    id: SUGGESTION_ID,
    organizationId: ORG,
    analysisRunId: RUN_ID,
    scopeType: "location",
    scopeRef: "11111111-1111-4111-8111-111111111111",
    suggestion: { note: "raise the croissant price" },
    state: "proposed",
    decidedBy: null,
    decidedAt: null,
    reason: null,
    createdAt: new Date("2026-09-27T09:00:00.000Z"),
    createdBy: USER,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    state: "proposed",
    scopeType: "location",
    scopeRef: "11111111-1111-4111-8111-111111111111",
    suggestion: { note: "raise the croissant price" },
    runId: RUN_ID,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    createdAt: "2026-09-27T09:00:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresAiAdvisoryStore).mockReturnValue({} as never);
  vi.mocked(application.listAiSuggestions).mockResolvedValue([suggestionRecord()]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/ai/suggestions", () => {
  it("returns the org-scoped review queue without raw snapshot or cost", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listAiSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
    const body = (await response.json()) as { rows: Record<string, unknown>[] };
    expect(body).toEqual({ ok: true, limit: 50, offset: 0, rows: [row()] });
    expect(body.rows[0]).not.toHaveProperty("inputSnapshot");
    expect(body.rows[0]).not.toHaveProperty("output");
    expect(body.rows[0]).not.toHaveProperty("costEstimate");
  });

  it("passes the state filter and paging through", async () => {
    const response = await GET(getRequest("?state=rejected&limit=10&offset=5"));
    expect(response.status).toBe(200);
    expect(application.listAiSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "rejected", limit: 10, offset: 5 }),
    );
  });

  it("returns 401 when signed out and 403 for a denied role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);
  });

  it.each(["owner", "general_manager", "finance", "admin"])("allows %s to read", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
    expect((await GET(getRequest())).status).toBe(200);
  });

  it.each(["?state=archived", "?limit=0", "?limit=abc", "?offset=-1", "?offset=9999"])(
    "returns 400 for the malformed query %j",
    async (query) => {
      expect((await GET(getRequest(query))).status).toBe(400);
      expect(application.listAiSuggestions).not.toHaveBeenCalled();
    },
  );
});

describe("parseAiSuggestionsQuery", () => {
  it("parses the filter and paging", () => {
    const parsed = parseAiSuggestionsQuery(new URLSearchParams({ state: "proposed", limit: "10" }));
    expect(parsed.ok && parsed.query).toEqual({ state: "proposed", limit: 10, offset: 0 });
  });

  it("rejects an unknown state and an out-of-range limit", () => {
    expect(parseAiSuggestionsQuery(new URLSearchParams({ state: "archived" })).ok).toBe(false);
    expect(parseAiSuggestionsQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseAiSuggestionsQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
  });
});
