import { createPostgresMasterDataStore, registerSupplierItem } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { parseRegisterSupplierItemBody } from "../../../item-body";
import { productLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Registers one supplier pack for the item (`PROC-001`). The pack unit arrives
 * as its organization-unique code and is resolved here; `registerSupplierItem`
 * enforces the pack factor, the duplicate supplier SKU and the item/supplier
 * existence, and the route maps a command rejection to 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productLimiters.registerSupplierItem, async () => {
    await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }
    const body = await readJsonObject(request);
    const parsed = parseRegisterSupplierItemBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);
    const packUnit = await store.findUnitByCode(organizationId, parsed.input.packUnitCode);
    if (packUnit === undefined) {
      return jsonError(400, `pack unit "${parsed.input.packUnitCode}" not found`);
    }

    let created: { supplierItemId: string };
    try {
      created = await registerSupplierItem(store, {
        organizationId,
        supplierId: parsed.input.supplierId,
        itemId: id,
        supplierSku: parsed.input.supplierSku,
        packUnitId: packUnit.id,
        packToBaseUnitFactor: parsed.input.packToBaseUnitFactor,
        ...(parsed.input.minOrderQty === undefined
          ? {}
          : { minOrderQty: parsed.input.minOrderQty }),
        ...(parsed.input.leadTimeDays === undefined
          ? {}
          : { leadTimeDays: parsed.input.leadTimeDays }),
        ...(parsed.input.preferred === undefined ? {} : { preferred: parsed.input.preferred }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ supplierItemId: created.supplierItemId });
  });
}
