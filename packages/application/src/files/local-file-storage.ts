import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { DomainError } from "@aquarela/domain";

import { sha256Hex } from "./checksum";
import type { FileStoragePort, PutFileInput, StoredFileInfo } from "./file-storage";
import { assertSafeStorageKey } from "./storage-key";

export interface LocalFileStorageOptions {
  /** The directory every object is written under. Resolved once, at creation. */
  readonly rootDir: string;
}

/**
 * The local-filesystem `FileStoragePort` (`DEC-132`): the only adapter built in
 * this slice. Bytes live under a gitignored root (`FILE_STORAGE_ROOT`, default
 * `<cwd>/storage/files`), so they never enter git and never enter a database
 * backup. This is a **development/single-node** ceiling, named in `DEC-132`:
 * a multi-instance deploy needs the Spaces adapter (`DEC-014`) or a shared
 * volume, and there is no replication or lifecycle rule here.
 *
 * The adapter computes the size and SHA-256 itself, so the metadata row can
 * never claim a checksum the stored bytes do not have. Every key is validated
 * (`assertSafeStorageKey`) and the joined path is re-checked to stay inside the
 * root, so no storage key can escape it.
 */
export function createLocalFileStorageAdapter(options: LocalFileStorageOptions): FileStoragePort {
  const root = resolve(options.rootDir);

  const pathFor = (storageKey: string): string => {
    assertSafeStorageKey(storageKey);
    const full = resolve(root, storageKey);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new DomainError("storage key escapes the storage root");
    }
    return full;
  };

  return {
    async put(input: PutFileInput): Promise<StoredFileInfo> {
      const full = pathFor(input.storageKey);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, input.bytes);
      return {
        sizeBytes: input.bytes.byteLength,
        checksumSha256: sha256Hex(input.bytes),
      };
    },

    async get(storageKey: string): Promise<Uint8Array | undefined> {
      const full = pathFor(storageKey);
      try {
        return new Uint8Array(await readFile(full));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },

    async remove(storageKey: string): Promise<void> {
      await rm(pathFor(storageKey), { force: true });
    },
  };
}
