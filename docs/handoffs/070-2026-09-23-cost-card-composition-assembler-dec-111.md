# 2026-09-23 — Cost-card composition assembler delivered (`DEC-111`)

`main`; HEAD before the slice was **`837e9a5`** (the `RPT-004` handoff). The
slice lands as **`182342b`** `feat(application)`, **`0ee79f7`** `feat(web)`, the
`docs(decisions)` commit (`DEC-111`) and this `docs(context)` handoff. Nothing
pushed; nothing applied to DigitalOcean. Verification at the committed tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3482/3482 tests with
`DATABASE_URL` (228 files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op
through `0059`; **89 tables**.

- **Delivered (`DEC-111`).** `calculateCostCard` was a complete write command
  with **no production caller** — nothing assembled its
  `CostCardCompositionInput`, so the contract's `unit_variable_cost`/
  `unit_full_cost` were not computable and the reporting slices showed only
  "contribution before labour/fees" (`DEC-108`). The assembler closes that:
  - **Recipe version** — the effective `product_recipe_assignment` for
    `(variant, location)` at `asOf` (half-open); a supplied `recipeVersionId`
    must agree, or **stands in** when no assignment exists; both missing is
    rejected. New `findVariantRecipeAssignment` read (port/adapter/fake).
  - **Ingredient/packaging/sub-recipe** — assembled via `computeRecipeCost`,
    divided by the version's `approvedUsableOutput` (B3, 4 dp); a sub-recipe's
    internal packaging lands in the ingredient bucket (no recursive breakdown).
  - **`unitNetSales`** — the effective `price_version.netPrice` for the exact
    scope at `asOf`; missing or negative rejected.
  - **Direct labour, channel variable cost, other variable cost and allocated
    overhead** are **explicit validated command inputs** (decimal strings,
    default `0.0000`, provenance recorded) — the four resolvers do not exist
    (no role/cost-centre mapping, no `channel_fee_rule` reader, `fee_basis`
    `[PROPOSED]`, no `other_variable_cost` source, `operating_cost`→`cost_pool`
    unmodelled, `denominator_source` free text).
  - **Write path** — `POST /api/v1/costing/cost-cards` assembles then calls
    `calculateCostCard`, returning the cost-card detail view; guard order
    session → role → parse; a money field present as a non-string is a 400 (not
    a silent `0.0000`). New costing access (`owner`/`general_manager`/
    `kitchen`(provisional)/`admin`; read roles added to the existing GET).
- **Reviews:** three reviewers; **no blockers**. Accepted fixes: the explicit-id
  stand-in, the malformed-money 400s, the guard order, negative `unitNetSales`,
  per-field `roundingBoundary` (echoed in provenance), the provisional-`kitchen`
  comment, the dead export, `fxRateId` uuid validation, fail-closed
  `componentKind`, the GET read-role check, and the added tests. **Declined:** a
  price-version scope fallback (exact-scope-only is a recorded `DEC-077` open
  point) and converging the two `readJsonObject` helpers (repo-wide cleanup).
  Recorded: no `channel_fee_rule`/`operating_cost`→pool/per-product labour
  resolver; the `cost_card` version chain and per-item cost-selection override
  remain open; golden fixtures still unsigned.
- **Reversibility:** each layer is an independently revertible commit
  (`git revert <sha>`). **No migration and no data written**; schema stays
  **89 tables / `0059`**.
- **Next:** the four component resolvers (direct labour per recipe/cost-centre,
  a `channel_fee_rule` reader under a decision, an `operating_cost`→`cost_pool`
  amount + driver-denominator resolver), which would make the reports show real
  contribution/full cost; the row-11 import mapping writer; the deferred close
  follow-ups (correction-posting wiring `DEC-028`/`DEC-073`, `daily_close`); the
  receipt→ledger wiring (OPS `storage_area_id` policy); the test-deployment
  rehearsal and golden-fixture sign-off.
