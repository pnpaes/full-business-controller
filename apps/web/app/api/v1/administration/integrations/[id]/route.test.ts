import type { IntegrationSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresIntegrationSourceStore: vi.fn(() => ({})),
    registerIntegrationSource: vi.fn(),
    updateIntegrationSource: vi.fn(),
    listIntegrationSources: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";

import { PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/api/v1/administration/integrations/${SOURCE_ID}`;

const findById = vi.fn();

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function record(overrides: Partial<IntegrationSourceRecord> = {}): IntegrationSourceRecord {
  return {
    id: SOURCE_ID,
    organizationId: ORG,
    name: "Till",
    systemType: "pos",
    direction: "read",
    allowedOperations: ["read"],
    credentialsOwner: "Ada Lovelace",
    rateLimitNote: null,
    termsStatus: "pending",
    active: true,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Till",
  systemType: "pos",
  direction: "read",
  allowedOperations: ["read"],
  credentialsOwner: "Ada Lovelace",
  rateLimitNote: "60 requests/minute",
  termsStatus: "pending",
  active: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  findById.mockResolvedValue(record());
  vi.mocked(application.createPostgresIntegrationSourceStore).mockReturnValue({
    findIntegrationSourceById: findById,
  } as never);
  vi.mocked(application.updateIntegrationSource).mockResolvedValue({
    integrationSourceId: SOURCE_ID,
  });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("PATCH /api/v1/administration/integrations/[id]", () => {
  it("updates the source for the session actor and organization", async () => {
    const response = await PATCH(patchRequest(validBody), context(SOURCE_ID));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, integrationSourceId: SOURCE_ID });
    expect(application.updateIntegrationSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        integrationSourceId: SOURCE_ID,
        name: "Till",
        systemType: "pos",
        direction: "read",
        allowedOperations: ["read"],
        credentialsOwner: "Ada Lovelace",
        rateLimitNote: "60 requests/minute",
        termsStatus: "pending",
        active: false,
      }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest(validBody), context(SOURCE_ID));

    expect(response.status).toBe(401);
    expect(application.updateIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the owner/admin gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await PATCH(patchRequest(validBody), context(SOURCE_ID));

    expect(response.status).toBe(403);
    expect(application.updateIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest(validBody), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const badName = await PATCH(patchRequest({ ...validBody, name: "  " }), context(SOURCE_ID));
    expect(badName.status).toBe(400);

    const badOps = await PATCH(
      patchRequest({ ...validBody, allowedOperations: ["read", 3] }),
      context(SOURCE_ID),
    );
    expect(badOps.status).toBe(400);

    expect(application.updateIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization id", async () => {
    findById.mockResolvedValue(undefined);

    const response = await PATCH(patchRequest(validBody), context(SOURCE_ID));

    expect(response.status).toBe(404);
    expect(application.updateIntegrationSource).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.updateIntegrationSource).mockRejectedValue(
      new DomainError('integration source name "Till" already exists in this organization'),
    );

    const response = await PATCH(patchRequest(validBody), context(SOURCE_ID));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'integration source name "Till" already exists in this organization',
    });
  });
});
