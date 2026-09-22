import type { PeriodCloseRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresPeriodCloseStore: vi.fn(() => ({})),
    findPeriodClose: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const CLOSE_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const DAY = "2026-03-05";

function closeRecord(overrides: Partial<PeriodCloseRecord> = {}): PeriodCloseRecord {
  return {
    id: CLOSE_ID,
    organizationId: ORG,
    scopeType: "location",
    scopeId: LOCATION_ID,
    periodStart: DAY,
    periodEnd: DAY,
    status: "locked",
    checklist: [],
    snapshot: { schemaVersion: 1 },
    correctionPolicy: null,
    lockedBy: USER,
    lockedAt: "2026-03-05T22:00:00.000Z",
    reopenedBy: null,
    reopenedAt: null,
    reopenReason: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresPeriodCloseStore).mockReturnValue({} as never);
  vi.mocked(application.findPeriodClose).mockResolvedValue(closeRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/period-closes/[id]", () => {
  it("returns the close", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/period-closes/${CLOSE_ID}`),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, periodClose: row() });
    expect(application.findPeriodClose).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, periodCloseId: CLOSE_ID }),
    );
  });

  it.each(["kitchen", "purchasing"])("returns 403 for %s", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(new Request("http://localhost/api/v1/period-closes/x"), context());

    expect(response.status).toBe(403);
    expect(application.findPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a location-scoped caller outside the close's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION_ID]),
    );

    const response = await GET(new Request("http://localhost/api/v1/period-closes/x"), context());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a missing close", async () => {
    vi.mocked(application.findPeriodClose).mockResolvedValue(undefined);

    const response = await GET(new Request("http://localhost/api/v1/period-closes/x"), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/period-closes/x"),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(application.findPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(new Request("http://localhost/api/v1/period-closes/x"), context());

    expect(response.status).toBe(401);
    expect(application.findPeriodClose).not.toHaveBeenCalled();
  });
});
