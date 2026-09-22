import type { AdjustmentPeriodRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresAdjustmentPeriodStore: vi.fn(() => ({})),
    findAdjustmentPeriod: vi.fn(),
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
const PERIOD_ID = "55555555-5555-4555-8555-555555555555";
const FROM = "2026-03-01";
const TO = "2026-03-05";

function periodRecord(overrides: Partial<AdjustmentPeriodRecord> = {}): AdjustmentPeriodRecord {
  return {
    id: PERIOD_ID,
    organizationId: ORG,
    openedFrom: FROM,
    openedTo: TO,
    reason: "late corrections",
    approvedBy: USER,
    approvedAt: "2026-03-06T10:00:00.000Z",
    status: "open",
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<AdjustmentPeriodRecord> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...periodRecord(overrides) };
  delete record.organizationId;
  return record;
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = PERIOD_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresAdjustmentPeriodStore).mockReturnValue({} as never);
  vi.mocked(application.findAdjustmentPeriod).mockResolvedValue(periodRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/adjustment-periods/[id]", () => {
  it("returns the adjustment period", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/adjustment-periods/${PERIOD_ID}`),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, adjustmentPeriod: row() });
    expect(application.findAdjustmentPeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, adjustmentPeriodId: PERIOD_ID }),
    );
  });

  it.each(["kitchen", "purchasing"])("returns 403 for %s", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(
      new Request("http://localhost/api/v1/adjustment-periods/x"),
      context(),
    );

    expect(response.status).toBe(403);
    expect(application.findAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing adjustment period", async () => {
    vi.mocked(application.findAdjustmentPeriod).mockResolvedValue(undefined);

    const response = await GET(
      new Request("http://localhost/api/v1/adjustment-periods/x"),
      context(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/adjustment-periods/x"),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(application.findAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(
      new Request("http://localhost/api/v1/adjustment-periods/x"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(application.findAdjustmentPeriod).not.toHaveBeenCalled();
  });
});
