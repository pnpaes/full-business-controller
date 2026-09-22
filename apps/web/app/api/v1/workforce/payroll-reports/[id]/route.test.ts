import type { PayrollReportRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    DEFAULT_PAYROLL_REPORT_LIMIT: 50,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    findPayrollReport: vi.fn(),
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

import { getServerSession } from "../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const PERIOD_START = "2026-03-01";
const PERIOD_END = "2026-04-01";
const PATH = `/api/v1/workforce/payroll-reports/${REPORT_ID}`;

function reportRecord(overrides: Partial<PayrollReportRecord> = {}): PayrollReportRecord {
  return {
    id: REPORT_ID,
    organizationId: ORG,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    generatedAt: "2026-03-29T09:00:00.000Z",
    generatedBy: USER,
    status: "generated",
    snapshot: { lines: [] },
    exportFileId: null,
    createdAt: "2026-03-29T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = REPORT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.findPayrollReport).mockResolvedValue(reportRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/workforce/payroll-reports/[id]", () => {
  it("returns one payroll report", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findPayrollReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, payrollReportId: REPORT_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      payrollReport: {
        id: REPORT_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        generatedAt: "2026-03-29T09:00:00.000Z",
        generatedBy: USER,
        status: "generated",
        snapshot: { lines: [] },
        exportFileId: null,
        createdAt: "2026-03-29T09:00:00.000Z",
        updatedAt: null,
      },
    });
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to read one report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read payroll-input reports",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(application.findPayrollReport).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown report", async () => {
    vi.mocked(application.findPayrollReport).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findPayrollReport).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findPayrollReport).not.toHaveBeenCalled();
  });
});
