import {
  MIN_BOOTSTRAP_PASSWORD_LENGTH,
  bootstrapFirstOwner,
  createPostgresBootstrapStore,
  planBootstrapFirstOwner,
} from "@aquarela/application";
import type {
  BootstrapFailure,
  BootstrapFirstOwnerInput,
  BootstrapPlan,
} from "@aquarela/application";
import { loadConfig } from "@aquarela/config";
import { createDb } from "@aquarela/persistence";

/**
 * One-off operator command that makes a fresh install usable: creates the
 * organization, the first `owner` user and the role grant, then prints the
 * created ids. The organization id must be copied into `ORGANIZATION_ID` for the
 * web app.
 *
 * Run with `npm run bootstrap`. Configuration comes from flags (highest
 * precedence) or the `BOOTSTRAP_*` environment variables; the owner password
 * comes only from `BOOTSTRAP_OWNER_PASSWORD` (never a flag, so it stays out of
 * shell history and `ps`) or is generated with the CSPRNG and printed once to
 * stdout. It is never written to a log or the audit table.
 *
 * Idempotent: a second run for the same organization refuses once an `owner`
 * exists, unless `--force`/`BOOTSTRAP_FORCE` is set. See
 * `docs/runbooks/deployment.md` ("First-owner bootstrap").
 *
 * `--dry-run` (or `BOOTSTRAP_DRY_RUN=1`) prints what a run would create and
 * writes nothing: it calls the read-only `planBootstrapFirstOwner`, never
 * `bootstrapFirstOwner`, so the two paths cannot be combined. The organization
 * name is the idempotency key and must be spelled exactly on every run.
 */

const USAGE = `Usage: npm run bootstrap -- [options]

Required (flag or env):
  --organization-name <name>   BOOTSTRAP_ORGANIZATION_NAME
  --owner-email <email>        BOOTSTRAP_OWNER_EMAIL
  --owner-username <username>  BOOTSTRAP_OWNER_USERNAME
  (at least one of owner-email / owner-username)

Optional:
  --owner-display-name <name>  BOOTSTRAP_OWNER_DISPLAY_NAME
  --role-code <code>           BOOTSTRAP_ROLE_CODE (default: owner)
  --location-id <uuid>         BOOTSTRAP_LOCATION_ID (org-wide grant when absent)
  --force                      BOOTSTRAP_FORCE=1 (bypass the owner-exists guard)
  --dry-run                    BOOTSTRAP_DRY_RUN=1 (print what would be created; write nothing)
  --help

Env only:
  BOOTSTRAP_OWNER_PASSWORD     owner password (min ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters);
                               generated and printed once when unset
  DATABASE_URL                 PostgreSQL connection string (required)`;

interface CliOptions {
  organizationName?: string;
  ownerEmail?: string;
  ownerUsername?: string;
  ownerDisplayName?: string;
  roleCode?: string;
  locationId?: string;
  force: boolean;
  dryRun: boolean;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { force: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
    const equals = arg.indexOf("=");
    const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    if (value === undefined || value.length === 0) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`missing value for --${key}`);
      }
      index += 1;
    }
    switch (key) {
      case "organization-name":
        options.organizationName = value;
        break;
      case "owner-email":
        options.ownerEmail = value;
        break;
      case "owner-username":
        options.ownerUsername = value;
        break;
      case "owner-display-name":
        options.ownerDisplayName = value;
        break;
      case "role-code":
        options.roleCode = value;
        break;
      case "location-id":
        options.locationId = value;
        break;
      default:
        throw new UsageError(`unknown option: --${key}`);
    }
  }
  return options;
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Maps a bootstrap refusal to the operator-facing message and exit code. */
function refuse(
  result: { readonly reason: BootstrapFailure; readonly organizationId?: string },
  organizationName: string,
): never {
  if (result.reason === "owner_exists") {
    const suffix = result.organizationId === undefined ? "" : ` (${result.organizationId})`;
    return fail(
      `Refusing to bootstrap: organization "${organizationName}" already has an owner${suffix}.\n` +
        "Re-run with --force (or BOOTSTRAP_FORCE=1) to override.",
      2,
    );
  }
  if (result.reason === "identifier_taken") {
    return fail(
      `Refusing to bootstrap: that email/username already belongs to a user in ` +
        `organization "${organizationName}". Use a different identifier.`,
      3,
    );
  }
  if (result.reason === "password_too_short") {
    return fail(
      `BOOTSTRAP_OWNER_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters.`,
      3,
    );
  }
  return fail("Refusing to bootstrap: invalid input.", 3);
}

/** Renders a dry-run plan; deliberately contains no secret and no guessed id. */
function renderPlan(plan: BootstrapPlan): string {
  const organization = `${plan.organization.legalName} (${
    plan.organization.create ? "new" : `existing, id ${plan.organization.id ?? "unknown"}`
  })`;
  const role = `${plan.role.code} (${
    plan.role.create ? "new" : `existing, id ${plan.role.id ?? "unknown"}`
  })`;
  const identifiers = [
    plan.user.email === undefined ? undefined : `email: ${plan.user.email}`,
    plan.user.username === undefined ? undefined : `username: ${plan.user.username}`,
  ].filter((part): part is string => part !== undefined);
  const owner = `${plan.user.displayName}${
    identifiers.length > 0 ? ` (${identifiers.join(", ")})` : ""
  } — ${plan.user.generatesPassword ? "password generated at write time" : "password supplied"}`;
  const scope =
    plan.grant.locationId === null ? "org-wide (no location)" : `location ${plan.grant.locationId}`;

  return [
    "Dry run — nothing was written (no transaction, no audit row).",
    "",
    "Would create:",
    `  organization: ${organization}`,
    `  owner role:   ${role}`,
    `  owner user:   ${owner}`,
    `  role grant:   ${plan.role.code} -> ${
      plan.user.email ?? plan.user.username ?? plan.user.displayName
    } (${scope}, new)`,
    "",
    "Re-run without --dry-run to apply.",
  ].join("\n");
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof UsageError ? error.message : "invalid arguments", 1);
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const organizationName = firstDefined(
    options.organizationName,
    process.env.BOOTSTRAP_ORGANIZATION_NAME,
  );
  const ownerEmail = firstDefined(options.ownerEmail, process.env.BOOTSTRAP_OWNER_EMAIL);
  const ownerUsername = firstDefined(options.ownerUsername, process.env.BOOTSTRAP_OWNER_USERNAME);
  const ownerDisplayName = firstDefined(
    options.ownerDisplayName,
    process.env.BOOTSTRAP_OWNER_DISPLAY_NAME,
  );
  const roleCode = firstDefined(options.roleCode, process.env.BOOTSTRAP_ROLE_CODE);
  const locationId = firstDefined(options.locationId, process.env.BOOTSTRAP_LOCATION_ID);
  const force = options.force || envFlag("BOOTSTRAP_FORCE");
  const dryRun = options.dryRun || envFlag("BOOTSTRAP_DRY_RUN");
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;

  if (organizationName === undefined) {
    fail("BOOTSTRAP_ORGANIZATION_NAME (or --organization-name) is required", 1);
  }
  if (ownerEmail === undefined && ownerUsername === undefined) {
    fail("BOOTSTRAP_OWNER_EMAIL or BOOTSTRAP_OWNER_USERNAME (or flags) is required", 1);
  }

  const config = loadConfig();
  const client = createDb(config.DATABASE_URL);
  try {
    const input: BootstrapFirstOwnerInput = {
      organizationName,
      ...(ownerEmail === undefined ? {} : { ownerEmail }),
      ...(ownerUsername === undefined ? {} : { ownerUsername }),
      ...(ownerDisplayName === undefined ? {} : { ownerDisplayName }),
      ...(roleCode === undefined ? {} : { roleCode }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(password === undefined ? {} : { password }),
      force,
    };

    // Dry run is a separate, read-only command: it returns before the write
    // path below, so a preview can never fall through to a write.
    if (dryRun) {
      const plan = await planBootstrapFirstOwner(createPostgresBootstrapStore(client.db), input);
      if (!plan.ok) {
        refuse(plan, organizationName);
      }
      process.stdout.write(`${renderPlan(plan.plan)}\n`);
      return;
    }

    const result = await bootstrapFirstOwner(createPostgresBootstrapStore(client.db), {}, input);
    if (!result.ok) {
      refuse(result, organizationName);
    }

    process.stdout.write(
      [
        "Bootstrap complete.",
        `  organization: ${result.organizationId}  (${organizationName})`,
        `  owner user:   ${result.userId}  (${ownerEmail ?? ownerUsername})`,
        `  role granted: ${result.roleId}`,
      ].join("\n") + "\n",
    );
    if (result.generatedPassword !== undefined) {
      process.stdout.write(
        [
          "",
          "Generated owner password (shown once — store it now):",
          `  ${result.generatedPassword}`,
          "You must change it at first login.",
        ].join("\n") + "\n",
      );
    } else {
      process.stdout.write(
        "\nOwner password was supplied via BOOTSTRAP_OWNER_PASSWORD; change it at first login.\n",
      );
    }
    process.stdout.write("\nSet ORGANIZATION_ID to the organization id above, then sign in.\n");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  // Never echo an error that could embed a credential: print only the message of
  // an Error we raised, otherwise a generic failure.
  process.stderr.write(`${error instanceof Error ? error.message : "bootstrap failed"}\n`);
  process.exit(1);
});
