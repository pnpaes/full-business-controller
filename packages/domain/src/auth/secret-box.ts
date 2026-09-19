import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { DomainError } from "../errors";

/**
 * Authenticated sealing for secrets that must be stored in the database but
 * recovered in plaintext — today only the TOTP shared secret
 * (`user_totp.secret_encrypted`). AES-256-GCM via `node:crypto` only; the key is
 * supplied by the caller (environment/secret manager), never read here and never
 * logged.
 */
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** GCM authentication tag length, in bytes (128 bits). */
const TAG_BYTES = 16;
const VERSION = "v1";
const SEALED_PARTS = 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Decodes a 32-byte base64 key. A wrong key length is a configuration fault, so
 * it fails loudly with a `DomainError` rather than letting `node:crypto` throw a
 * less specific error later.
 */
export function parseSecretKey(base64Key: string): Uint8Array {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_BYTES) {
    throw new DomainError(`secret key must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

/**
 * Seals `plaintext` into a self-describing `v1.<iv>.<ciphertext>.<tag>` string
 * (all binary parts unpadded base64url). A fresh random IV is used per call, so
 * sealing the same plaintext twice produces different output.
 */
export function sealSecret(plaintext: string, key: Uint8Array): string {
  assertKey(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Opens a sealed secret. Any malformed input, unknown version, wrong key or
 * modified byte (IV, ciphertext or tag) fails GCM authentication and throws a
 * `DomainError`; no partial plaintext is ever returned.
 */
export function openSecret(sealed: string, key: Uint8Array): string {
  assertKey(key);

  const parts = sealed.split(".");
  if (parts.length !== SEALED_PARTS) {
    throw new DomainError("sealed secret is malformed");
  }

  const version = parts[0];
  const ivPart = parts[1];
  const ciphertextPart = parts[2];
  const tagPart = parts[3];
  if (
    version === undefined ||
    ivPart === undefined ||
    ciphertextPart === undefined ||
    tagPart === undefined
  ) {
    throw new DomainError("sealed secret is malformed");
  }
  if (version !== VERSION) {
    throw new DomainError("sealed secret has an unknown version");
  }

  const iv = decodeBase64Url(ivPart);
  const ciphertext = decodeBase64Url(ciphertextPart);
  const tag = decodeBase64Url(tagPart);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DomainError("sealed secret is malformed");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DomainError("sealed secret failed authentication");
  }
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new DomainError(`secret key must be ${KEY_BYTES} bytes`);
  }
}

function decodeBase64Url(part: string): Buffer {
  // The ciphertext part is empty when the plaintext is empty; the IV and tag
  // parts are length-checked by the caller.
  if (part.length > 0 && !BASE64URL_PATTERN.test(part)) {
    throw new DomainError("sealed secret is malformed");
  }
  return Buffer.from(part, "base64url");
}
