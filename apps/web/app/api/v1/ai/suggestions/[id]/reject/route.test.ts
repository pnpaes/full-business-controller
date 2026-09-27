import type { AiSuggestionRecord, UserAccess } from "@aquarela/application";
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

import { parseDecisionReason } from "../../../ai-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const SUGGESTION_ID = "55555555-5555-4555-8555-555555555555";

function suggestionRecord(overrides: Partial<AiSuggestionRecord> = {}): AiSuggestionRecord {
  return {
    id: SUGGESTION_ID,
    organizationId: ORG,
    analysisRunId: RUN_ID,
    scopeType: "category",
    scopeRef: null,
    suggestion: { note: "drop the seasonal item" },
    state: "rejected",
    decidedBy: USER,
    decidedAt: new Date("2026-09-27T10:00:00.000Z"),
    reason: "not justified",
    createdAt: new Date("2026-09-27T09:00:00.000Z"),
    createdBy: USER,
    updatedAt: new Date("2026-09-27T10:00:00.000Z"),
    updatedBy: USER,
    version: 1,
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

function postRequest(body: unknown, id: string = SUGGESTION_ID): Request {
  return new Request(`http://localhost/api/v1/ai/suggestions/${id}/reject`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

describe("POST /api/v1/ai/suggestions/[id]/reject", () => {
  it("rejects with the reason and states the advisory-only posture", async () => {
    const response = await POST(postRequest({ reason: "not justified" }), context());

    expect(response.status).toBe(200);
    expect(application.decideAiSuggestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "rejected", reason: "not justified" }),
    );
    const body = (await response.json()) as { advisoryOnly: boolean; suggestion: unknown };
    expect(body.advisoryOnly).toBe(true);
    expect(body.suggestion).not.toHaveProperty("inputSnapshot");
  });

  it.each([{}, { reason: "" }, { reason: "   " }, { reason: 42 }, "not json"])(
    "returns 400 for the malformed body %j and never decides",
    async (body) => {
      const response = await POST(postRequest(body), context());
      expect(response.status).toBe(400);
      expect(application.decideAiSuggestion).not.toHaveBeenCalled();
    },
  );

  it("returns 403 for a role that may not decide", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));
    const response = await POST(postRequest({ reason: "nope" }), context());
    expect(response.status).toBe(403);
    expect(application.decideAiSuggestion).not.toHaveBeenCalled();
  });
});

describe("parseDecisionReason", () => {
  it("trims a valid reason and rejects blank/non-string bodies", () => {
    expect(parseDecisionReason({ reason: "  because  " })).toEqual({ ok: true, reason: "because" });
    expect(parseDecisionReason({})).toEqual({ ok: false });
    expect(parseDecisionReason({ reason: "  " })).toEqual({ ok: false });
    expect(parseDecisionReason(null)).toEqual({ ok: false });
  });
});
