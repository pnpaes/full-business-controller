import { randomUUID } from "node:crypto";

import { DomainError } from "@aquarela/domain";

/**
 * Storage-key construction and path safety for the file-storage slice
 * (`DEC-132`). A storage key is a POSIX-style relative path under the adapter's
 * root; it is built here, never supplied by a request, so no caller-controlled
 * value can reach the adapter's path join.
 *
 * The key is `<organizationId>/<random-uuid><extension>`: organization-scoped
 * for an operator browsing the root, and collision-free **without** deduplicating
 * identical bytes (content addressing is a recorded deferral in `DEC-132`). The
 * `(organization_id, storage_key)` unique on `file_object` is the backstop.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;

/** The lowercased extension of `filename`, or `""` when unsafe/absent. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return "";
  }
  const extension = filename.slice(dot);
  return SAFE_EXTENSION.test(extension) ? extension.toLowerCase() : "";
}

/** A fresh, organization-scoped storage key for one upload. */
export function buildStorageKey(organizationId: string, filename: string): string {
  if (!SAFE_SEGMENT.test(organizationId)) {
    throw new DomainError("organizationId is not storage-key safe");
  }
  return `${organizationId}/${randomUUID()}${extensionOf(filename)}`;
}

/**
 * Rejects any storage key that is not a set of safe relative path segments, so a
 * key can never be `..`, absolute, backslash-separated or empty. Called by the
 * local adapter before it joins the key to its root (defence in depth: every
 * key is generated above, but the adapter is a public port).
 */
export function assertSafeStorageKey(storageKey: string): void {
  if (
    storageKey.length === 0 ||
    storageKey.startsWith("/") ||
    storageKey.includes("\\") ||
    storageKey.includes("\0")
  ) {
    throw new DomainError("invalid storage key");
  }
  const segments = storageKey.split("/");
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment))) {
    throw new DomainError("invalid storage key");
  }
}
