import type { AuthStore, RequestContext } from "./types";

export interface AuthAuditInput {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityId: string | null;
  readonly entityType?: string;
  readonly reason?: string;
  readonly request?: RequestContext;
}

/**
 * Appends one auth audit fact through the store (the table is append-only). The
 * helper keeps the optional fields off the object when absent, so it satisfies
 * `exactOptionalPropertyTypes` and never writes an explicit `undefined`.
 */
export async function audit(store: AuthStore, input: AuthAuditInput): Promise<void> {
  await store.writeAudit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType ?? "app_user",
    entityId: input.entityId,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.request?.requestId !== undefined ? { requestId: input.request.requestId } : {}),
  });
}
