import type { PayrollReportRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    DEFAULT_PAYROLL_REPORT_LIMIT: 50,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    markPayrollReportExported: vi.fn(),
    loadUserAccess: vi.fn(),
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

import { parseMarkPayrollReportExportedBody } from "../../../workforce-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const EXPORT_FILE_ID = "66666666-6666-4666-8666-666666666666";
const PERIOD_START = "2026-03-01";
const PERIOD_END = "2026-04-01";
const PATH = `/api/v1/workforce/payroll-reports/${REPORT_ID}/export`;

function reportRecord(overrides: Partial<PayrollReportRecord> = {}): PayrollReportRecord {
  return {
    id: REPORT_ID,
    organizationId: ORG,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    generatedAt: "2026-03-29T09:00:00.000Z",
    generatedBy: USER,
    status: "exported",
    snapshot: { lines: [] },
    exportFileId: EXPORT_FILE_ID,
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

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function postWithoutBody(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.markPayrollReportExported).mockResolvedValue(reportRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/workforce/payroll-reports/[id]/export", () => {
  it("marks the report exported with the export file for the session actor", async () => {
    const response = await POST(postRequest({ exportFileId: EXPORT_FILE_ID }), context());

    expect(response.status).toBe(200);
    expect(application.markPayrollReportExported).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        payrollReportId: REPORT_ID,
        actorId: USER,
        exportFileId: EXPORT_FILE_ID,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      payrollReport: { id: REPORT_ID, status: "exported", exportFileId: EXPORT_FILE_ID },
    });
  });

  it("marks the report exported with no file link when the body is absent", async () => {
    vi.mocked(application.markPayrollReportExported).mockResolvedValue(
      reportRecord({ exportFileId: null }),
    );

    const response = await POST(postWithoutBody(), context());

    expect(response.status).toBe(200);
    expect(application.markPayrollReportExported).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ exportFileId: expect.anything() }),
    );
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to mark a report exported",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({}), context());

      expect(response.status).toBe(200);
      expect(application.markPayrollReportExported).toHaveBeenCalled();
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not export a report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({}), context());

      expect(response.status).toBe(403);
      expect(application.markPayrollReportExported).not.toHaveBeenCalled();
    },
  );

  it.each([
    { exportFileId: "nope" },
    { exportFileId: "" },
    { exportFileId: null },
    { exportFileId: 1 },
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body), context());

    expect(response.status).toBe(400);
    expect(application.markPayrollReportExported).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest({}), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.markPayrollReportExported).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(401);
    expect(application.markPayrollReportExported).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.markPayrollReportExported).mockRejectedValue(
      new DomainError("report in status exported cannot be exported"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "report in status exported cannot be exported",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.markPayrollReportExported).mockRejectedValue(
      new NotFoundError("payroll report not found in organization"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(404);
  });
});

describe("parseMarkPayrollReportExportedBody", () => {
  it("parses a present exportFileId", () => {
    const parsed = parseMarkPayrollReportExportedBody({ exportFileId: EXPORT_FILE_ID });

    expect(parsed.ok && parsed.input).toEqual({ exportFileId: EXPORT_FILE_ID });
  });

  it.each([undefined, {}, { other: "field" }])(
    "treats the optional body %j as no file link",
    (body) => {
      const parsed = parseMarkPayrollReportExportedBody(
        body as Record<string, unknown> | undefined,
      );

      expect(parsed.ok && parsed.input).toEqual({});
    },
  );

  it.each([
    { exportFileId: "nope" },
    { exportFileId: "" },
    { exportFileId: null },
    { exportFileId: 1 },
  ])("rejects the malformed body %j", (body) => {
    expect(parseMarkPayrollReportExportedBody(body as Record<string, unknown>).ok).toBe(false);
  });
});
