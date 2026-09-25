import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { TaxRuleRecord } from "./read-types";
import type { TaxScopeRef, TaxWriteStore } from "./write-types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction, so this narrows the union for the reads (`tax_rule` has no
 * repository accessors).
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

type TaxRuleRow = typeof repo.taxRule.$inferSelect;

function toTaxRule(row: TaxRuleRow): TaxRuleRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    ratePct: row.ratePct,
    taxBasis: row.taxBasis,
    taxTreatment: row.taxTreatment,
    recoverable: row.recoverable,
    appliesTo: row.appliesTo,
    scopeType: row.scopeType,
    locationId: row.locationId,
    channelId: row.channelId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/**
 * Adapts the persistence tables to the `TaxWriteStore` port. `tax_rule` has no
 * repository functions, so the writes go through the exported table with
 * `insert().returning()`; ending a rule is an id-targeted upsert that sets only
 * `effective_to` (the persistence package is not extended by this slice).
 */
export function createPostgresTaxStore(db: Database): TaxWriteStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresTaxStore(db));
      }
      return db.transaction((tx) => fn(createPostgresTaxStore(tx)));
    },
    findTaxRuleByCode: async (organizationId, code) => {
      const row = await relational(db).query.taxRule.findFirst({
        where: (fields, { and, eq }) =>
          and(eq(fields.organizationId, organizationId), eq(fields.code, code)),
      });
      return row === undefined ? undefined : toTaxRule(row);
    },
    findTaxRuleById: async (taxRuleId) => {
      const row = await relational(db).query.taxRule.findFirst({
        where: (fields, { eq }) => eq(fields.id, taxRuleId),
      });
      return row === undefined ? undefined : toTaxRule(row);
    },
    listTaxRulesByApplicability: async (organizationId, appliesTo) => {
      const rows = await relational(db).query.taxRule.findMany({
        where: (fields, { and, eq }) =>
          and(eq(fields.organizationId, organizationId), eq(fields.appliesTo, appliesTo)),
        orderBy: (fields, { asc }) => [asc(fields.code), asc(fields.id)],
      });
      return rows.map(toTaxRule);
    },
    listTaxRulesWithWindows: async (organizationId) => {
      const rows = await relational(db).query.taxRule.findMany({
        where: (fields, { eq }) => eq(fields.organizationId, organizationId),
        orderBy: (fields, { asc }) => [asc(fields.code), asc(fields.id)],
      });
      return rows.map(toTaxRule);
    },
    findChannelScope: async (channelId): Promise<TaxScopeRef | undefined> => {
      const row = await relational(db).query.channel.findFirst({
        where: (fields, { eq }) => eq(fields.id, channelId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findLocationScope: async (locationId): Promise<TaxScopeRef | undefined> => {
      const row = await relational(db).query.location.findFirst({
        where: (fields, { eq }) => eq(fields.id, locationId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    createTaxRule: async (input) => {
      const rows = await relational(db)
        .insert(repo.taxRule)
        .values({
          organizationId: input.organizationId,
          code: input.code,
          name: input.name,
          ratePct: input.ratePct,
          taxTreatment: input.taxTreatment,
          taxBasis: input.taxBasis,
          recoverable: input.recoverable,
          appliesTo: input.appliesTo,
          scopeType: input.scopeType,
          locationId: input.locationId,
          channelId: input.channelId,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
        })
        .returning();
      return toTaxRule(rows[0]!);
    },
    endTaxRule: async (organizationId, taxRuleId, effectiveTo) => {
      const row = await relational(db).query.taxRule.findFirst({
        where: (fields, { and, eq }) =>
          and(eq(fields.id, taxRuleId), eq(fields.organizationId, organizationId)),
      });
      if (row === undefined) {
        return undefined;
      }
      const rows = await relational(db)
        .insert(repo.taxRule)
        .values({ ...row, effectiveTo })
        .onConflictDoUpdate({ target: repo.taxRule.id, set: { effectiveTo } })
        .returning();
      return toTaxRule(rows[0]!);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
