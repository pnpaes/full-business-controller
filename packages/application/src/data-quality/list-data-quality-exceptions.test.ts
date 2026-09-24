import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT,
  MAX_DATA_QUALITY_EXCEPTION_LIMIT,
  listDataQualityExceptions,
} from "./list-data-quality-exceptions";
import type {
  DataQualityExceptionListQuery,
  DataQualityExceptionReadStore,
  DataQualityExceptionRecord,
} from "./types";

const ORG = "org-1";

function exception(
  overrides: Partial<DataQualityExceptionRecord> & { readonly id: string },
): DataQualityExceptionRecord {
  return {
    organizationId: ORG,
    ruleCode: "count_variance",
    severity: "medium",
    entityType: "stock_count",
    entityId: overrides.id,
    detectedAt: "2026-01-01T00:00:00.000Z",
    ownerId: null,
    dueDate: null,
    status: "open",
    resolution: null,
    ...overrides,
  };
}

/** Minimal read store: filters, newest-first ordering and paging like the repository. */
function buildStore(rows: readonly DataQualityExceptionRecord[]): DataQualityExceptionReadStore {
  return {
    listDataQualityExceptions: (query: DataQualityExceptionListQuery) => {
      const matching = rows
        .filter((row) => row.organizationId === query.organizationId)
        .filter((row) => query.status === undefined || row.status === query.status)
        .filter((row) => query.severity === undefined || row.severity === query.severity)
        .filter((row) => query.entityType === undefined || row.entityType === query.entityType)
        .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
      const offset = query.offset ?? 0;
      return Promise.resolve(
        query.limit === undefined
          ? matching.slice(offset)
          : matching.slice(offset, offset + query.limit),
      );
    },
  };
}

const ROWS = [
  exception({ id: "a", detectedAt: "2026-01-01T00:00:00.000Z", severity: "low" }),
  exception({
    id: "b",
    detectedAt: "2026-01-03T00:00:00.000Z",
    severity: "high",
    status: "resolved",
  }),
  exception({ id: "other-org", organizationId: "org-2", detectedAt: "2026-01-04T00:00:00.000Z" }),
];

describe("listDataQualityExceptions", () => {
  it("returns only the organization's exceptions, newest first", async () => {
    const rows = await listDataQualityExceptions(buildStore(ROWS), { organizationId: ORG });
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
    expect(DEFAULT_DATA_QUALITY_EXCEPTION_LIMIT).toBe(50);
  });

  it("passes the status and severity filters through", async () => {
    const store = buildStore(ROWS);
    expect(
      (await listDataQualityExceptions(store, { organizationId: ORG, severity: "high" })).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      (await listDataQualityExceptions(store, { organizationId: ORG, status: "open" })).map(
        (row) => row.id,
      ),
    ).toEqual(["a"]);
  });

  it("applies limit and offset", async () => {
    const rows = await listDataQualityExceptions(buildStore(ROWS), {
      organizationId: ORG,
      limit: 1,
      offset: 1,
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore(ROWS);
    await expect(
      listDataQualityExceptions(store, { organizationId: ORG, limit: 0 }),
    ).rejects.toThrow(DomainError);
    await expect(
      listDataQualityExceptions(store, {
        organizationId: ORG,
        limit: MAX_DATA_QUALITY_EXCEPTION_LIMIT + 1,
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      listDataQualityExceptions(store, { organizationId: ORG, offset: -1 }),
    ).rejects.toThrow(DomainError);
  });
});
