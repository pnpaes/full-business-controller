import { createLocalFileStorageAdapter, type FileStoragePort } from "@aquarela/application";
import { join } from "node:path";

/**
 * The web layer's single `FileStoragePort` (`DEC-132`). Module-scoped, created
 * once per process on first use (the `getDb` pattern), so every route shares one
 * adapter. The root is `FILE_STORAGE_ROOT` when set, otherwise
 * `<cwd>/storage/files` — that path is git-ignored (`.gitignore`), so stored
 * bytes never enter git.
 *
 * Only the local filesystem adapter exists today; swapping in the Spaces adapter
 * (`DEC-014`, `ADR-0006`) is a change to this one function, because everything
 * else depends on the `FileStoragePort` interface.
 */
const globalForFileStorage = globalThis as typeof globalThis & {
  __aquarelaFileStorage?: FileStoragePort;
};

export function getFileStorage(): FileStoragePort {
  const configured = process.env.FILE_STORAGE_ROOT?.trim();
  globalForFileStorage.__aquarelaFileStorage ??= createLocalFileStorageAdapter({
    rootDir:
      configured !== undefined && configured.length > 0
        ? configured
        : join(process.cwd(), "storage", "files"),
  });
  return globalForFileStorage.__aquarelaFileStorage;
}
