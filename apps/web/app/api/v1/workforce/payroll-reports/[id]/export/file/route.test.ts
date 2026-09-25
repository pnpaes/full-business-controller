import type {
  FileObjectRecord,
  PayrollReportRecord,
  StoredFile,
  UserAccess,
} from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findPayrollReport: vi.fn(),
    readFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID = "66666666-6666-4666-8666-666666666666";
const PATH = `/api/v1/workforce/payroll-reports/${REPORT_ID}/export/file`;

function reportRecord(overrides: Partial<PayrollReportRecord> = {}): PayrollReportRecord {
  return {
    id: REPORT_ID,
    organizationId: ORG,
    periodStart: "2026-03-01",
    periodEnd: "2026-04-01",
    generatedAt: "2026-03-29T09:00:00.000Z",
    generatedBy: USER,
    status: "exported",
    snapshot: { lines: [] },
    exportFileId: FILE_ID,
    createdAt: "2026-03-29T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function storedFile(overrides: Partial<FileObjectRecord> = {}): StoredFile {
  return {
    metadata: {
      id: FILE_ID,
      organizationId: ORG,
      storageKey: `${ORG}/key.csv`,
      filename: "payroll.csv",
      mime: "text/csv",
      sizeBytes: 3,
      checksumSha256: "a".repeat(64),
      retentionPolicy: "payroll_export",
      uploadedBy: USER,
      uploadedAt: "2026-03-29T09:00:00.000Z",
      linkedEntityType: "payroll_report",
      linkedEntityId: REPORT_ID,
      createdAt: "2026-03-29T09:00:00.000Z",
      ...overrides,
    },
    bytes: new TextEncoder().encode("a,b"),
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = REPORT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findPayrollReport).mockResolvedValue(reportRecord());
  vi.mocked(application.readFileObject).mockResolvedValue(storedFile());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/workforce/payroll-reports/[id]/export/file", () => {
  it("streams the stored bytes as a private attachment", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toBe("a,b");
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to download the export",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read payroll reports",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(403);
      expect(application.readFileObject).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown or cross-organization report", async () => {
    vi.mocked(application.findPayrollReport).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the report has no export file", async () => {
    vi.mocked(application.findPayrollReport).mockResolvedValue(
      reportRecord({ exportFileId: null }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the file object is outside the organization", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID report id", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findPayrollReport).not.toHaveBeenCalled();
  });
});
