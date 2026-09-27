import type { CompetitorSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    rejectCompetitorSourceTerms: vi.fn(),
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

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const PATH = `/api/v1/competitors/sources/${SOURCE_ID}/reject-terms`;

function sourceRecord(overrides: Partial<CompetitorSourceRecord> = {}): CompetitorSourceRecord {
  return {
    id: SOURCE_ID,
    organizationId: ORG,
    competitorName: "Rival Cafe",
    competitorId: null,
    sourceType: "website",
    urlOrIdentifier: "https://rival.example/menu",
    collectionMode: "manual",
    termsStatus: "rejected",
    approvedBy: USER,
    approvedAt: "2026-09-02T09:00:00.000Z",
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

function postRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.rejectCompetitorSourceTerms).mockResolvedValue(sourceRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/competitors/sources/[id]/reject-terms", () => {
  it("rejects with the session actor", async () => {
    const response = await POST(postRequest(), context);

    expect(response.status).toBe(200);
    expect(application.rejectCompetitorSourceTerms).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorId: USER, sourceId: SOURCE_ID }),
    );
  });

  it("denies a location manager (write role, not terms) and returns 404/400 mappings", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["location_manager"]));
    expect((await POST(postRequest(), context)).status).toBe(403);
    expect(application.rejectCompetitorSourceTerms).not.toHaveBeenCalled();

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));
    vi.mocked(application.rejectCompetitorSourceTerms).mockRejectedValue(
      new NotFoundError("competitor source not found in organization"),
    );
    expect((await POST(postRequest(), context)).status).toBe(404);

    vi.mocked(application.rejectCompetitorSourceTerms).mockRejectedValue(
      new DomainError(
        "an automated source requires approved terms; deactivate it instead of rejecting",
      ),
    );
    const response = await POST(postRequest(), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "an automated source requires approved terms; deactivate it instead of rejecting",
    });
  });
});
