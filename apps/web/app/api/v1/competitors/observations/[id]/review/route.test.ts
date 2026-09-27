import type { CompetitorObservationRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    reviewCompetitorObservation: vi.fn(),
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
const OBSERVATION_ID = "66666666-6666-4666-8666-666666666666";
const PATH = `/api/v1/competitors/observations/${OBSERVATION_ID}/review`;

function observationRecord(
  overrides: Partial<CompetitorObservationRecord> = {},
): CompetitorObservationRecord {
  return {
    id: OBSERVATION_ID,
    organizationId: ORG,
    competitorId: "55555555-5555-4555-8555-555555555555",
    observedAt: "2026-03-05T09:30:00.000Z",
    source: "menu photo",
    sourceUrl: null,
    itemId: null,
    externalName: "Flat White",
    price: null,
    currency: null,
    offerNotes: null,
    reviewStatus: "reviewed",
    reviewedBy: USER,
    reviewedAt: "2026-03-06T09:00:00.000Z",
    competitorSourceId: null,
    captureMethod: null,
    productCategory: null,
    season: null,
    provenance: {},
    contentHash: null,
    createdAt: "2026-03-05T09:30:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

const context = { params: Promise.resolve({ id: OBSERVATION_ID }) };

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.reviewCompetitorObservation).mockResolvedValue(observationRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/competitors/observations/[id]/review", () => {
  it("decides with the session actor", async () => {
    const response = await POST(postRequest({ decision: "reviewed" }), context);

    expect(response.status).toBe(200);
    expect(application.reviewCompetitorObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorId: USER, decision: "reviewed" }),
    );
  });

  it("returns 400 for a malformed decision and a non-UUID id", async () => {
    expect((await POST(postRequest({ decision: "maybe" }), context)).status).toBe(400);

    const badIdContext = { params: Promise.resolve({ id: "nope" }) };
    expect((await POST(postRequest({ decision: "reviewed" }), badIdContext)).status).toBe(400);
  });

  it("returns 403 for a role that may not review", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    expect((await POST(postRequest({ decision: "reviewed" }), context)).status).toBe(403);
  });

  it("returns 404 for a missing observation and 400 for an already-decided one", async () => {
    vi.mocked(application.reviewCompetitorObservation).mockRejectedValue(
      new NotFoundError("competitor observation not found in organization"),
    );
    expect((await POST(postRequest({ decision: "reviewed" }), context)).status).toBe(404);

    vi.mocked(application.reviewCompetitorObservation).mockRejectedValue(
      new DomainError("competitor observation is already reviewed and cannot be decided again"),
    );
    const response = await POST(postRequest({ decision: "rejected" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "competitor observation is already reviewed and cannot be decided again",
    });
  });
});
