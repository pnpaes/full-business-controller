import type { CompetitorSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    updateCompetitorSource: vi.fn(),
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

import { PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";

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
    updatedAt: "2026-09-02T09:00:00.000Z",
    updatedBy: USER,
    version: 2,
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

const context = { params: Promise.resolve({ id: SOURCE_ID }) };

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/v1/competitors/sources/${SOURCE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.updateCompetitorSource).mockResolvedValue(sourceRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("PATCH /api/v1/competitors/sources/[id]", () => {
  it("allows a write-role URL / rate-limit / mode→manual edit", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));

    const response = await PATCH(
      patchRequest({ urlOrIdentifier: "https://rival.example/menu-2", rateLimitNote: "1 req/s" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(application.updateCompetitorSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        sourceId: SOURCE_ID,
        urlOrIdentifier: "https://rival.example/menu-2",
        rateLimitNote: "1 req/s",
      }),
    );

    vi.mocked(application.updateCompetitorSource).mockClear();
    expect((await PATCH(patchRequest({ collectionMode: "manual" }), context)).status).toBe(200);
    expect(application.updateCompetitorSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ collectionMode: "automated" }),
    );
  });

  it("denies a write-role switch to automated and a read-only role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    expect((await PATCH(patchRequest({ collectionMode: "automated" }), context)).status).toBe(403);

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    expect(
      (await PATCH(patchRequest({ urlOrIdentifier: "https://x.example/menu" }), context)).status,
    ).toBe(403);
    expect(application.updateCompetitorSource).not.toHaveBeenCalled();
  });

  it("allows an owner (terms role) to switch to automated", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    expect((await PATCH(patchRequest({ collectionMode: "automated" }), context)).status).toBe(200);
    expect(application.updateCompetitorSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collectionMode: "automated" }),
    );
  });

  it("returns 400 for a non-UUID id and a malformed/empty body", async () => {
    expect(
      (
        await PATCH(patchRequest({ collectionMode: "manual" }), {
          params: Promise.resolve({ id: "nope" }),
        })
      ).status,
    ).toBe(400);
    expect((await PATCH(patchRequest({}), context)).status).toBe(400);
    expect((await PATCH(patchRequest({ collectionMode: "bogus" }), context)).status).toBe(400);
    expect((await PATCH(patchRequest({ urlOrIdentifier: "   " }), context)).status).toBe(400);
  });

  it("maps NotFound to 404 and DomainError to 400", async () => {
    vi.mocked(application.updateCompetitorSource).mockRejectedValue(
      new NotFoundError("competitor source not found in organization"),
    );
    expect((await PATCH(patchRequest({ collectionMode: "manual" }), context)).status).toBe(404);

    vi.mocked(application.updateCompetitorSource).mockRejectedValue(
      new DomainError("switching to automated requires approved terms"),
    );
    expect((await PATCH(patchRequest({ collectionMode: "automated" }), context)).status).toBe(400);
  });
});
