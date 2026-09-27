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
    listJobs: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";
import * as persistence from "@aquarela/persistence";

import { getServerSession } from "../../../../lib/server-session";

import { DEFAULT_JOBS_LIMIT, parseJobsListQuery } from "./job-rows";
import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const PATH = "/api/v1/jobs";

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

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(persistence.listJobs).mockResolvedValue([jobRecord()]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/jobs", () => {
  it("lists the organization's jobs and omits payload/error", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(persistence.listJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        limit: DEFAULT_JOBS_LIMIT,
        offset: 0,
      }),
    );
    const body = (await response.json()) as { ok: boolean; rows: Record<string, unknown>[] };
    expect(body).toEqual({
      ok: true,
      limit: DEFAULT_JOBS_LIMIT,
      offset: 0,
      rows: [jobRow()],
    });
    expect(body.rows[0]).not.toHaveProperty("payload");
    expect(body.rows[0]).not.toHaveProperty("error");
  });

  it("passes the status filter and paging through", async () => {
    const response = await GET(getRequest("?status=dead_lettered&limit=10&offset=5"));

    expect(response.status).toBe(200);
    expect(persistence.listJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "dead_lettered",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to list jobs",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(persistence.listJobs).toHaveBeenCalled();
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read jobs",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(persistence.listJobs).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(persistence.listJobs).not.toHaveBeenCalled();
  });

  it.each(["?status=bogus", "?status=", "?limit=0", "?limit=201", "?offset=201", "?limit=abc"])(
    "returns 400 for the malformed query %j",
    async (query) => {
      const response = await GET(getRequest(query));

      expect(response.status).toBe(400);
      expect(persistence.listJobs).not.toHaveBeenCalled();
    },
  );
});

describe("parseJobsListQuery", () => {
  it("parses the optional status filter and paging", () => {
    const parsed = parseJobsListQuery(
      new URLSearchParams({ status: "failed", limit: "25", offset: "2" }),
    );

    expect(parsed.ok && parsed.query).toEqual({ status: "failed", limit: 25, offset: 2 });
  });

  it("defaults the page to the module limit and offset 0", () => {
    const parsed = parseJobsListQuery(new URLSearchParams());

    expect(parsed.ok && parsed.query).toEqual({ limit: DEFAULT_JOBS_LIMIT, offset: 0 });
  });

  it.each([
    new URLSearchParams({ status: "bogus" }),
    new URLSearchParams({ status: "" }),
    new URLSearchParams({ limit: "0" }),
    new URLSearchParams({ limit: "201" }),
    new URLSearchParams({ offset: "201" }),
    new URLSearchParams({ limit: "-1" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseJobsListQuery(searchParams).ok).toBe(false);
  });
});
