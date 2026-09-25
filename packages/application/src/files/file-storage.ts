/**
 * The byte-storage port for the file-storage slice (`DEC-132`).
 *
 * It is deliberately storage-agnostic and byte-oriented: `put` persists a byte
 * array under a caller-supplied storage key and reports what it stored (size and
 * SHA-256, computed by the storage layer so the port can never disagree with the
 * bytes it holds); `get` returns the bytes or `undefined` when the key is
 * absent; `remove` deletes the bytes and is idempotent. There is no signing, no
 * URL and no retention logic here — those are recorded deferrals in `DEC-132`.
 *
 * `createLocalFileStorageAdapter` (see `./local-file-storage`) is the only
 * implementation today; a DigitalOcean Spaces adapter (`DEC-014`, `ADR-0006`)
 * is a later implementation behind this interface, which is the seam that keeps
 * the application and web layers provider-neutral.
 */

export interface PutFileInput {
  /** A safe relative path built by `buildStorageKey`, never request input. */
  readonly storageKey: string;
  readonly bytes: Uint8Array;
}

export interface StoredFileInfo {
  /** Byte length; a non-negative integer, never a float. */
  readonly sizeBytes: number;
  /** Lowercase hex SHA-256 of the stored bytes. */
  readonly checksumSha256: string;
}

export interface FileStoragePort {
  put(input: PutFileInput): Promise<StoredFileInfo>;
  /** The bytes under `storageKey`, or `undefined` when no object is stored. */
  get(storageKey: string): Promise<Uint8Array | undefined>;
  /** Deletes the bytes; a missing key is not an error (idempotent). */
  remove(storageKey: string): Promise<void>;
}
