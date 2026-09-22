import type { PeriodCloseRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresPeriodCloseStore: vi.fn(() => ({})),
    findPeriodClose: vi.fn(),
    lockPeriodClose: vi.fn(),
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
const CLOSE_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const DAY = "2026-03-05";
const PATH = `/api/v1/period-closes/${CLOSE_ID}/lock`;

function closeRecord(overrides: Partial<PeriodCloseRecord> = {}): PeriodCloseRecord {
  return {
    id: CLOSE_ID,
    organizationId: ORG,
    scopeType: "location",
    scopeId: LOCATION_ID,
    periodStart: DAY,
    periodEnd: DAY,
    status: "closing",
    checklist: [],
    snapshot: { schemaVersion: 1 },
    correctionPolicy: null,
    lockedBy: null,
    lockedAt: null,
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

function postRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresPeriodCloseStore).mockReturnValue({} as never);
  vi.mocked(application.findPeriodClose).mockResolvedValue(closeRecord());
  vi.mocked(application.lockPeriodClose).mockResolvedValue(
    closeRecord({ status: "locked", lockedBy: USER, lockedAt: "2026-03-05T23:00:00.000Z" }),
  );
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/period-closes/[id]/lock", () => {
  it("locks the close for the session actor", async () => {
    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(application.lockPeriodClose).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorId: USER, periodCloseId: CLOSE_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      periodClose: row({ status: "locked", lockedBy: USER, lockedAt: "2026-03-05T23:00:00.000Z" }),
    });
  });

  it("returns 200 for an already-locked close (idempotent re-lock)", async () => {
    const alreadyLocked = closeRecord({
      status: "locked",
      lockedBy: USER,
      lockedAt: "2026-03-05T23:00:00.000Z",
    });
    vi.mocked(application.findPeriodClose).mockResolvedValue(alreadyLocked);
    vi.mocked(application.lockPeriodClose).mockResolvedValue(alreadyLocked);

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, periodClose: row(alreadyLocked) });
  });

  it("returns 403 for analyst, which may not lock", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(403);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a location-scoped caller outside the close's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION_ID]),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(403);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 403 for a location_manager locking a company close", async () => {
    vi.mocked(application.findPeriodClose).mockResolvedValue(
      closeRecord({
        scopeType: "company",
        scopeId: ORG,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
    );
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION_ID]),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(403);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing close", async () => {
    vi.mocked(application.findPeriodClose).mockResolvedValue(undefined);

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(404);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(401);
    expect(application.lockPeriodClose).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.lockPeriodClose).mockRejectedValue(
      new DomainError("period close in status reopened cannot be locked"),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "period close in status reopened cannot be locked",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.lockPeriodClose).mockRejectedValue(
      new NotFoundError("period close not found in organization"),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(404);
  });
});
