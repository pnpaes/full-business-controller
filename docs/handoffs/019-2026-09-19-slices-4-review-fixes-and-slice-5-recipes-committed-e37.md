# 2026-09-19 — Slices 4 review fixes and slice 5 recipes committed (`e3706c0`, `841da96`); DEC-052; handoff updated

Two atomic commits on `main` since the last handoff update (which recorded HEAD
`52aaad8`/the slice 4 status; the tree is clean at HEAD `841da96`):

- **`e3706c0` — slice 4 review fixes.** `computeLandedCost` now throws on a negative
  net pack price; an exact-HALF_UP test was added (`0.2469 / 2 = 0.12345 → 0.1235`);
  the receipt audit payload carries `gross_total`; a same-timestamp price test covers
  the half-open window case; migration `0007` (hand-written, the
  `goods_receipt_line_accept_qty_guard` BEFORE INSERT/UPDATE trigger guarding a
  zero-accepted line on an accepted receipt, since a PostgreSQL `CHECK` cannot read
  the parent row); migration `0008` relaxes
  `supplier_price_effective_range_check` from `>` to `>=` so half-open empty windows
  are allowed. Recorded as **`DEC-052`** (accepted in `12_OPEN_DECISIONS.md`).
- **`841da96` — slice 5 recipes / sub-recipes / version / yield / allergens.** The
  recipe tables already existed from the slice-0 core (`recipe`, `recipe_version`,
  `recipe_line`, `recipe_version_no_overlap` in `0002`), so migration `0009` adds
  only `allergen` and `recipe_allergen` plus the `ALLERGEN_SOURCE` vocabulary.
  Domain adds the `CALCULATION_CONTRACT.md` §6 maths (`usableYieldRate`,
  `requiredPurchaseQuantity`, `lineCost`, `computeRecipeCost`) with HALF_UP at
  B0/B2/B3, recipe-version state/effective-dating helpers, and a sub-recipe cycle
  check. Application adds `registerRecipe`, `registerAllergen`,
  `registerRecipeVersion`, `loadRecipeVersionAsOf` and `computeRecipeCost` with the
  `DEC-047` cost-source precedence; persistence adds the recipe/allergen
  repositories.

Verified: **396 tests** with `DATABASE_URL`, **327 passed / 69 skipped** without it;
lint/typecheck/build/format/db:generate clean; the migration rehearsal applied
`0000–0009` (43 tables), with a no-op re-run rehearsed and the down path rehearsed.

Adversarial reviews: the two slice-5 reviews (`reviewer-qwen` on the §6 maths and
cost-source precedence, `reviewer-minimax` on the migration/schema) were **in flight
when `841da96` was committed** — if any finding is still unreconciled, reconcile it
first at the start of the next session (see "Resume here"). **`DEC-052`** was the only
new decision; slice 5 left **eight deliberate ambiguities** for the owner, now tracked
under "Open decisions / inputs" and in `docs/BUILD_ROADMAP.md` §5.

Rollback: both commits are independently revertible (`git revert e3706c0` would
remove the slice 4 fixes and migrations 0007/0008 together with the code; `git
revert 841da96` the slice 5 code; migrations are additive with rehearsed down
paths — see "Reversibility").
