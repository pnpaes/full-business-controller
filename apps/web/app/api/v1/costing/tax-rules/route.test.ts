import type { UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostingReadStore: vi.fn(() => ({})),
    listTaxRules: vi.fn(),
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

import { getDb } from "../../../../../lib/db";
import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RULE = "11111111-1111-4111-8111-111111111111";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCostingReadStore).mockReturnValue({} as never);
  vi.mocked(application.listTaxRules).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getDb).mockReturnValue({ db: {} } as never);
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/costing/tax-rules", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(application.listTaxRules).not.toHaveBeenCalled();
  });

  it("returns 403 for a role with no costing access (front_of_house)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listTaxRules).not.toHaveBeenCalled();
  });

  it("returns the organization's tax rules, ordered and org-scoped", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    vi.mocked(application.listTaxRules).mockResolvedValue([
      {
        id: RULE,
        organizationId: ORG,
        code: "NO_VAT_FOOD",
        name: "Food 15%",
        ratePct: "0.150000",
        taxBasis: "inclusive",
        taxTreatment: "channel_overridable",
        recoverable: false,
        appliesTo: "product",
        scopeType: "company_wide",
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(application.listTaxRules).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      limit: application.MAX_TAX_RULE_LIMIT,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      rows: [
        {
          id: RULE,
          code: "NO_VAT_FOOD",
          name: "Food 15%",
          ratePct: "0.150000",
          taxBasis: "inclusive",
          taxTreatment: "channel_overridable",
          recoverable: false,
          appliesTo: "product",
          scopeType: "company_wide",
        },
      ],
    });
  });
});
