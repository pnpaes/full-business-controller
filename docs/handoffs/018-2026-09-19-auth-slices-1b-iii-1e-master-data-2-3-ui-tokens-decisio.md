# 2026-09-19 — Auth slices 1b-iii→1e, master data (2–3), UI tokens, decision briefs, drizzle upgrade

Committed a run of slices on `main`, in order: `2ce8847` password reset + access
control (slice 1b-iii); `5776914` reset neutrality (no token in the result, a
`deliverResetToken` port, org-scoped redemption); `87f9ced` unit + supplier-pack
value objects (slice 2); `4ccfb23` slice 2 review fix (strict package-to-base);
`aa2eff5` design tokens package; `60ac52e` auth hardening (fail-closed MFA
config, 32-byte key validation, `isAuthorizedFor` throws on an empty
requirement, audit before/after the secret guard); `a83a312` token-driven UI
primitives; `dad2ff0` UI layout reference note; `c8e86e0` DEC-049 assessment;
`21e9c72` deployment cost estimate; `018930d` multi-tenancy posture; `3505aa8`
jobs-runtime comparison (recommends pg-boss); `bfc5f74` runbook pre-apply
inputs; `74ac467` UI primitive accessibility/form-wiring fixes; `5c42c1d` auth
HTTP surface (slice 1c: routes, cookies, CSRF/same-origin, per-IP limiter,
login/2FA/reset pages); `a869227` master-data schema + conversion graph (slice
3: `unit_conversion`, `supplier`, `supplier_item`, `cost_center` + migration
0004); `07af21d` TOTP enrolment + recovery codes (slice 1d); `b8897bf`
`unit_conversion` overlap invariants (migration 0005) + conversion-graph
hardening (reject self-edges, rescale per hop, 32-hop cap, round-to-zero
rejection) + `DEC-050`/`DEC-051`; `e51a957` first-owner bootstrap + MFA
enrolment surface (slice 1e); `cc86f13` drizzle-orm 0.45.2 / drizzle-kit 0.31.10
upgrade, closing DEC-049 (`npm audit --omit=dev` = 0); `0cce93b` MFA disable now
atomic (revocation inside disable's transaction) + bootstrap `--dry-run` +
runbook proxy/dry-run notes.

Verified per slice: with `DATABASE_URL` the suite grew from 318 tests before the
drizzle upgrade to 321 after; without it 265 passed / 53 skipped;
lint/typecheck/build/format:check green at each commit. Review findings
accepted: the conversion-graph invariants and hardening, the atomic MFA
disable, the neutral password reset, and token-family separation. Declined with
reasons: none new this session — the earlier declines stand as recorded (the
drizzle advisory was governed by DEC-049, now closed by the upgrade; the
domain-layer logging policy; the provisional lockout escalation). Slice 4 was
started by a parallel session and is left uncommitted in the working tree; its
resume entry is at the top of this file.

Rollback: each item above is its own commit — `git revert <sha>` per slice. The
drizzle upgrade changed lockfile and migration metadata only; migrations
0000–0005 are additive with tested down paths.
