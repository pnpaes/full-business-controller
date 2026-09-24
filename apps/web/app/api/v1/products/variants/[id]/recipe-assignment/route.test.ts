import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductStore: vi.fn(() => ({})),
    assignRecipeToVariant: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const VARIANT_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

const context = { params: Promise.resolve({ id: VARIANT_ID }) };

function request(body: unknown, sameOrigin = true): Request {
  return new Request(`http://localhost/api/v1/products/variants/${VARIANT_ID}/recipe-assignment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresProductStore).mockReturnValue({} as never);
  vi.mocked(application.assignRecipeToVariant).mockResolvedValue({ assignmentId: "assignment-1" });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/products/variants/[id]/recipe-assignment", () => {
  it("assigns a version in the supplied window", async () => {
    const response = await POST(
      request({
        locationId: LOCATION_ID,
        recipeVersionId: VERSION_ID,
        effectiveFrom: "2026-01-01",
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(application.assignRecipeToVariant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        productVariantId: VARIANT_ID,
        locationId: LOCATION_ID,
        recipeVersionId: VERSION_ID,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, assignmentId: "assignment-1" });
  });

  it("returns 403 cross-origin, 400 for a bad body, 401 when signed out", async () => {
    const body = {
      locationId: LOCATION_ID,
      recipeVersionId: VERSION_ID,
      effectiveFrom: "2026-01-01",
    };
    expect((await POST(request(body, false), context)).status).toBe(403);
    expect((await POST(request({ locationId: LOCATION_ID }), context)).status).toBe(400);
    expect((await POST(request(body), { params: Promise.resolve({ id: "nope" }) })).status).toBe(
      400,
    );
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(request(body), context)).status).toBe(401);
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.assignRecipeToVariant).mockRejectedValue(
      new DomainError("recipe version must be approved before it can be assigned"),
    );
    const response = await POST(
      request({
        locationId: LOCATION_ID,
        recipeVersionId: VERSION_ID,
        effectiveFrom: "2026-01-01",
      }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "recipe version must be approved before it can be assigned",
    });
  });
});
