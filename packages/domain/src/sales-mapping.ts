import { DomainError } from "./errors";

/**
 * External-entity resolution for the import framework (slice 11), the pure part
 * of `SALE-002` (map external products/locations/channels/taxes) and `SALE-008`.
 *
 * Matching order is fixed by `DEC-041`: the platform owns stable SKUs and is the
 * reconciliation key, so an import row is matched on **SKU first** and only
 * falls back to the external mapping's `external_id` **when no SKU is
 * present**. A row that carries a SKU the platform does not know is therefore
 * `unmapped`, not silently remapped by external id or name.
 *
 * Conflict handling is `DEC-033`: one external id pointing at two internal
 * entities, or two external ids pointing at one internal entity, is a
 * **conflict** — the row is flagged and blocked for review, never remapped in
 * place. The name fallback mentioned in `DEC-041` (`… and then name`) is not
 * implemented here: no candidate carries a name in the import schema, so the
 * resolver stops at the SKU/external-id tiers (recorded open point).
 *
 * Pure and IO-free: the application layer reads the candidates and acts on the
 * result.
 */

/**
 * One piece of evidence linking an external row to an internal entity. The
 * application assembles these from `external_mapping` rows plus any internal
 * entity resolved by SKU; the resolver never reads a store.
 */
export interface ExternalMappingCandidate {
  /** The internal record (item or product variant id) this evidence points at. */
  readonly internalEntityId: string;
  /** The platform-owned SKU of that internal entity (`DEC-041`), when known. */
  readonly sku?: string | null;
  /** The external system's own identifier (`external_mapping.external_id`). */
  readonly externalId?: string | null;
}

export interface ResolveExternalEntityInput {
  /** The SKU on the import row; preferred match key (`DEC-041`). */
  readonly sku?: string | null;
  /** The external id on the import row; used only when no SKU is present. */
  readonly externalId?: string | null;
  readonly candidates: readonly ExternalMappingCandidate[];
}

export type ResolveExternalEntityResult =
  | {
      readonly status: "matched";
      readonly internalEntityId: string;
      /** Which tier produced the match, for diagnostics and audit. */
      readonly match: "sku" | "external_id";
    }
  | {
      readonly status: "unmapped";
      readonly reason: "no_key" | "sku_not_found" | "external_id_not_found";
    }
  | {
      /** `DEC-033`: flag and block; the caller must not remap silently. */
      readonly status: "conflict";
      readonly kind:
        "ambiguous_sku" | "external_id_to_many_internals" | "internal_to_many_externals";
      readonly sku: string | null;
      readonly externalId: string | null;
      readonly internalEntityIds: readonly string[];
      readonly externalIds: readonly string[];
    };

/** Blank/whitespace text is "absent"; comparison is exact (trimmed) — no case folding. */
function normalizeKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function distinctStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Resolves one import row to an internal entity, or reports why it cannot.
 *
 * - SKU present → match by SKU; no candidates ⇒ `unmapped` (`sku_not_found`)
 *   and no fallback, per `DEC-041`. Several internal ids for one SKU ⇒
 *   `conflict` (`ambiguous_sku`).
 * - No SKU, external id present → match by external id; no candidates ⇒
 *   `unmapped` (`external_id_not_found`); several internal ids ⇒ `conflict`
 *   (`external_id_to_many_internals`); one internal id that also carries a
 *   *different* external id ⇒ `conflict` (`internal_to_many_externals`) — both
 *   directions are `DEC-033`.
 * - Neither key ⇒ `unmapped` (`no_key`).
 */
export function resolveExternalEntity(
  input: ResolveExternalEntityInput,
): ResolveExternalEntityResult {
  const sku = normalizeKey(input.sku);
  const externalId = normalizeKey(input.externalId);

  if (sku !== null) {
    const internalEntityIds = distinctStrings(
      input.candidates
        .filter((candidate) => normalizeKey(candidate.sku) === sku)
        .map((candidate) => candidate.internalEntityId),
    );
    if (internalEntityIds.length === 0) {
      return { status: "unmapped", reason: "sku_not_found" };
    }
    if (internalEntityIds.length > 1) {
      return {
        status: "conflict",
        kind: "ambiguous_sku",
        sku,
        externalId,
        internalEntityIds,
        externalIds: [],
      };
    }
    return { status: "matched", internalEntityId: internalEntityIds[0]!, match: "sku" };
  }

  if (externalId !== null) {
    const matches = input.candidates.filter(
      (candidate) => normalizeKey(candidate.externalId) === externalId,
    );
    const internalEntityIds = distinctStrings(matches.map((m) => m.internalEntityId));
    if (internalEntityIds.length === 0) {
      return { status: "unmapped", reason: "external_id_not_found" };
    }
    if (internalEntityIds.length > 1) {
      return {
        status: "conflict",
        kind: "external_id_to_many_internals",
        sku,
        externalId,
        internalEntityIds,
        externalIds: distinctStrings(
          matches.map((m) => normalizeKey(m.externalId)).filter((id): id is string => id !== null),
        ),
      };
    }
    const internalEntityId = internalEntityIds[0]!;
    const otherExternalIds = distinctStrings(
      input.candidates
        .filter((candidate) => candidate.internalEntityId === internalEntityId)
        .map((candidate) => normalizeKey(candidate.externalId))
        .filter((id): id is string => id !== null && id !== externalId),
    );
    if (otherExternalIds.length > 0) {
      return {
        status: "conflict",
        kind: "internal_to_many_externals",
        sku,
        externalId,
        internalEntityIds,
        externalIds: otherExternalIds,
      };
    }
    return { status: "matched", internalEntityId, match: "external_id" };
  }

  return { status: "unmapped", reason: "no_key" };
}

/**
 * Import-run statuses. The authority is `schemas/domain-enums.yaml`
 * (`import_status`); `@aquarela/persistence` mirrors it. The domain package has
 * no persistence dependency, so the vocabulary is restated here and must be
 * kept in sync.
 */
export const IMPORT_RUN_STATUSES = [
  "uploaded",
  "parsed",
  "needs_review",
  "validated",
  "posted",
  "partially_posted",
  "failed",
  "superseded",
] as const;

export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

/**
 * Legal transitions, from `05_WORKFLOWS.md` §5.9
 * (`UPLOADED -> PARSED -> NEEDS_REVIEW|VALIDATED -> POSTED`), plus the
 * documented retry path ("failures can be retried safely") and the
 * `superseded`/`needs_review` round-trips a review or re-map implies.
 *
 * `posted`/`partially_posted` are the documented terminal workflow states, but
 * **slice 11 never posts** — the run stops at `validated`/`needs_review`.
 * Posting is slice 12 (`SALE-003`/`SALE-005`, owner-gated on `ADR-0008`); the
 * map merely does not block it.
 *
 * `needs_review -> validated` is the end of a review (dispositions recorded);
 * `validated -> needs_review` is mapping finding an unmapped/conflicting row
 * *after* validation (workflow step 5 follows step 4).
 */
export const IMPORT_RUN_STATUS_TRANSITIONS: Readonly<
  Record<ImportRunStatus, readonly ImportRunStatus[]>
> = {
  uploaded: ["parsed", "failed", "superseded"],
  parsed: ["needs_review", "validated", "failed", "superseded"],
  needs_review: ["validated", "failed", "superseded"],
  validated: ["needs_review", "posted", "partially_posted", "failed", "superseded"],
  failed: ["parsed", "superseded"],
  posted: [],
  partially_posted: [],
  superseded: [],
};

/** True when `from -> to` is a legal import-run transition (unknown statuses are illegal). */
export function canTransitionImportRunStatus(from: string, to: string): boolean {
  const allowed = IMPORT_RUN_STATUS_TRANSITIONS[from as ImportRunStatus];
  return allowed !== undefined && allowed.includes(to as ImportRunStatus);
}

/** Throws `DomainError` on an illegal transition, so no command can skip a state. */
export function assertImportRunStatusTransition(from: string, to: string): void {
  if (!canTransitionImportRunStatus(from, to)) {
    throw new DomainError(`illegal import_run status transition: ${from} -> ${to}`);
  }
}
