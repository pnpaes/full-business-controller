import type { PeriodCloseRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresPeriodCloseStore: vi.fn(() => ({})),
    findPeriodClose: vi.fn(),
    reopenPeriodClose: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../lib/errors";

import { parseReopenBody } from "../../period-close-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const CLOSE_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const DAY = "2026-03-05";
const PATH = `/api/v1/period-closes/${CLOSE_ID}/reopen`;

function closeRecord(overrides: Partial<PeriodCloseRecord> = {}): PeriodCloseRecord {
  return {
    id: CLOSE_ID,
    organizationId: ORG,
    scopeType: "location",
    scopeId: LOCATION_ID,
    periodStart: DAY,
    periodEnd: DAY,
    status: "reopened",
    checklist: [],
    snapshot: { schemaVersion: 1 },
    correctionPolicy: null,
    lockedBy: USER,
    lockedAt: "2026-03-05T23:00:00.000Z",
    reopenedBy: USER,
    reopenedAt: "2026-03-06T08:00:00.000Z",
    reopenReason: "correction",
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

function context(id: string = CLOSE_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
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
  vi.mocked(application.findPeriodClose).mockResolvedValue(closeRecord({ status: "locked" }));
  vi.mocked(application.reopenPeriodClose).mockResolvedValue(closeRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/period-closes/[id]/reopen", () => {
  it("reopens the close with the session actor and reason", async () => {
    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(200);
    expect(application.reopenPeriodClose).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        periodCloseId: CLOSE_ID,
        reason: "correction",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, periodClose: row() });
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to reopen a close",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ reason: "correction" }), context());

      expect(response.status).toBe(200);
      expect(application.reopenPeriodClose).toHaveBeenCalled();
    },
  );

  it.each(["location_manager", "front_of_house", "analyst"])(
    "returns 403 for %s, which may not reopen",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ reason: "correction" }), context());

      expect(response.status).toBe(403);
      expect(application.reopenPeriodClose).not.toHaveBeenCalled();
    },
  );

  it("returns 403 for a location-scoped caller outside the close's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["finance"], [OTHER_LOCATION_ID]),
    );

    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(403);
    expect(application.reopenPeriodClose).not.toHaveBeenCalled();
  });

  it.each([{}, { reason: "" }, { reason: "   " }, { reason: 42 }])(
    "returns 400 for the malformed body %j",
    async (body) => {
      const response = await POST(postRequest(body), context());

      expect(response.status).toBe(400);
      expect(application.reopenPeriodClose).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest({ reason: "correction" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.reopenPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 404 when the close does not exist", async () => {
    vi.mocked(application.findPeriodClose).mockResolvedValue(undefined);

    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(404);
    expect(application.reopenPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(401);
    expect(application.reopenPeriodClose).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.reopenPeriodClose).mockRejectedValue(
      new DomainError("period close in status closing cannot be reopened"),
    );

    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "period close in status closing cannot be reopened",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.reopenPeriodClose).mockRejectedValue(
      new NotFoundError("period close not found in organization"),
    );

    const response = await POST(postRequest({ reason: "correction" }), context());

    expect(response.status).toBe(404);
  });
});

describe("parseReopenBody", () => {
  it("parses a trimmed reason", () => {
    const parsed = parseReopenBody({ reason: "  correction  " });

    expect(parsed.ok && parsed.input).toEqual({ reason: "correction" });
  });

  it.each([undefined, {}, { reason: "" }, { reason: "   " }, { reason: 42 }])(
    "rejects the malformed body %j",
    (body) => {
      expect(parseReopenBody(body as Record<string, unknown> | undefined).ok).toBe(false);
    },
  );
});
