import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCorrectSalesLineStore: vi.fn(() => ({})),
    correctSalesLine: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({ requireSession: vi.fn() }));
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
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const REVERSAL_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/sales/lines/${LINE_ID}/reverse`;

function context(id: string = LINE_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCorrectSalesLineStore).mockReturnValue({} as never);
  vi.mocked(application.correctSalesLine).mockResolvedValue({
    reversalSalesLineId: REVERSAL_ID,
    reversedMovementIds: ["movement-1", "movement-2"],
    revaluationMovementIds: ["movement-3"],
  });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/sales/lines/[id]/reverse", () => {
  it("reverses the line for the session actor", async () => {
    const response = await POST(postRequest({ reasonCode: "wrong entry" }), context());

    expect(response.status).toBe(200);
    expect(application.correctSalesLine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        salesLineId: LINE_ID,
        reasonCode: "wrong entry",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reversalSalesLineId: REVERSAL_ID,
      reversedMovementIds: ["movement-1", "movement-2"],
      revaluationMovementIds: ["movement-3"],
    });
  });

  it("returns 400 for a missing reasonCode", async () => {
    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(400);
    expect(application.correctSalesLine).not.toHaveBeenCalled();
  });

  it("returns 400 for a blank reasonCode", async () => {
    const response = await POST(postRequest({ reasonCode: "   " }), context());

    expect(response.status).toBe(400);
    expect(application.correctSalesLine).not.toHaveBeenCalled();
  });

  it("returns 400 for a reasonCode longer than 200 characters", async () => {
    const response = await POST(postRequest({ reasonCode: "x".repeat(201) }), context());

    expect(response.status).toBe(400);
    expect(application.correctSalesLine).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest({ reasonCode: "wrong entry" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.correctSalesLine).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.correctSalesLine).mockRejectedValue(
      new DomainError("sales line is already reversed"),
    );

    const response = await POST(postRequest({ reasonCode: "wrong entry" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "sales line is already reversed" });
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ reasonCode: "wrong entry" }), context());

    expect(response.status).toBe(401);
    expect(application.correctSalesLine).not.toHaveBeenCalled();
  });
});
