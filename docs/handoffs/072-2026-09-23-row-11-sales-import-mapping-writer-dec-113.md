# 2026-09-23 — Row-11 sales-import mapping writer delivered (`DEC-113`)

`main`; HEAD before the slice was **`8bf8c71`** (the `feat(web)` commit of the
`DEC-112` resolver slice). The slice lands as **`fd277ff`** `docs(decisions)`,
**`c0fc7de`** `feat(persistence)`, **`7d96270`** `feat(application)` and
**`cba124a`** `feat(web)`, plus this `docs(context)` handoff. Nothing pushed;
nothing applied to DigitalOcean. Verification at the committed tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3562/3562 tests with
`DATABASE_URL` (233 files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op
on re-run through `0062`; **89 tables** (no new table, **no migration**). The
baseline before the slice was 3547/3547; the slice added 14 tests and the
follow-up review fix adds one more (3562). Next free decision id `DEC-114`.

- **Delivered (`DEC-113`).** The row-11 importer commits `sales_line` rows but
  never wrote `sales_line.product_variant_id`, so the 13c/13d variant chain
  (`product_variant_id → sku → external_mapping → unmapped`) resolved products
  by SKU only. The mapping stage now resolves each sales-import row to a
  `product_variant` and writes the resolved id into the staging row's
  `normalized.product_variant_id` — the key `postImportRun` already reads —
  alongside `mapped_internal_entity_id`/`mapping_match`, so
  `sales_line.product_variant_id` is populated at posting. `DEC-025`'s partial
  posting and `DEC-033`'s conflict blocking are unchanged. Resolution precedence
  is `DEC-041` SKU-first: an exact `product_variant.sku` match within the
  organization wins; otherwise the effective `external_mapping` rows with
  `internal_entity_type = 'product_variant'` for the transaction's
  `source_system`, matched on `sku` or `external_id`, within the half-open
  `[effective_from, effective_to)` window at the row's `occurred_at` (the
  reporting chain's convention). A row resolving to no variant keeps
  `product_variant_id` null and stays in the `unmapped` bucket (never dropped).
  Conflicts flow through the existing `resolveExternalEntity` machinery and stay
  `mapping_state = conflict` / `error_code = mapping_conflict`; an ambiguous
  SKU is impossible for variants (unique `(organization_id, sku)`).
  - **Persistence** (`c0fc7de`) — `packages/persistence/src/repositories/
    master-data.ts`: a new `findVariantBySku` read (exact org-scoped
    `product_variant.sku` match; other entity types still resolve to
    `undefined`) and an `internalEntityType` filter on `listExternalMappings`.
  - **Application** (`7d96270`) — `packages/application/src/imports/
    map-import-rows.ts`: `mapImportRows` gains an optional `internalEntityType`
    (the caller passes `product_variant` for a sales import; the item path is
    unchanged — `import_profile` carries no entity-type field, so there is no
    automatic inference) and writes `normalized.product_variant_id`. The
    unmapped/conflict branches strip `product_variant_id`/
    `mapped_internal_entity_id`/`mapping_match`, so a withdrawn mapping leaves
    no stale target on a re-map. Types (`types.ts`), the Postgres store
    (`postgres-store.ts`) and `test-support.ts` carry the new input/filter;
    `packages/application/src/sales/sales.test.ts` covers the poster reading the
    populated key.
  - **Web** (`cba124a`) — `apps/web/app/api/v1/imports/{import-rows.ts,
    runs/[id]/map/route.ts}` accept `internalEntityType` and
    `apps/web/app/(app)/sales/import/[runId]/run-actions.tsx` exposes an
    optional **Internal entity type** field on the map form (default blank, so
    the item path is unchanged; the operator sets `product_variant` for a sales
    import).
  - **Decision** (`fd277ff`) — `DEC-113` recorded in `12_OPEN_DECISIONS.md`
    (both tables), provisional pending owner/OPS confirmation.
  - **No migration was needed** (schema stays through `0062`, 89 tables).
    **Historical `sales_line` backfill is not done** — the recorded `DEC-113`
    posture: no backfill; the backfill posture, the demo variant seed and an
    `external_mapping` lookup index are deferred.
- **Review:** two reviewers (`reviewer-qwen` adversarial logic,
  `reviewer-glm` code-level). **No blockers.** **Accepted fixes:** the UI
  wiring gap (the map form never sent `internalEntityType`); the
  stale-mapping-keys-on-remap defect (the unmapped/conflict branches now strip
  `product_variant_id`/`mapped_internal_entity_id`/`mapping_match`); a
  comment/guard mismatch; and a Postgres in/out-of-window external-mapping test.
  **Declined (with reasons):** fail-open on an absent/unparseable `occurred_at`
  (documented; validation flags it); the `isEffectiveAt` NaN asymmetry (latent —
  the Postgres adapter always emits ISO strings); the fake's ordering divergence
  from the adapter (the mapper is order-independent).
- **Follow-up review fix (mapped branch).** A later review found the same
  stale-key hole on the **mapped** branch that the earlier fix had closed only on
  the unmapped/conflict branches. A row first mapped with
  `internalEntityType: product_variant` (writing `normalized.product_variant_id`)
  and then re-mapped on the item path kept the stale variant id: the matched
  branch re-added `mapped_internal_entity_id`/`mapping_match` on top of the old
  `normalized` without stripping what a previous match had written, so a remap
  that changes the resolution path (variant → item) left `postImportRun` reading
  the stale `product_variant_id` into `sales_line.product_variant_id`. The
  matched branch now builds `normalized` from `withoutMappingKeys(row.normalized)`
  before re-adding the fresh keys — behaviour-identical for pure-item history
  (the item path never wrote those keys) and it does not mutate `row.normalized`.
  Covered by a new unit test that maps a row to a variant, withdraws the variant
  mapping and re-maps the same SKU to an item, asserting the row is `mapped` on
  the item id and `product_variant_id` is absent.
- **Reversibility:** each of the four commits is independently revertible with
  `git revert <sha>`. **No migration and no schema change** — the write is an
  additive jsonb key on rows the writer already owns; reverting the code leaves
  existing rows untouched (a reverted writer simply stops populating the key
  and the poster reads `null`, so the line stays unposted — no data loss). The
  `feat(web)` layer reverts independently. Nothing pushed; nothing applied to
  DigitalOcean.
- **Next:** the deferred `DEC-112` volume-based allocation denominators
  (`revenue`, `transactions`, `sales_units`, `production_*`) — slice `DEC-114`,
  failing closed when the period-scoped read cannot supply the denominator;
  then the remaining `DEC-112` close-outs (`denominator_source` DB CHECK,
  per-channel packaging, the cost-card version chain, the per-item override,
  recurrence→period normalisation), the row-11 backfill posture once decided,
  and the deferred close follow-ups (`DEC-028`/`DEC-073` correction wiring,
  `daily_close`).
