import type { CompetitorSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    deactivateCompetitorSource: vi.fn(),
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
const PATH = `/api/v1/competitors/sources/${SOURCE_ID}/deactivate`;

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
    activeTo: "2026-12-31",
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

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.deactivateCompetitorSource).mockResolvedValue(sourceRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["location_manager"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/competitors/sources/[id]/deactivate", () => {
  it("deactivates with the session actor and the activeTo date", async () => {
    const response = await POST(postRequest({ activeTo: "2026-12-31" }), context);

    expect(response.status).toBe(200);
    expect(application.deactivateCompetitorSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        sourceId: SOURCE_ID,
        activeTo: "2026-12-31",
      }),
    );
  });

  it("denies a reader-less role, and returns 400/404 mappings", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    expect((await POST(postRequest({ activeTo: "2026-12-31" }), context)).status).toBe(403);
    expect(application.deactivateCompetitorSource).not.toHaveBeenCalled();

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["location_manager"]));
    expect((await POST(postRequest({ activeTo: "nope" }), context)).status).toBe(400);
    const badId = { params: Promise.resolve({ id: "nope" }) };
    expect((await POST(postRequest({ activeTo: "2026-12-31" }), badId)).status).toBe(400);

    vi.mocked(application.deactivateCompetitorSource).mockRejectedValue(
      new NotFoundError("competitor source not found in organization"),
    );
    expect((await POST(postRequest({ activeTo: "2026-12-31" }), context)).status).toBe(404);

    vi.mocked(application.deactivateCompetitorSource).mockRejectedValue(
      new DomainError("activeTo must be after activeFrom"),
    );
    expect((await POST(postRequest({ activeTo: "2026-12-31" }), context)).status).toBe(400);
  });
});
