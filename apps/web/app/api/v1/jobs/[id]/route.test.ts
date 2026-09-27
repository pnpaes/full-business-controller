import type { UserAccess } from "@aquarela/application";
import type { Job } from "@aquarela/persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    loadUserAccess: vi.fn(),
  };
});

vi.mock("@aquarela/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/persistence")>();
  return {
    ...actual,
    findJobById: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";
import * as persistence from "@aquarela/persistence";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/jobs/${JOB_ID}`;

function jobRecord(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    organizationId: ORG,
    queue: "outbox",
    kind: "outbox.replay",
    payload: { secret: "internal-routing" },
    status: "running",
    attempts: 2,
    maxAttempts: 5,
    scheduledAt: new Date("2026-03-29T08:00:00.000Z"),
    startedAt: new Date("2026-03-29T08:01:00.000Z"),
    finishedAt: null,
    error: "internal failure detail",
    outboxEventId: null,
    createdAt: new Date("2026-03-29T07:59:00.000Z"),
    createdBy: null,
    updatedAt: new Date("2026-03-29T08:01:00.000Z"),
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

function jobRow(): Record<string, unknown> {
  return {
    id: JOB_ID,
    status: "running",
    kind: "outbox.replay",
    queue: "outbox",
    attempts: 2,
    maxAttempts: 5,
    scheduledAt: "2026-03-29T08:00:00.000Z",
    startedAt: "2026-03-29T08:01:00.000Z",
    finishedAt: null,
    createdAt: "2026-03-29T07:59:00.000Z",
    updatedAt: "2026-03-29T08:01:00.000Z",
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = JOB_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(persistence.findJobById).mockResolvedValue(jobRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/jobs/[id]", () => {
  it("returns the job projection and omits payload/error", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(persistence.findJobById).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, jobId: JOB_ID }),
    );
    const body = (await response.json()) as { ok: boolean; job: Record<string, unknown> };
    expect(body).toEqual({ ok: true, job: jobRow() });
    expect(body.job).not.toHaveProperty("payload");
    expect(body.job).not.toHaveProperty("error");
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to read a job",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read jobs",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(persistence.findJobById).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(persistence.findJobById).not.toHaveBeenCalled();
  });

  it("returns an indistinguishable 404 for an unknown or other-organization id", async () => {
    vi.mocked(persistence.findJobById).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(persistence.findJobById).not.toHaveBeenCalled();
  });
});
