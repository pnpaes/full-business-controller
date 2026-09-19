import type { AuthStore, RequestContext } from "./types";

export interface AuthAuditInput {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityId: string | null;
  readonly entityType?: string;
  readonly reason?: string;
  readonly request?: RequestContext;
  /** Security-change diff (ADR-0003); never secrets, tokens or hashes. */
  readonly before?: unknown;
  readonly after?: unknown;
}

/** Key names that must never appear in an audit diff (checked case-insensitively). */
const FORBIDDEN_AUDIT_KEYS = new Set([
  "password",
  "passwordhash",
  "secretencrypted",
  "token",
  "tokenhash",
  "recoverycodeshash",
]);

/**
 * The `before`/`after` fields are `unknown` for flexibility, so this runtime guard
 * is what actually enforces "never secrets": it walks the diff and rejects any
 * object key that would carry a credential, hash or token.
 */
function assertAuditDiffHasNoSecrets(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAuditDiffHasNoSecrets(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUDIT_KEYS.has(key.toLowerCase())) {
      throw new Error(`audit ${path} must not contain "${key}"`);
    }
    assertAuditDiffHasNoSecrets(entry, `${path}.${key}`);
  }
}

/**
 * Appends one auth audit fact through the store (the table is append-only). The
 * helper keeps the optional fields off the object when absent, so it satisfies
 * `exactOptionalPropertyTypes` and never writes an explicit `undefined`.
 */
export async function audit(store: AuthStore, input: AuthAuditInput): Promise<void> {
  if (input.before !== undefined) {
    assertAuditDiffHasNoSecrets(input.before, "before");
  }
  if (input.after !== undefined) {
    assertAuditDiffHasNoSecrets(input.after, "after");
  }
  await store.writeAudit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType ?? "app_user",
    entityId: input.entityId,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.request?.requestId !== undefined ? { requestId: input.request.requestId } : {}),
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
  });
}
