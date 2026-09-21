import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { location, organization, reconciliation } from "../schema";
import {
  createReconciliation,
  createReconciliationTolerance,
  findReconciliation,
  findReconciliationTolerance,
  listReconciliationTolerances,
  listReconciliations,
  updateReconciliation,
} from "./reconciliation";
import {
  createTestLocation,
  createTestOrganization,
  createTestReconciliation,
  createTestReconciliationTolerance,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("reconciliation repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(reconciliation).where(eq(reconciliation.organizationId, orgId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a reconciliation and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createReconciliation(tx, {
        organizationId: orgId,
        scopeType: "sales_source",
        scopeId: "00000000-0000-0000-0000-0000000000aa",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        expectedAmount: "1000.0000",
        actualAmount: "995.0000",
        tolerance: "5.0000",
        difference: "-5.0000",
      });
      expect(created.status).toBe("pending");
      expect(created.resolutionNote).toBeNull();

      expect(
        (await findReconciliation(tx, { organizationId: orgId, reconciliationId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestReconciliation(tx, otherOrgId);
      expect(
        await findReconciliation(tx, { organizationId: orgId, reconciliationId: other.id }),
      ).toBeUndefined();
    });
  });

  it("lists reconciliations newest period first with status/scope filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const scopeId = "00000000-0000-0000-0000-0000000000bb";
      const february = await createTestReconciliation(tx, orgId, {
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
      });
      const march = await createTestReconciliation(tx, orgId, {
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        scopeType: "settlement",
        scopeId,
        status: "exception",
      });

      const all = await listReconciliations(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, february.id]);

      const exceptions = await listReconciliations(tx, {
        organizationId: orgId,
        status: "exception",
      });
      expect(exceptions.map((row) => row.id)).toEqual([march.id]);

      const byScope = await listReconciliations(tx, {
        organizationId: orgId,
        scopeType: "settlement",
        scopeId,
      });
      expect(byScope.map((row) => row.id)).toEqual([march.id]);

      const paged = await listReconciliations(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([february.id]);
    });
  });

  it("rejects a status outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliation(tx, orgId, { status: "bogus" as never }),
      );
      expect(cause.message).toMatch(/reconciliation_status_check/);
    });
  });

  it("rejects a scope_type outside the vocabulary (DEC-078)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliation(tx, orgId, { scopeType: "bogus" }),
      );
      expect(cause.message).toMatch(/reconciliation_scope_type_check/);
    });
  });

  it("accepts the four reconciliation_scope_type values (DEC-078)", async () => {
    await inRollback(client.db, async (tx) => {
      for (const scopeType of ["import_run", "sales_source", "settlement", "supplier_invoice"]) {
        const created = await createTestReconciliation(tx, orgId, { scopeType });
        expect(created.scopeType).toBe(scopeType);
      }
    });
  });

  it("rejects a period that ends before it starts", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliation(tx, orgId, {
          periodStart: "2026-03-31",
          periodEnd: "2026-03-01",
        }),
      );
      expect(cause.message).toMatch(/reconciliation_period_check/);
    });
  });

  it("updates the status and resolution trail organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestReconciliation(tx, orgId);

      const updated = await updateReconciliation(
        tx,
        { organizationId: orgId, reconciliationId: created.id },
        {
          status: "resolved",
          resolutionNote: "settled with the provider report",
          ownerId: "00000000-0000-0000-0000-0000000000cc",
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      );
      expect(updated?.status).toBe("resolved");
      expect(updated?.resolutionNote).toBe("settled with the provider report");
      expect(updated?.version).toBe(1);

      // A cross-organization update matches no row and changes nothing.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const crossOrg = await updateReconciliation(
        tx,
        { organizationId: otherOrgId, reconciliationId: created.id },
        { status: "approved" },
      );
      expect(crossOrg).toBeUndefined();
      const unchanged = await findReconciliation(tx, {
        organizationId: orgId,
        reconciliationId: created.id,
      });
      expect(unchanged?.status).toBe("resolved");
    });
  });

  it("creates a tolerance and resolves the effective row on a half-open window (DEC-072)", async () => {
    await inRollback(client.db, async (tx) => {
      const early = await createReconciliationTolerance(tx, {
        organizationId: orgId,
        kind: "sales_settlement",
        rate: "0.005",
        floorAmount: "5.0000",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-07-01",
      });
      const late = await createTestReconciliationTolerance(tx, orgId, {
        kind: "sales_settlement",
        rate: "0.010000",
        floorAmount: "10.0000",
        effectiveFrom: "2026-07-01",
      });
      expect(early.effectiveTo).toBe("2026-07-01");
      expect(late.effectiveTo).toBeNull();

      // Inside the first window.
      expect(
        (
          await findReconciliationTolerance(tx, {
            organizationId: orgId,
            kind: "sales_settlement",
            asOf: "2026-03-15",
          })
        )?.id,
      ).toBe(early.id);

      // The `to` boundary is exclusive: `2026-07-01` belongs to the later row.
      expect(
        (
          await findReconciliationTolerance(tx, {
            organizationId: orgId,
            kind: "sales_settlement",
            asOf: "2026-07-01",
          })
        )?.id,
      ).toBe(late.id);

      // Before the first window and for a kind/org with no config: no row.
      expect(
        await findReconciliationTolerance(tx, {
          organizationId: orgId,
          kind: "sales_settlement",
          asOf: "2025-12-31",
        }),
      ).toBeUndefined();
      expect(
        await findReconciliationTolerance(tx, {
          organizationId: orgId,
          kind: "supplier_invoice",
          asOf: "2026-03-15",
        }),
      ).toBeUndefined();
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findReconciliationTolerance(tx, {
          organizationId: otherOrgId,
          kind: "sales_settlement",
          asOf: "2026-03-15",
        }),
      ).toBeUndefined();
    });
  });

  it("lists tolerances newest effective first with a kind filter and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const january = await createTestReconciliationTolerance(tx, orgId, {
        kind: "sales_settlement",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-01",
      });
      const june = await createTestReconciliationTolerance(tx, orgId, {
        kind: "sales_settlement",
        effectiveFrom: "2026-06-01",
      });
      const invoice = await createTestReconciliationTolerance(tx, orgId, {
        kind: "supplier_invoice",
        effectiveFrom: "2026-02-01",
      });

      const all = await listReconciliationTolerances(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([june.id, invoice.id, january.id]);

      const settlements = await listReconciliationTolerances(tx, {
        organizationId: orgId,
        kind: "sales_settlement",
      });
      expect(settlements.map((row) => row.id)).toEqual([june.id, january.id]);

      const paged = await listReconciliationTolerances(tx, {
        organizationId: orgId,
        kind: "sales_settlement",
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([january.id]);
    });
  });

  it("rejects an overlapping effective window for the same (organization, kind)", async () => {
    await inRollback(client.db, async (tx) => {
      await createTestReconciliationTolerance(tx, orgId, {
        kind: "sales_settlement",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-07-01",
      });

      // The kind is part of the version key, so the same window on another kind
      // is allowed. Insert it before the expected failure: a failed statement
      // aborts the transaction, so nothing may follow it.
      const other = await createTestReconciliationTolerance(tx, orgId, {
        kind: "supplier_invoice",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-12-31",
      });
      expect(other.kind).toBe("supplier_invoice");

      const cause = await rejectionCause(
        createTestReconciliationTolerance(tx, orgId, {
          kind: "sales_settlement",
          effectiveFrom: "2026-06-01",
          effectiveTo: "2026-12-31",
        }),
      );
      expect(cause.message).toMatch(/reconciliation_tolerance_no_overlap/);
    });
  });

  it("rejects an out-of-vocabulary kind", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliationTolerance(tx, orgId, { kind: "bogus" }),
      );
      expect(cause.message).toMatch(/reconciliation_tolerance_kind_check/);
    });
  });

  it("rejects a negative rate", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliationTolerance(tx, orgId, { rate: "-0.01" }),
      );
      expect(cause.message).toMatch(/reconciliation_tolerance_rate_check/);
    });
  });

  it("rejects a negative floor amount", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestReconciliationTolerance(tx, orgId, { floorAmount: "-1.0000" }),
      );
      expect(cause.message).toMatch(/reconciliation_tolerance_floor_check/);
    });
  });

  it("exposes the reconciliation table", () => {
    expect(reconciliation).toBeDefined();
  });
});
