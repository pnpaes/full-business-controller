import type { JobRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresJobStore: vi.fn(() => ({})),
    discardDeadLetteredJob: vi.fn(),
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
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/jobs/${JOB_ID}/discard`;

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: JOB_ID,
    organizationId: ORG,
    queue: "workforce.payroll_report.generate",
    kind: "workforce.payroll_report.generate",
    payload: { periodStart: "2026-03-01", periodEnd: "2026-04-01" },
    status: "failed",
    attempts: 5,
    maxAttempts: 5,
    scheduledAt: null,
    startedAt: new Date("2026-03-29T08:00:00.000Z"),
    finishedAt: new Date("2026-03-29T08:01:00.000Z"),
    error: "gave up",
    outboxEventId: "66666666-6666-4666-8666-666666666666",
    createdAt: new Date("2026-03-29T07:59:00.000Z"),
    updatedAt: new Date("2026-03-29T08:02:00.000Z"),
    ...overrides,
  };
}

function jobRow(): Record<string, unknown> {
  return {
    id: JOB_ID,
    status: "failed",
    kind: "workforce.payroll_report.generate",
    queue: "workforce.payroll_report.generate",
    attempts: 5,
    maxAttempts: 5,
    scheduledAt: null,
    startedAt: "2026-03-29T08:00:00.000Z",
    finishedAt: "2026-03-29T08:01:00.000Z",
    createdAt: "2026-03-29T07:59:00.000Z",
    updatedAt: "2026-03-29T08:02:00.000Z",
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = JOB_ID): { readonly params: Promise<{ readonly id: string }> } {
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
  vi.mocked(application.createPostgresJobStore).mockReturnValue({} as never);
  vi.mocked(application.discardDeadLetteredJob).mockResolvedValue(jobRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/jobs/[id]/discard", () => {
  it("discards the job for the session actor", async () => {
    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(application.discardDeadLetteredJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, jobId: JOB_ID, actorId: USER }),
    );
    const body = (await response.json()) as { ok: boolean; job: Record<string, unknown> };
    expect(body).toEqual({ ok: true, job: jobRow() });
    expect(body.job).not.toHaveProperty("payload");
    expect(body.job).not.toHaveProperty("error");
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to discard", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(200);
    expect(application.discardDeadLetteredJob).toHaveBeenCalled();
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not discard",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(), context());

      expect(response.status).toBe(403);
      expect(application.discardDeadLetteredJob).not.toHaveBeenCalled();
    },
  );

  it("returns 403 for a non-same-origin mutation", async () => {
    const request = new Request(`http://localhost${PATH}`, { method: "POST" });

    const response = await POST(request, context());

    expect(response.status).toBe(403);
    expect(application.discardDeadLetteredJob).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.discardDeadLetteredJob).not.toHaveBeenCalled();
  });

  it("maps a typed NotFoundError to an indistinguishable 404", async () => {
    vi.mocked(application.discardDeadLetteredJob).mockRejectedValue(
      new NotFoundError(`job ${JOB_ID} not found in this organization`),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(404);
  });

  it("maps a wrong-status DomainError to 400 with its message", async () => {
    vi.mocked(application.discardDeadLetteredJob).mockRejectedValue(
      new DomainError(`job ${JOB_ID} is not dead_lettered (status "pending")`),
    );

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `job ${JOB_ID} is not dead_lettered (status "pending")`,
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest(), context());

    expect(response.status).toBe(401);
    expect(application.discardDeadLetteredJob).not.toHaveBeenCalled();
  });
});
