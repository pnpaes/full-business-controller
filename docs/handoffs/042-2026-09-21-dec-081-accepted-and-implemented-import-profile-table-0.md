# 2026-09-21 — DEC-081 accepted and implemented (import_profile table 0031 + org-coherence guard 0032); handoff updated

`main` HEAD `cb3aff5`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean); the tree was
clean at `cb3aff5` before this docs edit. **5 commits** this slice:
`2997587` docs(decisions) accept `DEC-081`; `f4a8110` feat(persistence)
`import_profile` table (migration `0031`) + org-coherence guard (`0032`);
`e9ec176` feat(imports) resolve a run's import profile by source; `1914795`
feat(web) profile-aware import creation and seed; `cb3aff5` docs(runbook)
document migrations `0031`/`0032`.

- **Delivered (`DEC-081`):** `import_profile` keyed
  `(organization_id, source)` (unique) carrying `profile_version`,
  `posting_policy` (default `allow_partial`, checked against
  `import_posting_policy`) and `validation_rules` jsonb (checked to be a jsonb
  object), plus a nullable `import_run.import_profile_id` FK (legacy runs keep
  null, no backfill). `createImportRun` resolves the source's profile inside
  the transaction (the profile supplies the version and policy; a conflicting
  caller-supplied policy/version is rejected; a source with no profile keeps
  `DEC-025` behaviour). `validateImportRun` resolves the run's profile rules
  through a fail-closed `parseImportValidationRules` and merges explicit caller
  rules over them field-by-field. `ImportStore` gained `findImportProfile`/
  `createImportProfile` (Postgres adapter + fakes); values are trimmed
  consistently. Migration `0031` (generated, additive) with a rehearsed
  unjournaled down; migration `0032` (hand-written) adds the
  `import_run_profile_org_guard` `BEFORE INSERT OR UPDATE` trigger enforcing
  `import_run.organization_id` coherence with the profile (the `DEC-079`
  precedent), with its own rehearsed unjournaled down. Web: the create-run
  body's `profileVersion` is optional; the seed ensures the `zettle-legacy`
  profile idempotently; the run detail page and new-run form describe the
  profile-resolved version/policy.
- **Reviews and reconciliation.** Three independent passes.
  `reviewer-qwen` — no blocker/major; **four minors accepted and applied**
  (consistent trimming between profile creation and run resolution;
  `parseImportValidationRules` trims list entries and rejects blanks; the
  `postingPolicy` conflict check trims; the missing-profile error names the
  profile id and organization). `reviewer-minimax` — no blocker; **one major
  accepted and applied** (the new run→profile FK needed the same
  cross-organization coherence guard `DEC-079` uses, hence migration `0032`);
  two minors **accepted** (the stale `IMPORT_POSTING_POLICY` persistence
  docstring fix; a `ponytail:` note for the deliberately absent reverse index)
  and two **declined** (adding the reverse-FK index now — no read path yet;
  re-framing the struck-through `sales.ts` open point — the `DEC-078`
  traceability convention). `reviewer-glm` final pass — no blocker/major; two
  minors **declined** (the untrimmed `fileHash` replay guard is pre-existing at
  the baseline; a caller-supplied `expectedCurrency: ""` is boundary-level and
  normalised by the HTTP layer).
- **Verification at `cb3aff5` (exact):** `typecheck`, `lint`, `build`,
  `format:check` clean; **1353/1353 tests with `DATABASE_URL`** (135 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0032` is a no-op on
  re-run; both new down paths rehearsed; **66 tables**; every new read/write
  organization-scoped (`DEC-061`).
- **Resume task:** enforce the import profile's posting policy in
  `postImportRun` (`DEC-025`) — the policy is stored but never read, so
  `all_or_nothing` behaves exactly like `allow_partial`; TECH-owned — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, MFA disabled for `owner`, demo-seeded including the
  `zettle-legacy` `import_profile`); a fresh session must restart it
  (session-scoped).

Rollback: each of the five commits is independently `git revert`-able (revert
the web/application commits before persistence if reverting a cohort);
migrations `0031`/`0032` are additive with rehearsed **unjournaled** down paths
(`0031` down drops `import_run.import_profile_id` first then `import_profile`;
`0032` down drops the trigger and function); no data migration; nothing pushed;
nothing applied to DigitalOcean.
