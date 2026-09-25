import { createHash } from "node:crypto";

/**
 * Lowercase hex SHA-256 of a byte array (`ADR-0006` requires a stored checksum).
 * Kept in one place so the write path (metadata) and the read path
 * (verification) cannot drift.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
