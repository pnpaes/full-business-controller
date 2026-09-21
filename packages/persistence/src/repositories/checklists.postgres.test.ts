import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { checklistRun, checklistTemplate, location, organization } from "../schema";
import {
  createChecklistRun,
  createChecklistTemplate,
  findChecklistRun,
  findChecklistTemplate,
  listChecklistRuns,
  listChecklistTemplates,
  updateChecklistRun,
  updateChecklistTemplate,
} from "./checklists";
import {
  createTestChecklistRun,
  createTestChecklistTemplate,
  createTestLocation,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

describe.skipIf(!databaseUrl)("checklists repository", () => {
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
      // Every template and run is created inside a rolled-back transaction, so
      // the committed fixtures to unwind are the location and the organization.
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a template and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createChecklistTemplate(tx, {
        organizationId: orgId,
        name: "Opening routine",
        category: "opening",
        frequency: "twice_daily",
        items: [{ label: "Unlock the door" }, { label: "Switch on the lights" }],
        actorId: "00000000-0000-0000-0000-0000000000aa",
      });
      expect(created.category).toBe("opening");
      expect(created.frequency).toBe("twice_daily");
      expect(created.active).toBe(true);
      expect(created.supersedesId).toBeNull();
      expect(created.items).toEqual([
        { label: "Unlock the door" },
        { label: "Switch on the lights" },
      ]);
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000aa");

      expect(
        (await findChecklistTemplate(tx, { organizationId: orgId, templateId: created.id }))?.id,
      ).toBe(created.id);

      // A row in another organization is invisible at this scope. If the
      // organization filter were dropped, this lookup would find the row and
      // the assertion would fail.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findChecklistTemplate(tx, { organizationId: otherOrgId, templateId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults items to an empty array and active to true when omitted", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestChecklistTemplate(tx, orgId, {
        active: undefined,
        items: undefined,
      });
      expect(created.items).toEqual([]);
      expect(created.active).toBe(true);
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("supersedes a template with a second revision pinned to the first", async () => {
    await inRollback(client.db, async (tx) => {
      const first = await createTestChecklistTemplate(tx, orgId, {
        name: "Cleaning routine",
        category: "cleaning",
        items: ["wipe surfaces"],
      });
      const revision = await createChecklistTemplate(tx, {
        organizationId: orgId,
        name: "Cleaning routine",
        category: "cleaning",
        frequency: "weekly",
        items: ["wipe surfaces", "mop the floor"],
        supersedesId: first.id,
        actorId: null,
      });

      expect(revision.supersedesId).toBe(first.id);
      expect(revision.id).not.toBe(first.id);
      // The name is reused across revisions by design — no unique constraint on
      // `(organization_id, name)`. A run of the first revision still resolves.
      const runFirst = await createTestChecklistRun(tx, orgId, {
        templateId: first.id,
        locationId,
      });
      expect(runFirst.templateId).toBe(first.id);
      expect(
        (await findChecklistTemplate(tx, { organizationId: orgId, templateId: first.id }))?.items,
      ).toEqual(["wipe surfaces"]);
    });
  });

  it("lists templates by category and active with paging and second-org isolation", async () => {
    await inRollback(client.db, async (tx) => {
      const a = await createTestChecklistTemplate(tx, orgId, {
        name: "A opening",
        category: "opening",
        active: true,
      });
      const b = await createTestChecklistTemplate(tx, orgId, {
        name: "B cleaning",
        category: "cleaning",
        active: false,
      });
      const c = await createTestChecklistTemplate(tx, orgId, {
        name: "C cleaning",
        category: "cleaning",
        active: true,
      });

      // Name order (then id).
      const all = await listChecklistTemplates(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const cleaning = await listChecklistTemplates(tx, {
        organizationId: orgId,
        category: "cleaning",
      });
      expect(cleaning.map((row) => row.id)).toEqual([b.id, c.id]);

      const active = await listChecklistTemplates(tx, { organizationId: orgId, active: true });
      expect(active.map((row) => row.id)).toEqual([a.id, c.id]);

      const paged = await listChecklistTemplates(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's rows never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestChecklistTemplate(tx, otherOrgId);
      expect(
        (await listChecklistTemplates(tx, { organizationId: orgId })).map((row) => row.id),
      ).toEqual([a.id, b.id, c.id]);
      expect(
        (await listChecklistTemplates(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("updates a template's mutable fields and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId, { category: "other" });
      const updated = await updateChecklistTemplate(tx, {
        organizationId: orgId,
        templateId: template.id,
        name: "Retired routine",
        category: "hygiene",
        frequency: "monthly",
        items: ["deep clean"],
        active: false,
        actorId: "00000000-0000-0000-0000-0000000000bb",
      });
      expect(updated?.name).toBe("Retired routine");
      expect(updated?.category).toBe("hygiene");
      expect(updated?.frequency).toBe("monthly");
      expect(updated?.items).toEqual(["deep clean"]);
      expect(updated?.active).toBe(false);
      expect(updated?.updatedBy).toBe("00000000-0000-0000-0000-0000000000bb");
      expect(updated?.updatedAt).not.toBeNull();
    });
  });

  it("does not update a template through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId, { name: "Original" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateChecklistTemplate(tx, {
          organizationId: otherOrgId,
          templateId: template.id,
          name: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (await findChecklistTemplate(tx, { organizationId: orgId, templateId: template.id }))?.name,
      ).toBe("Original");
    });
  });

  it("rejects a template category outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestChecklistTemplate(tx, orgId, { category: "cleaning_supplies" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_template_category_check/);
    });
  });

  it("rejects a template frequency outside the shared CHECK_FREQUENCY vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestChecklistTemplate(tx, orgId, { frequency: "hourly" }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_template_frequency_check/);
    });
  });

  it("rejects non-array jsonb in items", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestChecklistTemplate(tx, orgId, { items: { label: "not an array" } }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_template_items_array_check/);
    });
  });

  it("rejects a template that supersedes itself", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      // The repository deliberately does not expose `supersedesId` on update
      // (the link is immutable after creation), so write it directly to reach
      // the self-supersede check.
      const cause = await rejectionCause(
        tx
          .update(checklistTemplate)
          .set({ supersedesId: template.id })
          .where(eq(checklistTemplate.id, template.id)),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_template_supersedes_self_check/);
    });
  });

  it("rejects a template whose supersedes target is in another organization (0043)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `checklist_template` row (so the single-column FK
      // passes), but the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherTemplate = await createTestChecklistTemplate(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestChecklistTemplate(tx, orgId, { supersedesId: otherTemplate.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_template\.supersedes_id/);
    });
  });

  it("creates a run and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const created = await createChecklistRun(tx, {
        organizationId: orgId,
        templateId: template.id,
        locationId,
        runAt: at("2026-02-01T07:00:00.000Z"),
        performedBy: "00000000-0000-0000-0000-0000000000cc",
        status: "in_progress",
        results: [{ item: "wipe surfaces", outcome: "pass" }],
        notes: "Half done",
        actorId: "00000000-0000-0000-0000-0000000000dd",
      });
      expect(created.templateId).toBe(template.id);
      expect(created.locationId).toBe(locationId);
      expect(created.status).toBe("in_progress");
      expect(created.performedBy).toBe("00000000-0000-0000-0000-0000000000cc");
      expect(created.results).toEqual([{ item: "wipe surfaces", outcome: "pass" }]);
      expect(created.notes).toBe("Half done");
      expect(created.createdBy).toBe("00000000-0000-0000-0000-0000000000dd");

      expect((await findChecklistRun(tx, { organizationId: orgId, runId: created.id }))?.id).toBe(
        created.id,
      );

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findChecklistRun(tx, { organizationId: otherOrgId, runId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults a run's status to in_progress and results to an empty array", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const created = await createTestChecklistRun(tx, orgId, {
        templateId: template.id,
        locationId,
      });
      expect(created.status).toBe("in_progress");
      expect(created.results).toEqual([]);
      expect(created.notes).toBeNull();
      expect(created.createdBy).toBeNull();
    });
  });

  it("lists runs by template, location and status, newest first", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const otherTemplate = await createTestChecklistTemplate(tx, orgId);
      const otherLocation = await createTestLocation(tx, orgId);

      const old = await createTestChecklistRun(
        tx,
        orgId,
        {
          templateId: template.id,
          locationId,
        },
        { runAt: at("2026-01-01T08:00:00.000Z"), status: "completed" },
      );
      const newer = await createTestChecklistRun(
        tx,
        orgId,
        {
          templateId: template.id,
          locationId,
        },
        { runAt: at("2026-03-01T08:00:00.000Z"), status: "in_progress" },
      );
      const elsewhere = await createTestChecklistRun(
        tx,
        orgId,
        {
          templateId: template.id,
          locationId: otherLocation.id,
        },
        { runAt: at("2026-02-01T08:00:00.000Z"), status: "completed" },
      );

      // Newest `run_at` first.
      const all = await listChecklistRuns(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([newer.id, elsewhere.id, old.id]);

      const completed = await listChecklistRuns(tx, { organizationId: orgId, status: "completed" });
      expect(completed.map((row) => row.id)).toEqual([elsewhere.id, old.id]);

      const here = await listChecklistRuns(tx, { organizationId: orgId, locationId });
      expect(here.map((row) => row.id)).toEqual([newer.id, old.id]);

      const byTemplate = await listChecklistRuns(tx, {
        organizationId: orgId,
        templateId: otherTemplate.id,
      });
      expect(byTemplate).toEqual([]);

      const paged = await listChecklistRuns(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([elsewhere.id]);

      // A second organization's runs never leak in: the exact id list (not just
      // a `not.toContain`) fails if the organization filter were dropped.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocationId = (await createTestLocation(tx, otherOrgId)).id;
      const otherTemplateRow = await createTestChecklistTemplate(tx, otherOrgId);
      const other = await createTestChecklistRun(tx, otherOrgId, {
        templateId: otherTemplateRow.id,
        locationId: otherLocationId,
      });
      expect((await listChecklistRuns(tx, { organizationId: orgId })).map((row) => row.id)).toEqual(
        [newer.id, elsewhere.id, old.id],
      );
      expect(
        (await listChecklistRuns(tx, { organizationId: orgId })).map((row) => row.id),
      ).not.toContain(other.id);
    });
  });

  it("completes a run and records the actor", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const run = await createTestChecklistRun(tx, orgId, { templateId: template.id, locationId });
      const completed = await updateChecklistRun(tx, {
        organizationId: orgId,
        runId: run.id,
        status: "completed",
        results: [{ item: "wipe surfaces", outcome: "fail" }],
        notes: "Re-clean required",
        actorId: "00000000-0000-0000-0000-0000000000ee",
      });
      expect(completed?.status).toBe("completed");
      expect(completed?.results).toEqual([{ item: "wipe surfaces", outcome: "fail" }]);
      expect(completed?.notes).toBe("Re-clean required");
      expect(completed?.updatedBy).toBe("00000000-0000-0000-0000-0000000000ee");
    });
  });

  it("does not update a run through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const run = await createTestChecklistRun(tx, orgId, { templateId: template.id, locationId });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateChecklistRun(tx, {
          organizationId: otherOrgId,
          runId: run.id,
          status: "completed",
        }),
      ).toBeUndefined();
    });
  });

  it("rejects a run status outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const cause = await rejectionCause(
        createTestChecklistRun(
          tx,
          orgId,
          { templateId: template.id, locationId },
          {
            status: "cancelled",
          },
        ),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_run_status_check/);
    });
  });

  it("rejects non-array jsonb in results", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const cause = await rejectionCause(
        createTestChecklistRun(
          tx,
          orgId,
          { templateId: template.id, locationId },
          {
            results: { outcome: "pass" },
          },
        ),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_run_results_array_check/);
    });
  });

  it("rejects a run whose template is in another organization (0043)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherTemplate = await createTestChecklistTemplate(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestChecklistRun(tx, orgId, { templateId: otherTemplate.id, locationId }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_run\.template_id/);
    });
  });

  it("rejects a run whose location is in another organization (0043)", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestChecklistRun(tx, orgId, {
          templateId: template.id,
          locationId: otherLocation.id,
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/checklist_run\.location_id/);
    });
  });

  it("is not append-only: a template and a run can be updated and deleted", async () => {
    await inRollback(client.db, async (tx) => {
      const template = await createTestChecklistTemplate(tx, orgId);
      const run = await createTestChecklistRun(tx, orgId, { templateId: template.id, locationId });
      // `DEC-091` records that neither table has an append-only trigger, so a
      // plain DELETE succeeds (inside the rollback). The run goes first because
      // its `template_id` FK would otherwise block the template delete.
      await tx.delete(checklistRun).where(eq(checklistRun.id, run.id));
      await tx.delete(checklistTemplate).where(eq(checklistTemplate.id, template.id));
    });
  });
});
