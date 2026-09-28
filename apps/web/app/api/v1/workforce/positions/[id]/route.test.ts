import type { PositionRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    findPosition: vi.fn(),
    updatePosition: vi.fn(),
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
import { getServerSession } from "../../../../../../lib/server-session";

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const POSITION_ID = "77777777-7777-4777-8777-777777777777";

function positionRecord(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: POSITION_ID,
    organizationId: ORG,
    code: "barista",
    name: "Barista",
    activeFrom: "2026-01-01",
    activeTo: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function params(): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id: POSITION_ID }) };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/v1/workforce/positions/${POSITION_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.findPosition).mockResolvedValue(positionRecord());
  vi.mocked(application.updatePosition).mockResolvedValue(
    positionRecord({ activeTo: "2026-06-30" }),
  );
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/positions/[id]", () => {
  it("returns the position", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/workforce/positions/${POSITION_ID}`),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      position: { id: POSITION_ID },
    });
  });

  it("returns 404 for a scoped miss and 400 for a non-uuid id", async () => {
    vi.mocked(application.findPosition).mockResolvedValue(undefined);
    expect(
      (
        await GET(
          new Request(`http://localhost/api/v1/workforce/positions/${POSITION_ID}`),
          params(),
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await GET(new Request("http://localhost/api/v1/workforce/positions/nope"), {
          params: Promise.resolve({ id: "nope" }),
        })
      ).status,
    ).toBe(400);
  });
});

describe("PATCH /api/v1/workforce/positions/[id]", () => {
  it("deactivates a position with activeTo", async () => {
    const response = await PATCH(patchRequest({ activeTo: "2026-06-30" }), params());

    expect(response.status).toBe(200);
    expect(application.updatePosition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        positionId: POSITION_ID,
        activeTo: "2026-06-30",
      }),
    );
  });

  it("rejects a malformed body with 400", async () => {
    expect((await PATCH(patchRequest({ activeFrom: "nope" }), params())).status).toBe(400);
    expect((await PATCH(patchRequest({ code: 7 }), params())).status).toBe(400);
    expect(application.updatePosition).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to 404 and a DomainError to 400", async () => {
    vi.mocked(application.updatePosition).mockRejectedValue(new NotFoundError("missing"));
    expect((await PATCH(patchRequest({ name: "X" }), params())).status).toBe(404);

    vi.mocked(application.updatePosition).mockRejectedValue(new DomainError("clash"));
    expect((await PATCH(patchRequest({ name: "X" }), params())).status).toBe(400);
  });

  it("returns 403 for a role outside the write set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["cleaner"]));

    expect((await PATCH(patchRequest({ name: "X" }), params())).status).toBe(403);
    expect(application.updatePosition).not.toHaveBeenCalled();
  });
});
