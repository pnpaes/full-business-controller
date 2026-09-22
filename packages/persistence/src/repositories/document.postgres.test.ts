import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { document, documentVersion, organization } from "../schema";
import {
  createDocument,
  createDocumentAcknowledgement,
  createDocumentVersion,
  findCurrentPublishedVersion,
  findDocument,
  findDocumentAcknowledgement,
  findDocumentVersion,
  findLatestDocumentVersion,
  listDocumentAcknowledgements,
  listDocuments,
  listDocumentVersions,
  lockDocument,
  publishDocumentVersion,
  updateDocument,
} from "./document";
import {
  createTestDocument,
  createTestDocumentAcknowledgement,
  createTestDocumentVersion,
  createTestFileObject,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

const ACTOR = "00000000-0000-0000-0000-0000000000aa";
const USER = "00000000-0000-0000-0000-0000000000bb";

describe.skipIf(!databaseUrl)("staff document repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every document, version and acknowledgement is created inside a
      // rolled-back transaction, so the only committed fixture is the
      // organization.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a document and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createDocument(tx, {
        organizationId: orgId,
        title: "Opening routine",
        category: "routine",
        audience: "all_staff",
        status: "published",
        ownerId: ACTOR,
        createdBy: ACTOR,
      });
      expect(created.title).toBe("Opening routine");
      expect(created.category).toBe("routine");
      expect(created.audience).toBe("all_staff");
      expect(created.status).toBe("published");
      expect(created.ownerId).toBe(ACTOR);
      expect(created.createdBy).toBe(ACTOR);

      expect((await findDocument(tx, { organizationId: orgId, documentId: created.id }))?.id).toBe(
        created.id,
      );

      // A row in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findDocument(tx, { organizationId: otherOrgId, documentId: created.id }),
      ).toBeUndefined();
    });
  });

  it("defaults a document's status to draft and its nullable fields to null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDocument(tx, orgId);
      expect(created.status).toBe("draft");
      expect(created.ownerId).toBeNull();
      expect(created.createdBy).toBeNull();
      expect(created.updatedAt).toBeNull();
    });
  });

  it("lists documents by category/audience/status, ordered by title, second-org isolated", async () => {
    await inRollback(client.db, async (tx) => {
      const a = await createTestDocument(tx, orgId, {
        title: "A-doc",
        category: "policy",
        audience: "managers",
        status: "published",
      });
      const b = await createTestDocument(tx, orgId, {
        title: "B-doc",
        category: "policy",
        audience: "all_staff",
        status: "archived",
      });
      const c = await createTestDocument(tx, orgId, {
        title: "C-doc",
        category: "form",
        audience: "all_staff",
        status: "published",
      });

      const all = await listDocuments(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([a.id, b.id, c.id]);

      const policies = await listDocuments(tx, { organizationId: orgId, category: "policy" });
      expect(policies.map((row) => row.id)).toEqual([a.id, b.id]);

      const forStaff = await listDocuments(tx, { organizationId: orgId, audience: "all_staff" });
      expect(forStaff.map((row) => row.id)).toEqual([b.id, c.id]);

      const published = await listDocuments(tx, { organizationId: orgId, status: "published" });
      expect(published.map((row) => row.id)).toEqual([a.id, c.id]);

      const paged = await listDocuments(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([b.id]);

      // A second organization's documents never leak in.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      await createTestDocument(tx, otherOrgId, { title: "A-doc" });
      expect((await listDocuments(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        a.id,
        b.id,
        c.id,
      ]);
    });
  });

  it("updates a document's mutable fields, records the actor and clears the owner with null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDocument(tx, orgId, { title: "Patch Me" });
      const updated = await updateDocument(tx, {
        organizationId: orgId,
        documentId: created.id,
        title: "Renamed",
        category: "guideline",
        audience: "managers",
        status: "published",
        ownerId: USER,
        actorId: ACTOR,
      });
      expect(updated?.title).toBe("Renamed");
      expect(updated?.category).toBe("guideline");
      expect(updated?.audience).toBe("managers");
      expect(updated?.status).toBe("published");
      expect(updated?.ownerId).toBe(USER);
      expect(updated?.updatedBy).toBe(ACTOR);
      expect(updated?.updatedAt).not.toBeNull();

      // An explicit null clears the owner; an omitted field is untouched.
      const cleared = await updateDocument(tx, {
        organizationId: orgId,
        documentId: created.id,
        ownerId: null,
      });
      expect(cleared?.ownerId).toBeNull();
      expect(cleared?.title).toBe("Renamed");
    });
  });

  it("does not update a document through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDocument(tx, orgId, { title: "Original" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateDocument(tx, {
          organizationId: otherOrgId,
          documentId: created.id,
          title: "Hijacked",
        }),
      ).toBeUndefined();
      expect(
        (await findDocument(tx, { organizationId: orgId, documentId: created.id }))?.title,
      ).toBe("Original");
    });
  });

  it("creates versions, finds the latest version and lists them in order", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const v1 = await createDocumentVersion(tx, {
        organizationId: orgId,
        documentId: doc.id,
        versionNo: 1,
        notes: "first",
        createdBy: ACTOR,
      });
      const v2 = await createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 2 });

      expect(v1.versionNo).toBe(1);
      expect(v1.notes).toBe("first");
      expect(v1.createdBy).toBe(ACTOR);
      expect(v1.fileObjectId).toBeNull();
      expect(v1.publishedAt).toBeNull();
      expect(v1.publishedBy).toBeNull();

      expect(
        (await findDocumentVersion(tx, { organizationId: orgId, documentVersionId: v1.id }))?.id,
      ).toBe(v1.id);
      expect(
        (await findLatestDocumentVersion(tx, { organizationId: orgId, documentId: doc.id }))?.id,
      ).toBe(v2.id);
      expect(
        (await listDocumentVersions(tx, { organizationId: orgId, documentId: doc.id })).map(
          (row) => row.id,
        ),
      ).toEqual([v1.id, v2.id]);
      expect(
        (
          await listDocumentVersions(tx, {
            organizationId: orgId,
            documentId: doc.id,
            limit: 1,
            offset: 1,
          })
        ).map((row) => row.id),
      ).toEqual([v2.id]);

      // Another organization's scope cannot see the version.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findDocumentVersion(tx, {
          organizationId: otherOrgId,
          documentVersionId: v1.id,
        }),
      ).toBeUndefined();
    });
  });

  it("resolves the current published version past a newer unpublished version", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const published = await createTestDocumentVersion(tx, orgId, doc.id, {
        versionNo: 1,
        publishedAt: new Date("2026-05-01T09:00:00.000Z"),
        publishedBy: USER,
      });
      await createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 2 });

      // The newer draft v2 does not shadow the still-current published v1.
      expect(
        (await findCurrentPublishedVersion(tx, { organizationId: orgId, documentId: doc.id }))?.id,
      ).toBe(published.id);

      // No published version yet → undefined, and another org sees nothing.
      const draftDoc = await createTestDocument(tx, orgId);
      await createTestDocumentVersion(tx, orgId, draftDoc.id, { versionNo: 1 });
      expect(
        await findCurrentPublishedVersion(tx, { organizationId: orgId, documentId: draftDoc.id }),
      ).toBeUndefined();
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findCurrentPublishedVersion(tx, { organizationId: otherOrgId, documentId: doc.id }),
      ).toBeUndefined();
    });
  });

  it("locks one document for update, organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDocument(tx, orgId, { title: "Lock me" });

      expect((await lockDocument(tx, { organizationId: orgId, documentId: created.id }))?.id).toBe(
        created.id,
      );

      // A cross-organization scope locks nothing and returns undefined.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await lockDocument(tx, { organizationId: otherOrgId, documentId: created.id }),
      ).toBeUndefined();
    });
  });

  it("publishes a version, stamping the published pair and the audit actor", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const version = await createTestDocumentVersion(tx, orgId, doc.id);
      const published = await publishDocumentVersion(tx, {
        organizationId: orgId,
        documentVersionId: version.id,
        publishedAt: new Date("2026-05-01T09:00:00.000Z"),
        publishedBy: USER,
        actorId: ACTOR,
      });
      expect(published?.publishedAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
      expect(published?.publishedBy).toBe(USER);
      expect(published?.updatedBy).toBe(ACTOR);
      expect(published?.updatedAt).not.toBeNull();
    });
  });

  it("appends acknowledgements, finds one by version+user and lists them newest first", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const version = await createTestDocumentVersion(tx, orgId, doc.id);
      const earlier = await createDocumentAcknowledgement(tx, {
        organizationId: orgId,
        documentVersionId: version.id,
        acknowledgedBy: USER,
        acknowledgedAt: new Date("2026-04-01T08:00:00.000Z"),
      });
      const later = await createTestDocumentAcknowledgement(tx, orgId, version.id, {
        acknowledgedAt: new Date("2026-04-02T08:00:00.000Z"),
      });

      expect(
        (
          await findDocumentAcknowledgement(tx, {
            organizationId: orgId,
            documentVersionId: version.id,
            acknowledgedBy: USER,
          })
        )?.id,
      ).toBe(earlier.id);

      const listed = await listDocumentAcknowledgements(tx, {
        organizationId: orgId,
        documentVersionId: version.id,
      });
      expect(listed.map((row) => row.id)).toEqual([later.id, earlier.id]);

      const mine = await listDocumentAcknowledgements(tx, {
        organizationId: orgId,
        acknowledgedBy: USER,
      });
      expect(mine.map((row) => row.id)).toEqual([earlier.id]);
    });
  });

  it("rejects a category, audience or status outside its vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const category = await rejectionCause(createTestDocument(tx, orgId, { category: "memo" }));
      expect(errorCode(category)).toBe("23514");
      expect(category.message).toMatch(/document_category_check/);
    });
    await inRollback(client.db, async (tx) => {
      const audience = await rejectionCause(
        createTestDocument(tx, orgId, { audience: "everyone" }),
      );
      expect(errorCode(audience)).toBe("23514");
      expect(audience.message).toMatch(/document_audience_check/);
    });
    await inRollback(client.db, async (tx) => {
      const status = await rejectionCause(createTestDocument(tx, orgId, { status: "approved" }));
      expect(errorCode(status)).toBe("23514");
      expect(status.message).toMatch(/document_status_check/);
    });
  });

  it("rejects a version_no that is not positive", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const cause = await rejectionCause(
        createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 0 }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/document_version_version_no_check/);
    });
  });

  it("rejects a published pair with only one half set", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const atOnly = await rejectionCause(
        createTestDocumentVersion(tx, orgId, doc.id, {
          publishedAt: new Date("2026-05-01T09:00:00.000Z"),
        }),
      );
      expect(errorCode(atOnly)).toBe("23514");
      expect(atOnly.message).toMatch(/document_version_published_check/);
    });
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const byOnly = await rejectionCause(
        createTestDocumentVersion(tx, orgId, doc.id, { publishedBy: USER }),
      );
      expect(errorCode(byOnly)).toBe("23514");
      expect(byOnly.message).toMatch(/document_version_published_check/);
    });
  });

  it("rejects a duplicate (document_id, version_no)", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      await createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 1 });
      const cause = await rejectionCause(
        createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 1 }),
      );
      expect(errorCode(cause)).toBe("23505");
      expect(cause.message).toMatch(/document_version_document_version_key/);
    });
  });

  it("rejects an unregistered document id (FK, not null)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createDocumentVersion(tx, {
          organizationId: orgId,
          documentId: "00000000-0000-4000-8000-0000000000ff",
          versionNo: 1,
        }),
      );
      expect(errorCode(cause)).toBe("23503");
      expect(cause.message).toMatch(/document_version_document_id_document_id_fk/);
    });
  });

  it("rejects an unregistered document version id on an acknowledgement (FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestDocumentAcknowledgement(tx, orgId, "00000000-0000-4000-8000-0000000000ff"),
      );
      expect(errorCode(cause)).toBe("23503");
      // PostgreSQL truncates the constraint name to 63 characters.
      expect(cause.message).toMatch(/document_acknowledgement_document_version_id/);
    });
  });

  it("rejects a version whose document is in another organization (0049)", async () => {
    await inRollback(client.db, async (tx) => {
      // The id names a real `document` row (so the single-column FK passes), but
      // the organization mismatch is what the guard sees.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherDoc = await createTestDocument(tx, otherOrgId);
      const cause = await rejectionCause(createTestDocumentVersion(tx, orgId, otherDoc.id));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/document_version\.document_id/);
    });
  });

  it("rejects a version whose file object is in another organization (0049)", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherFile = await createTestFileObject(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestDocumentVersion(tx, orgId, doc.id, { fileObjectId: otherFile.id }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/document_version\.file_object_id/);
    });
  });

  it("accepts a version with a NULL file object and one in the same organization (guards)", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const unfiled = await createTestDocumentVersion(tx, orgId, doc.id, { versionNo: 1 });
      expect(unfiled.fileObjectId).toBeNull();

      const file = await createTestFileObject(tx, orgId);
      const filed = await createTestDocumentVersion(tx, orgId, doc.id, {
        versionNo: 2,
        fileObjectId: file.id,
      });
      expect(filed.fileObjectId).toBe(file.id);
    });
  });

  it("rejects an acknowledgement whose version is in another organization (0049)", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherDoc = await createTestDocument(tx, otherOrgId);
      const otherVersion = await createTestDocumentVersion(tx, otherOrgId, otherDoc.id);
      const cause = await rejectionCause(
        createTestDocumentAcknowledgement(tx, orgId, otherVersion.id),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/document_acknowledgement\.document_version_id/);
    });
  });

  it("rejects a duplicate acknowledgement for one version and user", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const version = await createTestDocumentVersion(tx, orgId, doc.id);
      await createTestDocumentAcknowledgement(tx, orgId, version.id, { acknowledgedBy: USER });
      const cause = await rejectionCause(
        createTestDocumentAcknowledgement(tx, orgId, version.id, { acknowledgedBy: USER }),
      );
      expect(errorCode(cause)).toBe("23505");
      expect(cause.message).toMatch(/document_acknowledgement_version_user_key/);
    });
  });

  it("is not append-only: document and version rows are mutable in the database", async () => {
    await inRollback(client.db, async (tx) => {
      const doc = await createTestDocument(tx, orgId);
      const version = await createTestDocumentVersion(tx, orgId, doc.id);
      // `DEC-088` declares no append-only trigger, so a plain UPDATE and DELETE
      // succeed (inside the rollback). The repository still exposes the
      // publish/update path rather than deletes on `document`/`document_version`.
      await tx.update(document).set({ title: "amended in place" }).where(eq(document.id, doc.id));
      await tx.delete(documentVersion).where(eq(documentVersion.id, version.id));
    });
  });
});
