import { COMPETITOR_AUDIT_ACTIONS } from "./actions";
import type { CompetitorRecord, CompetitorStore } from "./types";
import { optionalText, requiredText } from "./validation";

export interface RegisterCompetitorInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly name: string;
  readonly notes?: string | null;
}

/**
 * Registers one competitor (`DEC-126`), **idempotent on `(organization, name)`**:
 * a name already in the register is returned as-is, with no second row and no
 * audit fact (the payroll `generated` no-op precedent). The name is trimmed and
 * must be non-blank; `notes` is trimmed and a blank becomes `null`.
 *
 * Registration is a register write, not a fact, so the row and its
 * `competitors.competitor.registered` audit fact are written inside one
 * transaction and commit or roll back together. A concurrent double-registration
 * races on the `(organization_id, name)` unique; the loser re-reads by name on a
 * fresh transaction and returns the winner (see below).
 */
export async function registerCompetitor(
  store: CompetitorStore,
  input: RegisterCompetitorInput,
): Promise<CompetitorRecord> {
  const name = requiredText(input.name, "name");
  const notes = optionalText(input.notes);

  let createAttempted = false;
  try {
    return await store.withTransaction(async (tx) => {
      const existing = await tx.findCompetitorByName({
        organizationId: input.organizationId,
        name,
      });
      if (existing !== undefined) {
        return existing;
      }

      createAttempted = true;
      const created = await tx.createCompetitor({
        organizationId: input.organizationId,
        name,
        notes,
      });

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: COMPETITOR_AUDIT_ACTIONS.competitorRegistered,
        entityType: "competitor",
        entityId: created.id,
        after: { name: created.name },
      });

      return created;
    });
  } catch (error) {
    // The recovery must run on a fresh transaction: on Postgres the unique
    // violation aborted the failed one, so an in-transaction re-read would throw.
    if (!createAttempted) {
      throw error;
    }
    const raced = await store.findCompetitorByName({
      organizationId: input.organizationId,
      name,
    });
    if (raced === undefined) {
      throw error;
    }
    return raced;
  }
}
