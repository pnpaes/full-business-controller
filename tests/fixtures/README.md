# Golden fixture files

Machine-readable form of the six Phase 1 golden calculation fixtures described in
`docs/phase0/GOLDEN_FIXTURES.md` (see `DEC-065`). They are JSON rather than YAML so no YAML
dependency is added; `packages/domain/src/golden-fixtures.test.ts` loads and reconciles them.

## `status` vocabulary

- `unsigned` — not yet signed. `expected` is **empty** on purpose, so a calculated number can never be
  mistaken for a signed one. Inputs are present but `null`/empty until signing fills them.
- `illustrative` — synthetic worked example carrying `expected` values (the two examples in
  `GOLDEN_FIXTURES.md`). **Not approved figures**; never a release gate.
- `signed` — approved by finance + the product owner. `signed_by` is non-empty and `signed_at` is an
  ISO date; only signed fixtures may be treated as "verified".

A signed fixture is versioned. Changing any input or expected value requires a **new `version`** and a
fresh sign-off; re-signing flips `status` back to `signed` and replaces `signed_by`/`signed_at`. An
`unsigned` or `illustrative` fixture must not claim signatories (`signed_by: []`, `signed_at: null`).

## Shape

Top-level keys per fixture: `id`, `version`, `status`, `signed_by`, `signed_at`, `source_refs`,
`tax_basis`, `currency`, `supplier_packs`, `recipe`, `labor`, `packaging`, `channel`, `expected`,
`rounding`. The sections mirror `GOLDEN_FIXTURES.md` §1 plus two machine-readable additions:

- `supplier_packs[].base_unit` — the item's base unit the pack converts to (`g`, `ml`, `pc`), needed to
  build the `SupplierPack` the landed-cost primitive consumes.
- `channel[].packaging_cost` — a channel can carry its own packaging (e.g. coffee takeaway vs dine-in);
  when present the channel did not use the top-level `packaging` list.

Rate convention: `tax_rate_pct` and `commission_pct` are **fractions** carried at 6 dp, per
`CALCULATION_CONTRACT.md`/`DEC-024` (15 % is `"0.150000"`, a 30 % channel fee is `"0.300000"`), which is
what the domain primitives (`netFromGross`, `channelVariableCost`) accept. Money is a decimal string at
4 dp; quantities at 6 dp; `rounding.method` is always `HALF_UP` with `scales.qty/money/presented` =
6/4/2.

## Reconciliation

`packages/domain/src/golden-fixtures.test.ts` checks every fixture's keys, version and status, the
sign-off invariant and the empty `expected` of `unsigned` fixtures, then reconciles the two
`illustrative` fixtures' `expected` values through the real `@aquarela/domain` primitives
(`computeLandedCost`, `lineCost`, `computeRecipeCost`, `netFromGross`, `directLaborCost`,
`unitVariableCost`, `unitContribution`, `contributionMarginPct`, `computeCostCardTotals`). Supplier
pack prices and ingredient costs that a signed fixture would resolve through the application-layer
cost-source precedence (`DEC-047`) are treated as fixture inputs here; see the `ponytail:` note in the
test.
