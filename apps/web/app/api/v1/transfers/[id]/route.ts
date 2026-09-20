import { createPostgresTransferStore, getStockTransfer } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { loadTransferRefs } from "../refs";
import { toTransferDetailResponse } from "../transfer-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One transfer with its paired movements and derived per-line facts (`DEC-029`).
 * Signed out → 401; a non-UUID id → 400; an unknown id or one owned by another
 * organization → 404 (never another tenant's data).
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);
    const detail = await getStockTransfer(store, { organizationId, transferId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const refs = await loadTransferRefs(store, {
      locationIds: [detail.transfer.fromLocationId, detail.transfer.toLocationId],
      storageAreaIds: [detail.transfer.fromStorageAreaId, detail.transfer.toStorageAreaId],
      itemIds: detail.lines.map((line) => line.itemId),
    });

    return jsonOk({ ...toTransferDetailResponse(organizationId, detail, refs) });
  });
}
