import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it, vi } from "vitest";

import { acknowledgeDocument } from "./acknowledge-document";
import type { AcknowledgeDocumentInput } from "./acknowledge-document";
import { createDocument, DOCUMENT_AUDIENCES, DOCUMENT_CATEGORIES } from "./create-document";
import type { CreateDocumentInput } from "./create-document";
import { createDocumentVersion } from "./create-document-version";
import type { CreateDocumentVersionInput } from "./create-document-version";
import { findCurrentPublishedVersion } from "./find-current-published-version";
import { findDocument } from "./find-document";
import { findDocumentVersion } from "./find-document-version";
import { DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT } from "./list-document-acknowledgements";
import { listDocumentAcknowledgements } from "./list-document-acknowledgements";
import { DEFAULT_DOCUMENT_VERSION_LIMIT, listDocumentVersions } from "./list-document-versions";
import { DEFAULT_DOCUMENT_LIMIT, listDocuments } from "./list-documents";
import { publishDocumentVersion } from "./publish-document-version";
import type { PublishDocumentVersionInput } from "./publish-document-version";
import { FakeDocumentsStore, seedDocumentsFixture, type DocumentsFixture } from "./test-support";
import type { DocumentRecord, DocumentVersionRecord } from "./types";
import { updateDocument } from "./update-document";
import type { UpdateDocumentInput } from "./update-document";

const CATEGORY = DOCUMENT_CATEGORIES[0]!;
const AUDIENCE = DOCUMENT_AUDIENCES[0]!;

function setup(): { store: FakeDocumentsStore; fixture: DocumentsFixture } {
  const store = new FakeDocumentsStore();
  return { store, fixture: seedDocumentsFixture() };
}

function create(
  store: FakeDocumentsStore,
  fixture: DocumentsFixture,
  overrides: Partial<CreateDocumentInput> = {},
): Promise<DocumentRecord> {
  return createDocument(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    title: "Staff handbook",
    category: CATEGORY,
    audience: AUDIENCE,
    ...overrides,
  });
}

function update(
  store: FakeDocumentsStore,
  fixture: DocumentsFixture,
  document: DocumentRecord,
  overrides: Partial<UpdateDocumentInput> = {},
): Promise<DocumentRecord> {
  return updateDocument(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    documentId: document.id,
    ...overrides,
  });
}

function addVersion(
  store: FakeDocumentsStore,
  fixture: DocumentsFixture,
  document: DocumentRecord,
  overrides: Partial<CreateDocumentVersionInput> = {},
): Promise<DocumentVersionRecord> {
  return createDocumentVersion(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    documentId: document.id,
    ...overrides,
  });
}

function publish(
  store: FakeDocumentsStore,
  fixture: DocumentsFixture,
  document: DocumentRecord,
  version: DocumentVersionRecord,
  overrides: Partial<PublishDocumentVersionInput> = {},
): Promise<DocumentVersionRecord> {
  return publishDocumentVersion(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    documentId: document.id,
    documentVersionId: version.id,
    ...overrides,
  });
}

function acknowledge(
  store: FakeDocumentsStore,
  fixture: DocumentsFixture,
  document: DocumentRecord,
  overrides: Partial<AcknowledgeDocumentInput> = {},
) {
  return acknowledgeDocument(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    documentId: document.id,
    ...overrides,
  });
}

describe("createDocument", () => {
  it("creates a draft document and its audit fact", async () => {
    const { store, fixture } = setup();

    const document = await create(store, fixture, {
      title: "  Staff handbook  ",
      ownerId: "user-1",
    });

    expect(document).toMatchObject({
      organizationId: fixture.organizationId,
      title: "Staff handbook",
      category: CATEGORY,
      audience: AUDIENCE,
      status: "draft",
      ownerId: "user-1",
      updatedAt: null,
    });
    expect(store.documents.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "documents.document.created");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "document",
      entityId: document.id,
      after: {
        title: "Staff handbook",
        category: CATEGORY,
        audience: AUDIENCE,
        status: "draft",
        owner_id: "user-1",
      },
    });
  });

  it("rejects a blank title, an unknown category or an unknown audience without writing", async () => {
    const { store, fixture } = setup();

    await expect(create(store, fixture, { title: "  " })).rejects.toThrow(/title is required/);
    await expect(create(store, fixture, { category: "  " })).rejects.toThrow(
      /category is required/,
    );
    await expect(create(store, fixture, { category: "nonsense" })).rejects.toThrow(
      /category must be one of/,
    );
    await expect(create(store, fixture, { audience: "" })).rejects.toThrow(/audience is required/);
    await expect(create(store, fixture, { audience: "everyone" })).rejects.toThrow(
      /audience must be one of/,
    );

    expect(store.documents.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("updateDocument", () => {
  it("applies a patch and records the before/after diff", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture, { ownerId: "user-1" });

    const updated = await update(store, fixture, document, {
      title: "Staff handbook v2",
      audience: DOCUMENT_AUDIENCES[1]!,
      ownerId: "user-2",
    });

    expect(updated).toMatchObject({
      id: document.id,
      title: "Staff handbook v2",
      audience: DOCUMENT_AUDIENCES[1]!,
      ownerId: "user-2",
    });
    expect(updated.updatedAt).not.toBeNull();

    const audit = store.audits.find((row) => row.action === "documents.document.updated");
    expect(audit).toMatchObject({
      entityType: "document",
      entityId: document.id,
      before: { title: "Staff handbook", audience: AUDIENCE, owner_id: "user-1" },
      after: {
        title: "Staff handbook v2",
        audience: DOCUMENT_AUDIENCES[1]!,
        owner_id: "user-2",
      },
    });
  });

  it("clears the owner with an explicit null", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture, { ownerId: "user-1" });

    const updated = await update(store, fixture, document, { ownerId: null });

    expect(updated.ownerId).toBeNull();
  });

  it("rejects an empty patch", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    await expect(update(store, fixture, document)).rejects.toThrow(/no updatable fields provided/);
    expect(store.audits.filter((row) => row.action === "documents.document.updated")).toHaveLength(
      0,
    );
  });

  it("re-validates a supplied field before writing anything", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    await expect(update(store, fixture, document, { title: "  " })).rejects.toThrow(
      /title is required/,
    );
    await expect(update(store, fixture, document, { category: "nonsense" })).rejects.toThrow(
      /category must be one of/,
    );
    await expect(update(store, fixture, document, { audience: "everyone" })).rejects.toThrow(
      /audience must be one of/,
    );

    expect(store.documents.get(document.id)?.title).toBe("Staff handbook");
    expect(store.audits.filter((row) => row.action === "documents.document.updated")).toHaveLength(
      0,
    );
  });

  it("rejects a status other than archived", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    await expect(update(store, fixture, document, { status: "published" })).rejects.toThrow(
      /status may only be set to "archived"/,
    );
    await expect(update(store, fixture, document, { status: "draft" })).rejects.toThrow(
      DomainError,
    );
    await expect(update(store, fixture, document, { status: "nonsense" })).rejects.toThrow(
      DomainError,
    );

    expect(store.documents.get(document.id)?.status).toBe("draft");
  });

  it("archives a document and audits the status change", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    const archived = await update(store, fixture, document, { status: "archived" });

    expect(archived.status).toBe("archived");
    const audit = store.audits.find((row) => row.action === "documents.document.updated");
    expect(audit).toMatchObject({
      before: { status: "draft" },
      after: { status: "archived" },
    });
  });

  it("makes a repeated archive a true no-op: no second audit fact, record untouched", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    const first = await update(store, fixture, document, { status: "archived" });
    const storedAfterFirst = store.documents.get(document.id);
    const updatedFacts = (): number =>
      store.audits.filter((row) => row.action === "documents.document.updated").length;
    expect(updatedFacts()).toBe(1);

    const second = await update(store, fixture, document, { status: "archived" });

    // The record is returned untouched (same reference: no update was written,
    // so `updated_at` cannot move) and no second audit fact is appended.
    expect(second).toEqual(first);
    expect(store.documents.get(document.id)).toBe(storedAfterFirst);
    expect(updatedFacts()).toBe(1);
  });

  it("reports an unknown or cross-organization row as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await create(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });

    await expect(
      updateDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: "missing",
        title: "Ghost",
      }),
    ).rejects.toThrow(NotFoundError);
    // The org filter is load-bearing: dropping it would edit the other row.
    await expect(
      updateDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: other.id,
        title: "Hijacked",
      }),
    ).rejects.toThrow(NotFoundError);

    expect(store.documents.get(other.id)?.title).toBe("Staff handbook");
  });
});

describe("createDocumentVersion", () => {
  it("numbers the first version 1 and the next 2, with audit facts", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    const first = await addVersion(store, fixture, document, { notes: "Initial" });
    const second = await addVersion(store, fixture, document, { fileObjectId: "file-1" });

    expect(first).toMatchObject({
      organizationId: fixture.organizationId,
      documentId: document.id,
      version: 1,
      fileObjectId: null,
      notes: "Initial",
      publishedAt: null,
      publishedBy: null,
    });
    expect(second).toMatchObject({ version: 2, fileObjectId: "file-1", notes: null });

    const audits = store.audits.filter(
      (row) => row.action === "documents.document_version.created",
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      entityType: "document_version",
      entityId: first.id,
      after: { document_id: document.id, version: 1, file_object_id: null, notes: "Initial" },
    });
    expect(audits[1]).toMatchObject({ entityId: second.id, after: { version: 2 } });
  });

  it("reports a missing or cross-organization document as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });

    await expect(
      createDocumentVersion(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: "missing",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(addVersion(store, fixture, other)).rejects.toThrow(NotFoundError);

    expect(store.documentVersions.size).toBe(0);
  });

  it("refuses a new version for an archived document", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    await update(store, fixture, document, { status: "archived" });

    await expect(addVersion(store, fixture, document)).rejects.toThrow(DomainError);
    expect(store.documentVersions.size).toBe(0);
    expect(
      store.audits.filter((row) => row.action === "documents.document_version.created"),
    ).toHaveLength(0);
  });

  it("locks the document before numbering the new version", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const lock = vi.spyOn(store, "lockDocument");

    await addVersion(store, fixture, document);

    expect(lock).toHaveBeenCalledWith({
      organizationId: fixture.organizationId,
      documentId: document.id,
    });
  });
});

describe("publishDocumentVersion", () => {
  it("publishes the latest version, promotes a draft document and audits", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);

    const published = await publish(store, fixture, document, version);

    expect(published.publishedAt).not.toBeNull();
    expect(new Date(published.publishedAt!).toISOString()).toBe(published.publishedAt);
    expect(published.publishedBy).toBe(fixture.actorId);
    expect(
      (
        await findDocument(store, {
          organizationId: fixture.organizationId,
          documentId: document.id,
        })
      )?.status,
    ).toBe("published");

    const audit = store.audits.find((row) => row.action === "documents.document_version.published");
    expect(audit).toMatchObject({
      entityType: "document_version",
      entityId: version.id,
      before: { published_at: null, published_by: null, document_status: "draft" },
      after: {
        published_at: published.publishedAt,
        published_by: fixture.actorId,
        document_status: "published",
      },
    });
  });

  it("rejects a version that is already published", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await publish(store, fixture, document, version);

    await expect(publish(store, fixture, document, version)).rejects.toThrow(/already published/);
  });

  it("refuses to publish an older version once a newer one exists", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const first = await addVersion(store, fixture, document);
    await addVersion(store, fixture, document);

    await expect(publish(store, fixture, document, first)).rejects.toThrow(
      /only the latest version can be published/,
    );
    expect(store.documentVersions.get(first.id)?.publishedAt).toBeNull();
  });

  it("rejects a version that belongs to another document", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const otherDocument = await create(store, fixture, { title: "Other" });
    const otherVersion = await addVersion(store, fixture, otherDocument);

    await expect(
      publishDocumentVersion(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: document.id,
        documentVersionId: otherVersion.id,
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("refuses to publish an archived document", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await update(store, fixture, document, { status: "archived" });

    await expect(publish(store, fixture, document, version)).rejects.toThrow(DomainError);
  });

  it("reports a missing or cross-organization document or version as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });
    const otherVersion = await addVersion(store, fixture, other, {
      organizationId: fixture.otherOrganizationId,
    });
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);

    await expect(
      publishDocumentVersion(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: "missing",
        documentVersionId: version.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      publishDocumentVersion(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: document.id,
        documentVersionId: "missing",
      }),
    ).rejects.toThrow(NotFoundError);
    // The org filter is load-bearing: the other tenant's version is invisible.
    await expect(publish(store, fixture, other, otherVersion)).rejects.toThrow(NotFoundError);
  });

  it("locks the document before checking which version is latest", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    const lock = vi.spyOn(store, "lockDocument");

    await publish(store, fixture, document, version);

    expect(lock).toHaveBeenCalledWith({
      organizationId: fixture.organizationId,
      documentId: document.id,
    });
  });
});

describe("acknowledgeDocument", () => {
  it("records an acknowledgement of the latest published version and audits", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await publish(store, fixture, document, version);

    const acknowledgement = await acknowledge(store, fixture, document);

    expect(acknowledgement).toMatchObject({
      organizationId: fixture.organizationId,
      documentVersionId: version.id,
      acknowledgedBy: fixture.actorId,
    });

    const audit = store.audits.find(
      (row) => row.action === "documents.document_acknowledgement.created",
    );
    expect(audit).toMatchObject({
      entityType: "document_acknowledgement",
      entityId: acknowledgement.id,
      after: {
        document_version_id: version.id,
        acknowledged_by: fixture.actorId,
        acknowledged_at: acknowledgement.acknowledgedAt,
      },
    });
  });

  it("acknowledges an explicitly supplied published version", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await publish(store, fixture, document, version);

    const acknowledgement = await acknowledge(store, fixture, document, {
      documentVersionId: version.id,
      actorId: fixture.otherActorId,
    });

    expect(acknowledgement).toMatchObject({
      documentVersionId: version.id,
      acknowledgedBy: fixture.otherActorId,
    });
  });

  it("is idempotent: a repeat returns the same fact with no new audit fact", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await publish(store, fixture, document, version);

    const first = await acknowledge(store, fixture, document);
    const facts = (): number =>
      store.audits.filter((row) => row.action === "documents.document_acknowledgement.created")
        .length;
    expect(facts()).toBe(1);

    const second = await acknowledge(store, fixture, document);

    expect(second).toEqual(first);
    expect(store.documentAcknowledgements.size).toBe(1);
    expect(facts()).toBe(1);
  });

  it("rejects an explicitly supplied unpublished or foreign version", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const draftVersion = await addVersion(store, fixture, document);
    const otherDocument = await create(store, fixture, { title: "Other" });
    const otherVersion = await addVersion(store, fixture, otherDocument);
    await publish(store, fixture, otherDocument, otherVersion);

    await expect(
      acknowledge(store, fixture, document, { documentVersionId: draftVersion.id }),
    ).rejects.toThrow(/only a published version/);
    await expect(
      acknowledge(store, fixture, document, { documentVersionId: otherVersion.id }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      acknowledge(store, fixture, document, { documentVersionId: "missing" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects a document with no published version to resolve", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);

    await expect(acknowledge(store, fixture, document)).rejects.toThrow(
      /no published version to acknowledge/,
    );

    const withDraftOnly = await create(store, fixture, { title: "Draft only" });
    await addVersion(store, fixture, withDraftOnly);
    await expect(acknowledge(store, fixture, withDraftOnly)).rejects.toThrow(DomainError);
  });

  it("reports a missing or cross-organization document as NotFoundError", async () => {
    const { store, fixture } = setup();
    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });

    await expect(
      acknowledgeDocument(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        documentId: "missing",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(acknowledge(store, fixture, other)).rejects.toThrow(NotFoundError);
  });

  it("acknowledges the current published version when a newer version is unpublished", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const published = await addVersion(store, fixture, document);
    await publish(store, fixture, document, published);
    // A newer draft must not shadow the still-current published version.
    const draft = await addVersion(store, fixture, document);
    expect(draft.version).toBe(2);

    const acknowledgement = await acknowledge(store, fixture, document);

    expect(acknowledgement.documentVersionId).toBe(published.id);
  });
});

describe("findCurrentPublishedVersion", () => {
  it("returns the greatest published version, ignoring a newer unpublished one", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const first = await addVersion(store, fixture, document);
    await publish(store, fixture, document, first);
    await addVersion(store, fixture, document);

    expect(
      (
        await findCurrentPublishedVersion(store, {
          organizationId: fixture.organizationId,
          documentId: document.id,
        })
      )?.id,
    ).toBe(first.id);
  });

  it("returns undefined when no version is published or the scope misses", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    await addVersion(store, fixture, document);

    expect(
      await findCurrentPublishedVersion(store, {
        organizationId: fixture.organizationId,
        documentId: document.id,
      }),
    ).toBeUndefined();

    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });
    const otherVersion = await addVersion(store, fixture, other, {
      organizationId: fixture.otherOrganizationId,
    });
    await publish(store, fixture, other, otherVersion, {
      organizationId: fixture.otherOrganizationId,
    });

    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findCurrentPublishedVersion(store, {
        organizationId: fixture.organizationId,
        documentId: other.id,
      }),
    ).toBeUndefined();
  });
});

describe("findDocument and listDocuments", () => {
  it("finds a row for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });

    expect(
      (
        await findDocument(store, {
          organizationId: fixture.organizationId,
          documentId: document.id,
        })
      )?.id,
    ).toBe(document.id);
    // The org filter is load-bearing: dropping it would return the other row.
    expect(
      await findDocument(store, { organizationId: fixture.organizationId, documentId: other.id }),
    ).toBeUndefined();
    expect(
      await findDocument(store, { organizationId: fixture.organizationId, documentId: "missing" }),
    ).toBeUndefined();
  });

  it("returns nothing for an organization that holds no rows", async () => {
    const { store, fixture } = setup();
    await create(store, fixture, { organizationId: fixture.otherOrganizationId });

    expect(await listDocuments(store, { organizationId: fixture.organizationId })).toEqual([]);
  });

  it("orders by title and applies the category, audience and status filters", async () => {
    const { store, fixture } = setup();
    const alice = await create(store, fixture, { title: "Alice guide", category: CATEGORY });
    await create(store, fixture, { title: "Bob guide", category: DOCUMENT_CATEGORIES[1]! });
    const carol = await create(store, fixture, {
      title: "Carol guide",
      audience: DOCUMENT_AUDIENCES[1]!,
    });
    await update(store, fixture, carol, { status: "archived" });

    expect(
      (await listDocuments(store, { organizationId: fixture.organizationId })).map((d) => d.title),
    ).toEqual(["Alice guide", "Bob guide", "Carol guide"]);
    expect(
      (
        await listDocuments(store, {
          organizationId: fixture.organizationId,
          category: CATEGORY,
        })
      ).map((d) => d.title),
    ).toEqual(["Alice guide", "Carol guide"]);
    expect(
      (
        await listDocuments(store, {
          organizationId: fixture.organizationId,
          audience: DOCUMENT_AUDIENCES[1]!,
        })
      ).map((d) => d.title),
    ).toEqual(["Carol guide"]);
    expect(
      (
        await listDocuments(store, {
          organizationId: fixture.organizationId,
          status: "archived",
        })
      ).map((d) => d.title),
    ).toEqual(["Carol guide"]);
    expect(alice.status).toBe("draft");
  });

  it("rejects an unknown filter value as a DomainError", async () => {
    const { store, fixture } = setup();
    await create(store, fixture);

    await expect(
      listDocuments(store, { organizationId: fixture.organizationId, category: "nonsense" }),
    ).rejects.toThrow(/category must be one of/);
    await expect(
      listDocuments(store, { organizationId: fixture.organizationId, audience: "everyone" }),
    ).rejects.toThrow(/audience must be one of/);
    await expect(
      listDocuments(store, { organizationId: fixture.organizationId, status: "retired" }),
    ).rejects.toThrow(/status must be one of/);
  });

  it("pages after the ordering and caps an unbounded read at the default limit", async () => {
    const { store, fixture } = setup();
    for (let index = 0; index < DEFAULT_DOCUMENT_LIMIT + 3; index += 1) {
      await create(store, fixture, { title: `Doc ${String(index).padStart(3, "0")}` });
    }

    // The fake mirrors the adapter: an omitted `limit` is bounded, not unbounded.
    expect(await store.listDocuments({ organizationId: fixture.organizationId })).toHaveLength(
      DEFAULT_DOCUMENT_LIMIT,
    );

    const firstPage = await listDocuments(store, { organizationId: fixture.organizationId });
    expect(firstPage).toHaveLength(DEFAULT_DOCUMENT_LIMIT);
    expect(firstPage[0]?.title).toBe("Doc 000");

    const secondPage = await listDocuments(store, {
      organizationId: fixture.organizationId,
      offset: DEFAULT_DOCUMENT_LIMIT,
    });
    expect(secondPage.map((d) => d.title)).toEqual(["Doc 050", "Doc 051", "Doc 052"]);

    const windowed = await listDocuments(store, {
      organizationId: fixture.organizationId,
      limit: 2,
      offset: 1,
    });
    expect(windowed.map((d) => d.title)).toEqual(["Doc 001", "Doc 002"]);
  });
});

describe("findDocumentVersion and listDocumentVersions", () => {
  it("finds a version for its organization and undefined for a scoped miss", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    const other = await create(store, fixture, { organizationId: fixture.otherOrganizationId });
    const otherVersion = await addVersion(store, fixture, other, {
      organizationId: fixture.otherOrganizationId,
    });

    expect(
      (
        await findDocumentVersion(store, {
          organizationId: fixture.organizationId,
          documentVersionId: version.id,
        })
      )?.id,
    ).toBe(version.id);
    expect(
      await findDocumentVersion(store, {
        organizationId: fixture.organizationId,
        documentVersionId: otherVersion.id,
      }),
    ).toBeUndefined();
    expect(
      await findDocumentVersion(store, {
        organizationId: fixture.organizationId,
        documentVersionId: "missing",
      }),
    ).toBeUndefined();
  });

  it("caps an unbounded version read at the default limit", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    for (let index = 0; index < DEFAULT_DOCUMENT_VERSION_LIMIT + 2; index += 1) {
      await store.createDocumentVersion({
        organizationId: fixture.organizationId,
        documentId: document.id,
        version: index + 1,
        fileObjectId: null,
        notes: null,
        createdBy: fixture.actorId,
      });
    }

    expect(
      await listDocumentVersions(store, {
        organizationId: fixture.organizationId,
        documentId: document.id,
      }),
    ).toHaveLength(DEFAULT_DOCUMENT_VERSION_LIMIT);
  });
});

describe("listDocumentAcknowledgements", () => {
  it("filters by version and user, and caps an unbounded read at the default limit", async () => {
    const { store, fixture } = setup();
    const document = await create(store, fixture);
    const version = await addVersion(store, fixture, document);
    await publish(store, fixture, document, version);

    for (let index = 0; index < DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT + 2; index += 1) {
      await store.createDocumentAcknowledgement({
        organizationId: fixture.organizationId,
        documentVersionId: version.id,
        acknowledgedBy: `user-${String(index).padStart(3, "0")}`,
        acknowledgedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      });
    }
    await acknowledge(store, fixture, document, { actorId: fixture.otherActorId });

    expect(
      await store.listDocumentAcknowledgements({ organizationId: fixture.organizationId }),
    ).toHaveLength(DEFAULT_DOCUMENT_ACKNOWLEDGEMENT_LIMIT);

    expect(
      (
        await listDocumentAcknowledgements(store, {
          organizationId: fixture.organizationId,
          acknowledgedBy: fixture.otherActorId,
        })
      ).map((row) => row.acknowledgedBy),
    ).toEqual([fixture.otherActorId]);

    expect(
      await listDocumentAcknowledgements(store, {
        organizationId: fixture.organizationId,
        documentVersionId: version.id,
        limit: 2,
        offset: 1,
      }),
    ).toHaveLength(2);
  });

  it("scopes the register to one document through its versions", async () => {
    const { store, fixture } = setup();
    const firstDocument = await create(store, fixture);
    const firstVersion = await addVersion(store, fixture, firstDocument);
    await publish(store, fixture, firstDocument, firstVersion);
    const firstAcknowledgement = await acknowledge(store, fixture, firstDocument);

    const secondDocument = await create(store, fixture, { title: "Second handbook" });
    const secondVersion = await addVersion(store, fixture, secondDocument);
    await publish(store, fixture, secondDocument, secondVersion);
    const secondAcknowledgement = await acknowledge(store, fixture, secondDocument);

    expect(
      (
        await listDocumentAcknowledgements(store, {
          organizationId: fixture.organizationId,
          documentId: firstDocument.id,
        })
      ).map((row) => row.id),
    ).toEqual([firstAcknowledgement.id]);

    expect(
      (await listDocumentAcknowledgements(store, { organizationId: fixture.organizationId }))
        .map((row) => row.id)
        .sort(),
    ).toEqual([firstAcknowledgement.id, secondAcknowledgement.id].sort());

    const foreignDocument = await create(store, fixture, {
      organizationId: fixture.otherOrganizationId,
    });
    const foreignVersion = await addVersion(store, fixture, foreignDocument, {
      organizationId: fixture.otherOrganizationId,
    });
    await publish(store, fixture, foreignDocument, foreignVersion, {
      organizationId: fixture.otherOrganizationId,
    });
    await acknowledge(store, fixture, foreignDocument, {
      organizationId: fixture.otherOrganizationId,
      actorId: fixture.otherActorId,
    });

    expect(
      await listDocumentAcknowledgements(store, {
        organizationId: fixture.organizationId,
        documentId: foreignDocument.id,
      }),
    ).toEqual([]);
  });
});
