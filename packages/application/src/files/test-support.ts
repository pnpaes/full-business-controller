import { randomUUID } from "node:crypto";

import { sha256Hex } from "./checksum";
import type { FileStoragePort, PutFileInput, StoredFileInfo } from "./file-storage";
import type { FileObjectRecord, FileObjectsStore, NewFileObjectRecord } from "./types";
import type { AuditInput } from "../auth";

interface FileObjectsSnapshot {
  readonly fileObjects: Map<string, FileObjectRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `FileObjectsStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping and rolls back on a failed transaction; the
 * integration suite covers the real adapter.
 */
export class FakeFileObjectsStore implements FileObjectsStore {
  readonly fileObjects = new Map<string, FileObjectRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  async withTransaction<T>(fn: (store: FileObjectsStore) => Promise<T>): Promise<T> {
    const snapshot: FileObjectsSnapshot = {
      fileObjects: new Map(this.fileObjects),
      audits: [...this.audits],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.fileObjects.clear();
      for (const [key, value] of snapshot.fileObjects) this.fileObjects.set(key, value);
      this.audits.length = 0;
      this.audits.push(...snapshot.audits);
      throw error;
    }
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createFileObject(input: NewFileObjectRecord): Promise<FileObjectRecord> {
    this.sequence += 1;
    const record: FileObjectRecord = {
      id: `file-object-${this.sequence}`,
      organizationId: input.organizationId,
      storageKey: input.storageKey,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      retentionPolicy: input.retentionPolicy,
      uploadedBy: input.uploadedBy,
      uploadedAt: new Date().toISOString(),
      linkedEntityType: input.linkedEntityType,
      linkedEntityId: input.linkedEntityId,
      createdAt: new Date().toISOString(),
    };
    this.fileObjects.set(record.id, record);
    return record;
  }

  async findFileObject(query: {
    readonly organizationId: string;
    readonly fileObjectId: string;
  }): Promise<FileObjectRecord | undefined> {
    const record = this.fileObjects.get(query.fileObjectId);
    return record !== undefined && record.organizationId === query.organizationId
      ? record
      : undefined;
  }
}

/** In-memory `FileStoragePort` for the unit suite: a byte map with a real SHA-256. */
export class FakeFileStoragePort implements FileStoragePort {
  readonly objects = new Map<string, Uint8Array>();

  async put(input: PutFileInput): Promise<StoredFileInfo> {
    const copy = Uint8Array.from(input.bytes);
    this.objects.set(input.storageKey, copy);
    return { sizeBytes: copy.byteLength, checksumSha256: sha256Hex(copy) };
  }

  async get(storageKey: string): Promise<Uint8Array | undefined> {
    const bytes = this.objects.get(storageKey);
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }

  async remove(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }
}

/** A stable organization id for the unit fixtures. */
export function fakeOrganizationId(): string {
  return randomUUID();
}
