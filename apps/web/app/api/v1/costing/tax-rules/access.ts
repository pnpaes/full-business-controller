/**
 * Write-role set for the tax-rule authoring surface. Tax rates are
 * **configuration**, not operational data, so the honest matrix row is
 * `07_SECURITY_AND_NFR.md` §7.1 **"Users/configuration"**:
 *
 * ```
 * | Users/configuration | Owner grants | None | None | None | None | None | Technical | None |
 * ```
 *
 * i.e. **owner** (who grants configuration) and **admin** ("Technical", the role
 * that operates it) only. This mirrors the Administration users/scopes surface
 * (`ADMIN_USERS_ROLES = ["owner", "admin"]`), the closest existing read of the
 * same row; every other role is None there. `owner` is listed explicitly — there
 * is no implicit owner/admin bypass (`isAuthorizedFor`) and
 * `packages/application/src/auth/roles.test.ts` enforces the listing.
 *
 * **Provisional:** the matrix has no dedicated tax-rules row; this reading of
 * the configuration row awaits owner/OPS confirmation (the `DEC-111` posture).
 */
export const TAX_RULE_WRITE_ROLES = ["owner", "admin"] as const;
