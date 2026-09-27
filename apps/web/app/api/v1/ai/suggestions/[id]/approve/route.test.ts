import type { AiSuggestionRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresAiAdvisoryStore: vi.fn(() => ({})),
    decideAiSuggestion: vi.fn(),
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
vi.mock("../../../limiters", () => ({
  aiLimiters: {
    decideSuggestion: { check: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) },
  },
}));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const SUGGESTION_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/ai/suggestions/${SUGGESTION_ID}/approve`;

function suggestionRecord(overrides: Partial<AiSuggestionRecord> = {}): AiSuggestionRecord {
  return {
    id: SUGGESTION_ID,
    organizationId: ORG,
    analysisRunId: RUN_ID,
    scopeType: "location",
    scopeRef: "11111111-1111-4111-8111-111111111111",
    suggestion: { note: "raise the croissant price" },
    state: "approved",
    decidedBy: USER,
    decidedAt: new Date("2026-09-27T10:00:00.000Z"),
    reason: null,
    createdAt: new Date("2026-09-27T09:00:00.000Z"),
    createdBy: USER,
    updatedAt: new Date("2026-09-27T10:00:00.000Z"),
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function suggestionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    state: "approved",
    scopeType: "location",
    scopeRef: "11111111-1111-4111-8111-111111111111",
    suggestion: { note: "raise the croissant price" },
    runId: RUN_ID,
    decidedBy: USER,
    decidedAt: "2026-09-27T10:00:00.000Z",
    reason: null,
    createdAt: "2026-09-27T09:00:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = SUGGESTION_ID): {
  readonly params: Promise<{ readonly id: string }>;
} {
  return { params: Promise.resolve({ id }) };
}

function postRequest(id: string = SUGGESTION_ID): Request {
  return new Request(`http://localhost/api/v1/ai/suggestions/${id}/approve`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresAiAdvisoryStore).mockReturnValue({} as never);
  vi.mocked(application.decideAiSuggestion).mockResolvedValue(suggestionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/ai/suggestions/[id]/approve", () => {
  it("approves the suggestion and states the advisory-only posture", async () => {
    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(application.decideAiSuggestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        suggestionId: SUGGESTION_ID,
        decision: "approved",
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, advisoryOnly: true, suggestion: suggestionRow() });
    expect(body.suggestion).not.toHaveProperty("inputSnapshot");
    expect(body.suggestion).not.toHaveProperty("costEstimate");
    expect(body.suggestion).not.toHaveProperty("organizationId");
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to approve", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
    expect((await POST(postRequest(), context())).status).toBe(200);
    expect(application.decideAiSuggestion).toHaveBeenCalled();
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not decide",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
      const response = await POST(postRequest(), context());
      expect(response.status).toBe(403);
      expect(application.decideAiSuggestion).not.toHaveBeenCalled();
    },
  );

  it("returns 403 for a non-same-origin mutation", async () => {
    const request = new Request(`http://localhost${PATH}`, { method: "POST" });
    expect((await POST(request, context())).status).toBe(403);
    expect(application.decideAiSuggestion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id and 401 when signed out", async () => {
    expect((await POST(postRequest("not-a-uuid"), context("not-a-uuid"))).status).toBe(400);
    expect(application.decideAiSuggestion).not.toHaveBeenCalled();

    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(postRequest(), context())).status).toBe(401);
  });

  it("maps a typed NotFoundError to 404 and a wrong-state DomainError to 400", async () => {
    vi.mocked(application.decideAiSuggestion).mockRejectedValue(
      new NotFoundError(`suggestion ${SUGGESTION_ID} not found in this organization`),
    );
    expect((await POST(postRequest(), context())).status).toBe(404);

    vi.mocked(application.decideAiSuggestion).mockRejectedValue(
      new DomainError(`suggestion ${SUGGESTION_ID} is not proposed (state "rejected")`),
    );
    const response = await POST(postRequest(), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `suggestion ${SUGGESTION_ID} is not proposed (state "rejected")`,
    });
  });
});
