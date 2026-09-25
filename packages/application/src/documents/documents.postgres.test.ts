import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  createDb,
  listAuditEventsForEntity,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalFileStorageAdapter } from "../files/local-file-storage";
import { createPostgresFileObjectsStore } from "../files/postgres-store";
import { readFileObject } from "../files/read-file-object";
import { storeFileObject } from "../files/store-file-object";

import { acknowledgeDocument } from "./acknowledge-document";
import { createDocument, DOCUMENT_AUDIENCES, DOCUMENT_CATEGORIES } from "./create-document";
import { createDocumentVersion } from "./create-document-version";
import { findCurrentPublishedVersion } from "./find-current-published-version";
import { findDocument } from "./find-document";
import { findDocumentVersion } from "./find-document-version";
import { listDocumentAcknowledgements } from "./list-document-acknowledgements";
import { listDocumentVersions } from "./list-document-versions";
import { listDocuments } from "./list-documents";
import { createPostgresDocumentsStore } from "./postgres-store";
import { publishDocumentVersion } from "./publish-document-version";
import { updateDocument } from "./update-document";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const CATEGORY = DOCUMENT_CATEGORIES[0]!;
const AUDIENCE = DOCUMENT_AUDIENCES[0]!;

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

describe.skipIf(!databaseUrl)("staff documents against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let storageRoot: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    storageRoot = await mkdtemp(join(tmpdir(), "aquarela-documents-it-"));
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Documents IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every document, version and acknowledgement is created inside a
      // rolled-back transaction, so only the organization is committed. The
      // stored bytes are on the local filesystem and are removed explicitly.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
    if (storageRoot !== undefined) {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("creates, updates and archives a document with the actor audit columns", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();

      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Staff handbook",
        category: CATEGORY,
        audience: AUDIENCE,
        ownerId: randomUUID(),
      });
      expect(document).toMatchObject({
        organizationId: orgId,
        title: "Staff handbook",
        category: CATEGORY,
        audience: AUDIENCE,
        status: "draft",
        updatedAt: null,
      });

      const editorId = randomUUID();
      const updated = await updateDocument(store, {
        organizationId: orgId,
        actorId: editorId,
        documentId: document.id,
        title: "Staff handbook v2",
      });
      expect(updated).toMatchObject({ id: document.id, title: "Staff handbook v2" });
      expect(updated?.updatedAt).not.toBeNull();
      expect(new Date(updated!.updatedAt!).toISOString()).toBe(updated!.updatedAt);

      const archived = await updateDocument(store, {
        organizationId: orgId,
        actorId: editorId,
        documentId: document.id,
        status: "archived",
      });
      expect(archived?.status).toBe("archived");

      const found = await findDocument(store, {
        organizationId: orgId,
        documentId: document.id,
      });
      expect(found).toMatchObject({ id: document.id, status: "archived" });
    });
  });

  it("makes a repeated archive a no-op: audit columns and audit facts unchanged", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Archive twice",
        category: CATEGORY,
        audience: AUDIENCE,
      });

      const readStored = async (): Promise<{ updatedAt: string | null }> => {
        const row = await findDocument(store, { organizationId: orgId, documentId: document.id });
        return { updatedAt: row?.updatedAt ?? null };
      };
      const updatedFactCount = async (): Promise<number> =>
        (await listAuditEventsForEntity(tx, "document", document.id)).filter(
          (row) => row.action === "documents.document.updated",
        ).length;

      const first = await updateDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        status: "archived",
      });
      const afterFirst = await readStored();
      expect(await updatedFactCount()).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await updateDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        status: "archived",
      });

      expect(second?.status).toBe("archived");
      expect(second?.updatedAt).toBe(first?.updatedAt);
      const afterSecond = await readStored();
      expect(afterSecond.updatedAt).toBe(afterFirst.updatedAt);
      expect(await updatedFactCount()).toBe(1);
    });
  });

  it("creates versions, publishes the latest and records acknowledgements", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Training policy",
        category: CATEGORY,
        audience: AUDIENCE,
      });

      const first = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        notes: "Initial",
      });
      expect(first).toMatchObject({
        documentId: document.id,
        version: 1,
        fileObjectId: null,
        notes: "Initial",
        publishedAt: null,
        publishedBy: null,
      });

      const second = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      expect(second.version).toBe(2);

      const published = await publishDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        documentVersionId: second.id,
      });
      expect(published).toMatchObject({ id: second.id, publishedBy: actorId });
      expect(new Date(published!.publishedAt!).toISOString()).toBe(published!.publishedAt);
      expect(
        (await findDocument(store, { organizationId: orgId, documentId: document.id }))?.status,
      ).toBe("published");

      const acknowledgement = await acknowledgeDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      expect(acknowledgement).toMatchObject({
        documentVersionId: second.id,
        acknowledgedBy: actorId,
      });

      // Idempotent: a repeat returns the same fact and appends no second audit.
      const repeat = await acknowledgeDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      expect(repeat.id).toBe(acknowledgement.id);
      const acknowledgementFacts = (
        await listAuditEventsForEntity(tx, "document_acknowledgement", acknowledgement.id)
      ).filter((row) => row.action === "documents.document_acknowledgement.created");
      expect(acknowledgementFacts).toHaveLength(1);

      const foundVersion = await findDocumentVersion(store, {
        organizationId: orgId,
        documentVersionId: first.id,
      });
      expect(foundVersion).toMatchObject({ id: first.id, version: 1, publishedAt: null });

      expect(
        (await listDocumentVersions(store, { organizationId: orgId, documentId: document.id }))
          .map((row) => row.version)
          .sort((a, b) => a - b),
      ).toEqual([1, 2]);
      expect(
        await listDocumentAcknowledgements(store, {
          organizationId: orgId,
          documentVersionId: second.id,
        }),
      ).toHaveLength(1);
    });
  });

  it("resolves the current published version past a newer unpublished version", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Current published",
        category: CATEGORY,
        audience: AUDIENCE,
      });

      const first = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      await publishDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        documentVersionId: first.id,
      });
      const second = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      expect(second).toMatchObject({ version: 2, publishedAt: null });

      // The newer draft v2 does not shadow the still-current published v1.
      expect(
        await findCurrentPublishedVersion(store, {
          organizationId: orgId,
          documentId: document.id,
        }),
      ).toMatchObject({ id: first.id, version: 1 });

      // Acknowledging without a version resolves v1, not the newer draft.
      const acknowledgement = await acknowledgeDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      expect(acknowledgement.documentVersionId).toBe(first.id);
    });
  });

  it("rejects invalid vocabulary, an archived amendment and a stale publish", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();

      await expect(
        createDocument(store, {
          organizationId: orgId,
          actorId,
          title: "Bad category",
          category: "nonsense",
          audience: AUDIENCE,
        }),
      ).rejects.toThrow(DomainError);
      await expect(
        createDocument(store, {
          organizationId: orgId,
          actorId,
          title: "Bad audience",
          category: CATEGORY,
          audience: "everyone",
        }),
      ).rejects.toThrow(DomainError);

      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Lifecycle",
        category: CATEGORY,
        audience: AUDIENCE,
      });
      const first = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
      });
      await expect(
        publishDocumentVersion(store, {
          organizationId: orgId,
          actorId,
          documentId: document.id,
          documentVersionId: first.id,
        }),
      ).rejects.toThrow(/only the latest version can be published/);

      await updateDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        status: "archived",
      });
      await expect(
        createDocumentVersion(store, {
          organizationId: orgId,
          actorId,
          documentId: document.id,
        }),
      ).rejects.toThrow(DomainError);
      await expect(
        updateDocument(store, {
          organizationId: orgId,
          actorId,
          documentId: document.id,
          status: "published",
        }),
      ).rejects.toThrow(/status may only be set to "archived"/);
    });
  });

  it("isolates documents, versions and acknowledgements by organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const otherOrgId = await seedForeignOrg(tx, `doc_isolate_${suffix}`);

      const otherDocument = await createDocument(store, {
        organizationId: otherOrgId,
        actorId,
        title: "Other tenant handbook",
        category: CATEGORY,
        audience: AUDIENCE,
      });
      const otherVersion = await createDocumentVersion(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: otherDocument.id,
      });
      await publishDocumentVersion(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: otherDocument.id,
        documentVersionId: otherVersion.id,
      });
      const otherAcknowledgement = await acknowledgeDocument(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: otherDocument.id,
      });

      // The org filter is load-bearing: dropping it would leak the other rows.
      expect(await listDocuments(store, { organizationId: orgId })).toEqual([]);
      expect(
        await findDocument(store, { organizationId: orgId, documentId: otherDocument.id }),
      ).toBeUndefined();
      expect(
        await findDocumentVersion(store, {
          organizationId: orgId,
          documentVersionId: otherVersion.id,
        }),
      ).toBeUndefined();
      expect(
        await listDocumentAcknowledgements(store, {
          organizationId: orgId,
          documentVersionId: otherVersion.id,
        }),
      ).toEqual([]);
      expect(otherAcknowledgement.organizationId).toBe(otherOrgId);

      await expect(
        createDocumentVersion(store, {
          organizationId: orgId,
          actorId,
          documentId: otherDocument.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("scopes the acknowledgement list to one document through its versions", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const otherOrgId = await seedForeignOrg(tx, `doc_ack_scope_${suffix}`);

      const scopedDocument = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Scoped handbook",
        category: CATEGORY,
        audience: AUDIENCE,
      });
      const scopedVersion = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: scopedDocument.id,
      });
      await publishDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: scopedDocument.id,
        documentVersionId: scopedVersion.id,
      });
      const scopedAcknowledgement = await acknowledgeDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: scopedDocument.id,
      });

      const secondDocument = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Second handbook",
        category: CATEGORY,
        audience: AUDIENCE,
      });
      const secondVersion = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: secondDocument.id,
      });
      await publishDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: secondDocument.id,
        documentVersionId: secondVersion.id,
      });
      const secondAcknowledgement = await acknowledgeDocument(store, {
        organizationId: orgId,
        actorId,
        documentId: secondDocument.id,
      });

      expect(
        (
          await listDocumentAcknowledgements(store, {
            organizationId: orgId,
            documentId: scopedDocument.id,
          })
        ).map((row) => row.id),
      ).toEqual([scopedAcknowledgement.id]);

      expect(
        (await listDocumentAcknowledgements(store, { organizationId: orgId }))
          .map((row) => row.id)
          .sort(),
      ).toEqual([scopedAcknowledgement.id, secondAcknowledgement.id].sort());

      // A document in another organization is not reachable through our org.
      const foreignDocument = await createDocument(store, {
        organizationId: otherOrgId,
        actorId,
        title: "Foreign handbook",
        category: CATEGORY,
        audience: AUDIENCE,
      });
      const foreignVersion = await createDocumentVersion(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: foreignDocument.id,
      });
      await publishDocumentVersion(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: foreignDocument.id,
        documentVersionId: foreignVersion.id,
      });
      await acknowledgeDocument(store, {
        organizationId: otherOrgId,
        actorId,
        documentId: foreignDocument.id,
      });

      expect(
        await listDocumentAcknowledgements(store, {
          organizationId: orgId,
          documentId: foreignDocument.id,
        }),
      ).toEqual([]);
    });
  });

  it("filters and pages the document list", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const actorId = randomUUID();
      const create = (title: string) =>
        createDocument(store, {
          organizationId: orgId,
          actorId,
          title,
          category: CATEGORY,
          audience: AUDIENCE,
        });

      await create("Alice guide");
      await create("Bob guide");
      await create("Carol guide");

      const listed = await listDocuments(store, { organizationId: orgId, limit: 2, offset: 1 });
      expect(listed).toHaveLength(2);
      expect(
        (await listDocuments(store, { organizationId: orgId, category: CATEGORY })).length,
      ).toBe(3);
      expect(
        (await listDocuments(store, { organizationId: orgId, audience: AUDIENCE })).length,
      ).toBe(3);
      expect(
        (await listDocuments(store, { organizationId: orgId, status: "archived" })).length,
      ).toBe(0);
      expect((await listDocuments(store, { organizationId: orgId, status: "draft" })).length).toBe(
        3,
      );
    });
  });

  it("stores a version file through the port and reads it back (DEC-132)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresDocumentsStore(tx);
      const filesStore = createPostgresFileObjectsStore(tx);
      const storage = createLocalFileStorageAdapter({ rootDir: storageRoot });
      const actorId = randomUUID();

      const document = await createDocument(store, {
        organizationId: orgId,
        actorId,
        title: "Fire procedure",
        category: CATEGORY,
        audience: AUDIENCE,
      });

      const bytes = new TextEncoder().encode("evacuate through the back door");
      const file = await storeFileObject(filesStore, storage, {
        organizationId: orgId,
        actorId,
        filename: "fire.pdf",
        mime: "application/pdf",
        retentionPolicy: "document_library",
        bytes,
        linkedEntityType: "document",
        linkedEntityId: document.id,
      });
      expect(file).toMatchObject({
        organizationId: orgId,
        filename: "fire.pdf",
        mime: "application/pdf",
        sizeBytes: bytes.byteLength,
        linkedEntityType: "document",
        linkedEntityId: document.id,
      });

      const version = await createDocumentVersion(store, {
        organizationId: orgId,
        actorId,
        documentId: document.id,
        fileObjectId: file.id,
        notes: "with the procedure attached",
      });
      expect(version.fileObjectId).toBe(file.id);

      const stored = await readFileObject(filesStore, storage, {
        organizationId: orgId,
        fileObjectId: file.id,
      });
      expect(stored?.metadata.filename).toBe("fire.pdf");
      expect(stored?.bytes).toEqual(bytes);

      // The metadata read is organization-scoped: another tenant sees nothing.
      expect(
        await readFileObject(filesStore, storage, {
          organizationId: randomUUID(),
          fileObjectId: file.id,
        }),
      ).toBeUndefined();
    });
  });
});

/**
 * Creates, inside the surrounding rolled-back transaction, a second organization
 * returning its id; the store then exercises cross-organization paths against it.
 */
async function seedForeignOrg(tx: DatabaseTransaction, codeSuffix: string): Promise<string> {
  const rows = await tx
    .insert(organization)
    .values({ legalName: `Documents IT other ${codeSuffix}` })
    .returning();
  return rows[0]!.id;
}
