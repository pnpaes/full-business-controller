import type { CorrectiveActionRecord, IncidentRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findCorrectiveAction: vi.fn(),
    findIncident: vi.fn(),
    updateCorrectiveAction: vi.fn(),
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
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../lib/errors";
import { getServerSession } from "../../../../../../lib/server-session";

import { PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/hms/corrective-actions/${ACTION_ID}`;

function incidentRecord(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: INCIDENT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    category: "near_miss",
    severity: "medium",
    occurredAt: "2026-02-01T07:00:00.000Z",
    reportedAt: "2026-02-01T08:00:00.000Z",
    reportedBy: USER,
    ownerId: null,
    title: "Slipped on wet floor",
    description: null,
    dueDate: null,
    involvesPersonalData: false,
    status: "open",
    closedAt: null,
    createdAt: "2026-02-01T08:00:01.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function actionRecord(overrides: Partial<CorrectiveActionRecord> = {}): CorrectiveActionRecord {
  return {
    id: ACTION_ID,
    organizationId: ORG,
    incidentId: INCIDENT_ID,
    monitoringReadingId: null,
    description: "Re-train staff on wet-floor signage",
    ownerId: null,
    dueDate: null,
    status: "open",
    completedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    createdAt: "2026-02-01T09:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = ACTION_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findCorrectiveAction).mockResolvedValue(actionRecord());
  vi.mocked(application.findIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.updateCorrectiveAction).mockResolvedValue(actionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("PATCH /api/v1/hms/corrective-actions/[id]", () => {
  it("advances an action for the session actor", async () => {
    vi.mocked(application.updateCorrectiveAction).mockResolvedValue(
      actionRecord({ status: "in_progress" }),
    );

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(200);
    expect(application.updateCorrectiveAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        correctiveActionId: ACTION_ID,
        status: "in_progress",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      correctiveAction: { status: "in_progress" },
    });
  });

  it("lets kitchen mark an action in_progress", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(200);
    expect(application.updateCorrectiveAction).toHaveBeenCalled();
  });

  it("lets front_of_house mark an action done", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await PATCH(patchRequest({ status: "done" }), context());

    expect(response.status).toBe(200);
    expect(application.updateCorrectiveAction).toHaveBeenCalled();
  });

  it("returns 403 when kitchen tries to verify an action", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ status: "verified" }), context());

    expect(response.status).toBe(403);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 403 when front_of_house tries to verify an action", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await PATCH(patchRequest({ status: "verified" }), context());

    expect(response.status).toBe(403);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("lets a location_manager scoped to the incident's location verify", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await PATCH(patchRequest({ status: "verified" }), context());

    expect(response.status).toBe(200);
    expect(application.updateCorrectiveAction).toHaveBeenCalled();
  });

  it("lets a scoped kitchen role progress an action at its own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"], [LOCATION]));

    const response = await PATCH(patchRequest({ status: "done" }), context());

    expect(response.status).toBe(200);
    expect(application.updateCorrectiveAction).toHaveBeenCalled();
  });

  it("denies a scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(403);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 404 for a scoped caller's unknown action", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findCorrectiveAction).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(404);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("denies a scoped caller a reading-linked action it cannot scope-check", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findCorrectiveAction).mockResolvedValue(
      actionRecord({ incidentId: null, monitoringReadingId: "reading-1" }),
    );

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(403);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(403);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const response = await PATCH(patchRequest({ description: "" }), context());

    expect(response.status).toBe(400);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ status: "in_progress" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await PATCH(patchRequest({ status: "in_progress" }), context());

    expect(response.status).toBe(401);
    expect(application.updateCorrectiveAction).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateCorrectiveAction).mockRejectedValue(
      new DomainError("status must be one of open, in_progress, done, verified"),
    );

    const response = await PATCH(patchRequest({ status: "nope" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "status must be one of open, in_progress, done, verified",
    });
  });
});
