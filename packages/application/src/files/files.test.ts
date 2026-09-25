import { DomainError } from "@aquarela/domain";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256Hex } from "./checksum";
import { createLocalFileStorageAdapter } from "./local-file-storage";
import { DEFAULT_FILE_OBJECT_LIST_LIMIT, listFileObjects } from "./list-file-objects";
import { readFileObject } from "./read-file-object";
import { assertSafeStorageKey, buildStorageKey, extensionOf } from "./storage-key";
import { storeFileObject } from "./store-file-object";
import { FakeFileObjectsStore, FakeFileStoragePort } from "./test-support";

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

function fixtures(): { store: FakeFileObjectsStore; storage: FakeFileStoragePort } {
  return { store: new FakeFileObjectsStore(), storage: new FakeFileStoragePort() };
}

describe("storeFileObject", () => {
  it("stores the bytes and creates an organization-scoped metadata row with its audit fact", async () => {
    const { store, storage } = fixtures();
    const bytes = bytesOf("opening procedure v2");

    const record = await storeFileObject(store, storage, {
      organizationId: ORG,
      actorId: ACTOR,
      filename: "opening.pdf",
      mime: "application/pdf",
      retentionPolicy: "document_library",
      bytes,
      linkedEntityType: "document",
      linkedEntityId: "doc-1",
    });

    expect(record).toMatchObject({
      organizationId: ORG,
      filename: "opening.pdf",
      mime: "application/pdf",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256Hex(bytes),
      retentionPolicy: "document_library",
      uploadedBy: ACTOR,
      linkedEntityType: "document",
      linkedEntityId: "doc-1",
    });
    expect(record.storageKey).toBe(`${ORG}/${record.storageKey.split("/")[1]}`);
    expect(storage.objects.get(record.storageKey)).toEqual(bytes);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: ORG,
      actorId: ACTOR,
      action: "files.file_object.created",
      entityType: "file_object",
      entityId: record.id,
    });
  });

  it("rejects an empty upload before touching storage", async () => {
    const { store, storage } = fixtures();

    await expect(
      storeFileObject(store, storage, {
        organizationId: ORG,
        actorId: ACTOR,
        filename: "empty.txt",
        mime: "text/plain",
        retentionPolicy: "document_library",
        bytes: new Uint8Array(0),
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(storage.objects.size).toBe(0);
    expect(store.fileObjects.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it.each([
    { field: "filename", input: { filename: "   " } },
    { field: "mime", input: { mime: "" } },
    { field: "retentionPolicy", input: { retentionPolicy: " " } },
  ])("rejects a blank $field", async ({ input }) => {
    const { store, storage } = fixtures();

    await expect(
      storeFileObject(store, storage, {
        organizationId: ORG,
        actorId: ACTOR,
        filename: "notes.txt",
        mime: "text/plain",
        retentionPolicy: "document_library",
        bytes: bytesOf("x"),
        ...input,
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(storage.objects.size).toBe(0);
  });

  it("compensates by removing the bytes when the metadata write fails", async () => {
    const { store, storage } = fixtures();
    store.createFileObject = async () => {
      throw new Error("metadata store unavailable");
    };

    await expect(
      storeFileObject(store, storage, {
        organizationId: ORG,
        actorId: ACTOR,
        filename: "notes.txt",
        mime: "text/plain",
        retentionPolicy: "document_library",
        bytes: bytesOf("important"),
      }),
    ).rejects.toThrow("metadata store unavailable");

    expect(storage.objects.size).toBe(0);
  });
});

describe("readFileObject", () => {
  async function seed(): Promise<{
    store: FakeFileObjectsStore;
    storage: FakeFileStoragePort;
    fileObjectId: string;
    bytes: Uint8Array;
  }> {
    const { store, storage } = fixtures();
    const bytes = bytesOf("stored content");
    const record = await storeFileObject(store, storage, {
      organizationId: ORG,
      actorId: ACTOR,
      filename: "content.txt",
      mime: "text/plain",
      retentionPolicy: "document_library",
      bytes,
    });
    return { store, storage, fileObjectId: record.id, bytes };
  }

  it("returns the metadata and the bytes for the owning organization", async () => {
    const { store, storage, fileObjectId, bytes } = await seed();

    const stored = await readFileObject(store, storage, {
      organizationId: ORG,
      fileObjectId,
    });

    expect(stored?.metadata.filename).toBe("content.txt");
    expect(stored?.bytes).toEqual(bytes);
  });

  it("returns undefined for an unknown file object id", async () => {
    const { store, storage } = await seed();

    const stored = await readFileObject(store, storage, {
      organizationId: ORG,
      fileObjectId: "does-not-exist",
    });

    expect(stored).toBeUndefined();
  });

  it("returns undefined when the organization does not match (tenant isolation)", async () => {
    const { store, storage, fileObjectId } = await seed();

    const stored = await readFileObject(store, storage, {
      organizationId: OTHER_ORG,
      fileObjectId,
    });

    expect(stored).toBeUndefined();
  });

  it("raises when the metadata row exists but the bytes are gone", async () => {
    const { store, storage, fileObjectId } = await seed();
    const key = [...storage.objects.keys()][0]!;
    storage.objects.delete(key);

    await expect(
      readFileObject(store, storage, { organizationId: ORG, fileObjectId }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("raises when the stored bytes no longer match the recorded checksum", async () => {
    const { store, storage, fileObjectId } = await seed();
    const key = [...storage.objects.keys()][0]!;
    storage.objects.set(key, bytesOf("tampered"));

    await expect(
      readFileObject(store, storage, { organizationId: ORG, fileObjectId }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("listFileObjects", () => {
  async function seedLinked(
    store: FakeFileObjectsStore,
    storage: FakeFileStoragePort,
    linkedEntityType: string,
    linkedEntityId: string,
    organizationId = ORG,
  ) {
    return storeFileObject(store, storage, {
      organizationId,
      actorId: ACTOR,
      filename: "evidence.jpg",
      mime: "image/jpeg",
      retentionPolicy: "hms_incident_evidence",
      bytes: bytesOf("evidence"),
      linkedEntityType,
      linkedEntityId,
    });
  }

  it("returns the metadata for one entity link, never the bytes", async () => {
    const { store, storage } = fixtures();
    const mine = await seedLinked(store, storage, "hms_incident", "incident-1");
    await seedLinked(store, storage, "hms_incident", "incident-2");
    await seedLinked(store, storage, "equipment", "incident-1");

    const rows = await listFileObjects(store, {
      organizationId: ORG,
      linkedEntityType: "hms_incident",
      linkedEntityId: "incident-1",
    });

    expect(rows.map((row) => row.id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({
      filename: "evidence.jpg",
      mime: "image/jpeg",
      linkedEntityType: "hms_incident",
      linkedEntityId: "incident-1",
    });
    expect(rows[0]).not.toHaveProperty("bytes");
  });

  it("returns nothing for another organization (tenant isolation)", async () => {
    const { store, storage } = fixtures();
    await seedLinked(store, storage, "hms_incident", "incident-1", OTHER_ORG);

    const rows = await listFileObjects(store, {
      organizationId: ORG,
      linkedEntityType: "hms_incident",
      linkedEntityId: "incident-1",
    });

    expect(rows).toEqual([]);
  });

  it("applies the default limit when the caller does not ask for one", async () => {
    const { store } = fixtures();
    const queries: unknown[] = [];
    const original = store.listFileObjects.bind(store);
    store.listFileObjects = async (query) => {
      queries.push(query);
      return original(query);
    };

    await listFileObjects(store, {
      organizationId: ORG,
      linkedEntityType: "hms_incident",
      linkedEntityId: "incident-1",
    });

    expect(queries[0]).toMatchObject({ limit: DEFAULT_FILE_OBJECT_LIST_LIMIT });
  });
});

describe("storage keys", () => {
  it("builds an organization-scoped key that keeps a safe extension", () => {
    const key = buildStorageKey(ORG, "Handbook.PDF");
    expect(key.startsWith(`${ORG}/`)).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(() => assertSafeStorageKey(key)).not.toThrow();
  });

  it("drops an unsafe or absent extension", () => {
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
    expect(extensionOf("weird.`ext`")).toBe("");
  });

  it("rejects a traversal, absolute or empty storage key", () => {
    for (const key of ["../escape", "a/../../b", "/etc/passwd", "a\\b", "", "a/./b"]) {
      expect(() => assertSafeStorageKey(key)).toThrow(DomainError);
    }
    expect(() => assertSafeStorageKey(`${ORG}/abc-123.pdf`)).not.toThrow();
  });
});

describe("local file storage adapter", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "aquarela-files-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes, reports a real checksum and is idempotent on remove", async () => {
    const adapter = createLocalFileStorageAdapter({ rootDir: root });
    const bytes = bytesOf("hello storage");

    const info = await adapter.put({ storageKey: `${ORG}/nested/object.txt`, bytes });
    expect(info.sizeBytes).toBe(bytes.byteLength);
    expect(info.checksumSha256).toBe(sha256Hex(bytes));

    expect(await adapter.get(`${ORG}/nested/object.txt`)).toEqual(bytes);
    expect(await adapter.get(`${ORG}/missing.txt`)).toBeUndefined();

    await adapter.remove(`${ORG}/nested/object.txt`);
    expect(await adapter.get(`${ORG}/nested/object.txt`)).toBeUndefined();
    await expect(adapter.remove(`${ORG}/nested/object.txt`)).resolves.toBeUndefined();
  });

  it("refuses a storage key that escapes the root", async () => {
    const adapter = createLocalFileStorageAdapter({ rootDir: root });

    await expect(
      adapter.put({ storageKey: "../escape.txt", bytes: bytesOf("nope") }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
