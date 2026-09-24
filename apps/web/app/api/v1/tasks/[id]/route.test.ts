import type { TaskRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresTaskStore: vi.fn(() => ({})),
    findTask: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const TASK_ID = "55555555-5555-4555-8555-555555555555";

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: TASK_ID,
    organizationId: ORG,
    type: "follow_up",
    linkedEntityType: null,
    linkedEntityId: null,
    ownerId: null,
    dueDate: null,
    priority: "normal",
    status: "open",
    resolution: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresTaskStore).mockReturnValue({} as never);
  vi.mocked(application.findTask).mockResolvedValue(taskRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue({
    roles: ["owner"],
    locationIds: [],
  } satisfies UserAccess);
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/tasks/[id]", () => {
  it("returns the task, dropping the organization id", async () => {
    const response = await GET(new Request(`http://localhost${TASK_ID}`), context(TASK_ID));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly task: Record<string, unknown> };
    expect(body.task.id).toBe(TASK_ID);
    expect(body.task).not.toHaveProperty("organizationId");
    expect(application.findTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, taskId: TASK_ID }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(new Request("http://localhost"), context(TASK_ID));
    expect(response.status).toBe(401);
  });

  it("returns 403 for a caller with no role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue({ roles: [], locationIds: [] });

    const response = await GET(new Request("http://localhost"), context(TASK_ID));
    expect(response.status).toBe(403);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(new Request("http://localhost"), context("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(application.findTask).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization id", async () => {
    vi.mocked(application.findTask).mockResolvedValue(undefined);

    const response = await GET(new Request("http://localhost"), context(TASK_ID));
    expect(response.status).toBe(404);
  });
});
