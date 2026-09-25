"use client";

import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  DataTable,
  EmptyState,
  Modal,
  SelectField,
  StatusPill,
  TextField,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RoleRow, UserRow } from "../../api/v1/administration/admin-rows";

const FALLBACK_ERROR = "Could not apply the change. Please try again.";

type Action = "grant" | "revoke" | "scopes" | "disable" | "enable";

interface Feedback {
  readonly tone: "success" | "danger";
  readonly message: string;
}

interface Target {
  readonly user: UserRow;
  readonly action: Action;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const norwegianDateTime = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO instant → `dd.MM.yyyy HH:mm`; `null`/unparseable → an em dash (§7.8 locale-aware). */
function formatLastLogin(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDateTime.format(date);
}

/** The grant value encoding both the role and its optional location. */
function grantValue(roleId: string, locationId: string | null): string {
  return `${roleId}|${locationId ?? ""}`;
}

function parseGrantValue(value: string): {
  readonly roleId: string;
  readonly locationId: string | null;
} {
  const [roleId = "", locationId = ""] = value.split("|");
  return { roleId, locationId: locationId.length === 0 ? null : locationId };
}

/**
 * Whether an action signs the user out. A role or status change revokes every
 * session in the same transaction (ADR-0003); a location-scope change does not,
 * because authorization is loaded live per request. Stated in the dialog before
 * the operator confirms, because it is a real consequence for the affected user.
 */
function revokesSessions(action: Action): boolean {
  return action !== "scopes";
}

/** A location the operator can pick for a scope, shown by its code and name. */
export interface LocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface UserAccessManagerProps {
  readonly users: readonly UserRow[];
  readonly roles: readonly RoleRow[];
  readonly locations: readonly LocationOption[];
}

/**
 * The users & access management surface (`07_SECURITY_AND_NFR.md` §7.1
 * "Users/configuration"): each existing user's roles, location scopes and status,
 * with the grant/revoke/scopes/disable/enable actions wired to the administration
 * routes. Every mutating dialog states the session consequence before the
 * operator confirms.
 *
 * User **creation** is deliberately absent: an invite link cannot be delivered
 * (password-reset delivery is not configured) and an admin-set initial password
 * would mean sharing credentials. That is an open decision, not a missing
 * button.
 */
export function UserAccessManager({ users, roles, locations }: UserAccessManagerProps) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roleId, setRoleId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [scopeIds, setScopeIds] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");

  /** `code · name` for a location id; the raw uuid never reaches the screen. */
  function locationLabel(id: string): string {
    const location = locations.find((entry) => entry.id === id);
    return location === undefined ? "Unknown location" : `${location.code} · ${location.name}`;
  }

  function open(user: UserRow, action: Action): void {
    setTarget({ user, action });
    setError(null);
    setFeedback(null);
    setRoleId(roles[0]?.id ?? "");
    setLocationId("");
    setScopeIds([...user.locationIds]);
    setReason("");
  }

  function toggleScope(id: string, checked: boolean): void {
    setScopeIds((current) =>
      checked ? [...current, id] : current.filter((entry) => entry !== id),
    );
  }

  function close(): void {
    setTarget(null);
    setError(null);
  }

  async function submit(): Promise<void> {
    if (target === null) {
      return;
    }
    const { user, action } = target;
    setError(null);
    setBusy(true);
    try {
      let path: string;
      let body: Record<string, unknown>;
      switch (action) {
        case "grant":
          path = "roles/grant";
          body = {
            roleId,
            locationId: locationId.trim().length === 0 ? null : locationId.trim(),
          };
          break;
        case "revoke": {
          const grant = parseGrantValue(roleId);
          path = "roles/revoke";
          body = { roleId: grant.roleId, locationId: grant.locationId };
          break;
        }
        case "scopes":
          path = "location-scopes";
          body = { locationIds: scopeIds };
          break;
        case "disable":
          path = "disable";
          body = reason.trim().length === 0 ? {} : { reason: reason.trim() };
          break;
        case "enable":
          path = "enable";
          body = reason.trim().length === 0 ? {} : { reason: reason.trim() };
          break;
      }

      const response = await fetch(`/api/v1/administration/users/${user.id}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setFeedback({ tone: "success", message: successMessage(action, user.displayName) });
      setTarget(null);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (users.length === 0) {
    return (
      <EmptyState title="No users in this organization">
        The organization has no user accounts. Creating a user is not available yet: an invite link
        cannot be delivered (password-reset delivery is not configured) and an admin-set initial
        password would mean sharing credentials — an open decision, not a missing button.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
      <Alert tone="info" title="Creating a new user is not available yet">
        The user account exists only after a user-creation flow, which is an open decision: an
        invite link cannot be delivered today (password-reset delivery is not configured) and an
        admin-set initial password would mean sharing credentials. This surface manages{" "}
        <strong>existing</strong> users only.
      </Alert>

      {feedback !== null ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      <div style={{ overflowX: "auto", minWidth: 0 }}>
        <DataTable
          caption="Users of this organization with their roles, location scopes and status."
          columns={[
            { key: "user", header: "User" },
            { key: "status", header: "Status" },
            { key: "roles", header: "Roles" },
            { key: "scopes", header: "Location scopes" },
            { key: "lastLogin", header: "Last login" },
            { key: "actions", header: "Actions" },
          ]}
          rows={users.map((user) => ({
            user: (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                <span style={{ fontWeight: typography.fontWeight.medium }}>{user.displayName}</span>
                <span style={{ fontSize: typography.fontSize.sm, color: "inherit" }}>
                  {user.username ?? "—"}
                  {user.email === null ? "" : ` · ${user.email}`}
                </span>
              </div>
            ),
            status: (
              <StatusPill tone={user.status === "active" ? "success" : "danger"}>
                {user.status}
              </StatusPill>
            ),
            roles:
              user.roles.length === 0 ? (
                "—"
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}>
                  {user.roles.map((role) => (
                    <Badge key={`${role.roleId}:${role.locationId ?? ""}`}>
                      {role.code}
                      {role.locationId === null ? "" : ` @ ${locationLabel(role.locationId)}`}
                    </Badge>
                  ))}
                </div>
              ),
            scopes:
              user.locationIds.length === 0 ? (
                "—"
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}>
                  {user.locationIds.map((id) => (
                    <Badge key={id}>{locationLabel(id)}</Badge>
                  ))}
                </div>
              ),
            lastLogin: formatLastLogin(user.lastLoginAt),
            actions: (
              <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
                <Button size="sm" variant="secondary" onClick={() => open(user, "grant")}>
                  Grant role
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={user.roles.length === 0}
                  onClick={() => open(user, "revoke")}
                >
                  Revoke role
                </Button>
                <Button size="sm" variant="secondary" onClick={() => open(user, "scopes")}>
                  Scopes
                </Button>
                {user.status === "active" ? (
                  <Button size="sm" variant="secondary" onClick={() => open(user, "disable")}>
                    Disable
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => open(user, "enable")}>
                    Enable
                  </Button>
                )}
              </div>
            ),
          }))}
          emptyMessage="No users in this organization."
        />
      </div>

      <Modal
        title={target === null ? "" : dialogTitle(target.action, target.user.displayName)}
        open={target !== null}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={target?.action === "disable" ? "danger" : "primary"}
              onClick={submit}
              loading={busy}
              disabled={busy}
            >
              {target === null ? "Confirm" : confirmLabel(target.action)}
            </Button>
          </>
        }
      >
        {target !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            {error !== null ? <Alert tone="danger">{error}</Alert> : null}
            <Alert tone={revokesSessions(target.action) ? "warning" : "info"}>
              {revokesSessions(target.action)
                ? `This is a privilege change: every active session for ${target.user.displayName} is revoked immediately. They will be signed out and must sign in again.`
                : `Location scope is checked live on every request, so this takes effect on ${target.user.displayName}'s next request without signing them out.`}
            </Alert>
            {target.action === "grant" ? (
              <>
                <SelectField
                  name="roleId"
                  label="Role"
                  required
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                  options={roles.map((role) => ({
                    value: role.id,
                    label: `${role.name} (${role.code})`,
                  }))}
                  placeholder="Select a role"
                  help="A role from this organization's catalogue."
                />
                <SelectField
                  name="locationId"
                  label="Location (optional)"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  options={locations.map((location) => ({
                    value: location.id,
                    label: `${location.code} · ${location.name}`,
                  }))}
                  placeholder="Organization-wide (no location)"
                  help="Leave empty to grant the role organization-wide."
                />
              </>
            ) : null}
            {target.action === "revoke" ? (
              <SelectField
                name="grant"
                label="Role grant to revoke"
                required
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                options={target.user.roles.map((role) => ({
                  value: grantValue(role.roleId, role.locationId),
                  label:
                    role.locationId === null
                      ? `${role.code} (organization-wide)`
                      : `${role.code} @ ${locationLabel(role.locationId)}`,
                }))}
                placeholder="Select a grant"
                help="One of the roles this user currently holds."
              />
            ) : null}
            {target.action === "scopes" ? (
              locations.length === 0 ? (
                <Alert tone="info">
                  This organization has no locations registered, so a location scope cannot be set.
                </Alert>
              ) : (
                <fieldset
                  style={{
                    border: 0,
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: spacing[1],
                  }}
                >
                  <legend
                    style={{
                      padding: 0,
                      fontWeight: typography.fontWeight.medium,
                      fontSize: typography.fontSize.md,
                    }}
                  >
                    Locations in scope
                  </legend>
                  <p
                    style={{
                      margin: 0,
                      fontSize: typography.fontSize.sm,
                      color: color.ink.secondary,
                    }}
                  >
                    The whole scope is replaced. Select none to clear it.
                  </p>
                  {locations.map((location) => (
                    <CheckboxField
                      key={location.id}
                      name={`scope-${location.id}`}
                      label={`${location.code} · ${location.name}`}
                      checked={scopeIds.includes(location.id)}
                      onChange={(event) => toggleScope(location.id, event.target.checked)}
                    />
                  ))}
                </fieldset>
              )
            ) : null}
            {target.action === "disable" || target.action === "enable" ? (
              <TextField
                name="reason"
                label="Reason (optional)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                help="Recorded in the audit trail for this status change."
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function dialogTitle(action: Action, name: string): string {
  switch (action) {
    case "grant":
      return `Grant a role — ${name}`;
    case "revoke":
      return `Revoke a role — ${name}`;
    case "scopes":
      return `Location scopes — ${name}`;
    case "disable":
      return `Disable user — ${name}`;
    case "enable":
      return `Enable user — ${name}`;
  }
}

function confirmLabel(action: Action): string {
  switch (action) {
    case "grant":
      return "Grant role";
    case "revoke":
      return "Revoke role";
    case "scopes":
      return "Save scopes";
    case "disable":
      return "Disable user";
    case "enable":
      return "Enable user";
  }
}

function successMessage(action: Action, name: string): string {
  switch (action) {
    case "grant":
      return `Role granted to ${name}. Their sessions were revoked.`;
    case "revoke":
      return `Role revoked from ${name}. Their sessions were revoked.`;
    case "scopes":
      return `Location scopes updated for ${name}. They stay signed in.`;
    case "disable":
      return `${name} was disabled and signed out.`;
    case "enable":
      return `${name} was enabled.`;
  }
}
