import type { AdjustmentPeriodRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresAdjustmentPeriodStore: vi.fn(() => ({})),
    closeAdjustmentPeriod: vi.fn(),
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

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PERIOD_ID = "55555555-5555-4555-8555-555555555555";
const FROM = "2026-03-01";
const TO = "2026-03-05";
const PATH = `/api/v1/adjustment-periods/${PERIOD_ID}/close`;

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

function postRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresAdjustmentPeriodStore).mockReturnValue({} as never);
  vi.mocked(application.closeAdjustmentPeriod).mockResolvedValue(
    periodRecord({ status: "closed", updatedAt: "2026-03-07T10:00:00.000Z" }),
  );
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/adjustment-periods/[id]/close", () => {
  it("closes the adjustment period for the session actor", async () => {
    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(application.closeAdjustmentPeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        adjustmentPeriodId: PERIOD_ID,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      adjustmentPeriod: row({ status: "closed", updatedAt: "2026-03-07T10:00:00.000Z" }),
    });
  });

  it("returns 200 for an already-closed period (idempotent re-close)", async () => {
    const closed = periodRecord({ status: "closed", updatedAt: "2026-03-07T10:00:00.000Z" });
    vi.mocked(application.closeAdjustmentPeriod).mockResolvedValue(closed);

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
  });

  it.each(["analyst", "location_manager", "front_of_house"])(
    "returns 403 for %s, which may not close an adjustment period",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(), context());

      expect(response.status).toBe(403);
      expect(application.closeAdjustmentPeriod).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a missing adjustment period", async () => {
    vi.mocked(application.closeAdjustmentPeriod).mockRejectedValue(
      new NotFoundError("adjustment period not found in organization"),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.closeAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(401);
    expect(application.closeAdjustmentPeriod).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.closeAdjustmentPeriod).mockRejectedValue(
      new DomainError("adjustment period cannot be closed"),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "adjustment period cannot be closed",
    });
  });
});
