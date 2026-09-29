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
  SuccessToast,
  TextField,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  allowedOperationLabel,
  allowedOperationsLabel,
  directionLabel,
  isWriteOperation,
  systemTypeLabel,
  termsStatusLabel,
} from "./integration-labels";

const FALLBACK_ERROR = "Could not save the integration source. Please try again.";

const SYSTEM_TYPES = ["pos", "medusa", "sanity", "wolt", "fiken", "other"] as const;
const DIRECTIONS = ["read", "write", "read_write"] as const;
const ALLOWED_OPERATIONS = [
  "read",
  "write_price",
  "write_menu_product",
  "write_stock",
  "write_accounting",
] as const;
const TERMS_STATUSES = ["pending", "approved", "rejected"] as const;

const SYSTEM_TYPE_OPTIONS = SYSTEM_TYPES.map((value) => ({
  value,
  label: systemTypeLabel(value),
}));
const DIRECTION_OPTIONS = DIRECTIONS.map((value) => ({ value, label: directionLabel(value) }));
const TERMS_STATUS_OPTIONS = TERMS_STATUSES.map((value) => ({
  value,
  label: termsStatusLabel(value),
}));

export interface IntegrationSourceRow {
  readonly id: string;
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
}

export interface IntegrationRegisterProps {
  readonly rows: readonly IntegrationSourceRow[];
  /** When false the register is read-only: no create form and no edit action. */
  readonly canWrite: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

function termsTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") {
    return "success";
  }
  return status === "rejected" ? "danger" : status === "pending" ? "warning" : "neutral";
}

interface IntegrationFormProps {
  /** `null` registers a new source; a row edits it in place. */
  readonly source: IntegrationSourceRow | null;
  readonly onSaved: (name: string, mode: "created" | "updated") => void;
}

/**
 * The field set for one integration source, shared by register and edit. The
 * client refuses a write operation while the terms are not `approved`
 * (`DEC-015`) before posting, and the command plus the database check are the
 * authority behind that. No secret is ever entered here: the credentials owner
 * is a name, not a credential.
 */
function IntegrationForm({ source, onSaved }: IntegrationFormProps) {
  const router = useRouter();
  const isEdit = source !== null;
  const [name, setName] = useState(source?.name ?? "");
  const [systemType, setSystemType] = useState(source?.systemType ?? "pos");
  const [direction, setDirection] = useState(source?.direction ?? "read");
  const [operations, setOperations] = useState<readonly string[]>(
    source === null ? [] : [...source.allowedOperations],
  );
  const [credentialsOwner, setCredentialsOwner] = useState(source?.credentialsOwner ?? "");
  const [rateLimitNote, setRateLimitNote] = useState(source?.rateLimitNote ?? "");
  const [termsStatus, setTermsStatus] = useState(source?.termsStatus ?? "pending");
  const [active, setActive] = useState(source?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleOperation(operation: string, checked: boolean): void {
    setOperations((current) =>
      checked ? [...current, operation] : current.filter((value) => value !== operation),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedOwner = credentialsOwner.trim();
    if (trimmedName.length === 0) {
      setError("Enter a source name.");
      return;
    }
    if (trimmedOwner.length === 0) {
      setError(
        "Name the credentials owner — the person accountable for this source's credentials.",
      );
      return;
    }
    if (operations.some(isWriteOperation) && termsStatus !== "approved") {
      setError('A write operation can only be enabled once this source\'s terms are "approved".');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        isEdit
          ? `/api/v1/administration/integrations/${source.id}`
          : "/api/v1/administration/integrations",
        {
          method: isEdit ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            systemType,
            direction,
            allowedOperations: operations,
            credentialsOwner: trimmedOwner,
            rateLimitNote: rateLimitNote.trim().length === 0 ? null : rateLimitNote.trim(),
            termsStatus,
            active,
          }),
        },
      );
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      onSaved(trimmedName, isEdit ? "updated" : "created");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <TextField
        name="name"
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Till POS"
        help="Organization-unique (the register enforces it)."
      />
      <SelectField
        name="systemType"
        label="System type"
        options={SYSTEM_TYPE_OPTIONS}
        value={systemType}
        onChange={(event) => setSystemType(event.target.value)}
      />
      <SelectField
        name="direction"
        label="Direction"
        options={DIRECTION_OPTIONS}
        value={direction}
        onChange={(event) => setDirection(event.target.value)}
        help="Read-only is the default posture; a write direction still needs approved terms."
      />
      <fieldset
        style={{
          border: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: spacing[1],
        }}
      >
        <legend>Allowed operations</legend>
        {ALLOWED_OPERATIONS.map((operation) => (
          <CheckboxField
            key={operation}
            name={`operation-${operation}`}
            label={allowedOperationLabel(operation)}
            defaultChecked={operations.includes(operation)}
            onChange={(event) => toggleOperation(operation, event.target.checked)}
          />
        ))}
      </fieldset>
      <TextField
        name="credentialsOwner"
        label="Credentials owner"
        required
        value={credentialsOwner}
        onChange={(event) => setCredentialsOwner(event.target.value)}
        placeholder="e.g. Ada Lovelace"
        help="A named person accountable for the credentials; not a secret."
      />
      <TextField
        name="rateLimitNote"
        label="Rate-limit note"
        value={rateLimitNote}
        onChange={(event) => setRateLimitNote(event.target.value)}
        placeholder="e.g. 60 requests/minute"
        help="Optional free text recorded from the provider's terms."
      />
      <SelectField
        name="termsStatus"
        label="Terms status"
        options={TERMS_STATUS_OPTIONS}
        value={termsStatus}
        onChange={(event) => setTermsStatus(event.target.value)}
        help="Per-source approval. A write operation requires approved."
      />
      <CheckboxField
        name="active"
        label="Active"
        defaultChecked={source?.active ?? true}
        onChange={(event) => setActive(event.target.checked)}
        help="An inactive source stays configured but is not used."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          {isEdit ? "Save changes" : "Register source"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The integration-source registry (`INTG-001`, `DEC-137`). Configuration only:
 * publishing execution (`INTG-002`) is not built, so this surface registers *who
 * owns the credentials*, *what data may move* and *whether the terms are
 * approved* — it never moves data. The editor refuses a write operation until
 * the source's terms are approved (`DEC-015`).
 */
export function IntegrationRegister({ rows, canWrite }: IntegrationRegisterProps) {
  const [editing, setEditing] = useState<IntegrationSourceRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function saved(name: string, mode: "created" | "updated"): void {
    setNotice(mode === "created" ? `Registered ${name}.` : `Updated ${name}.`);
    if (mode === "created") {
      setCreating(false);
    }
    setEditing(null);
  }

  return (
    <>
      {notice !== null ? <Alert tone="success">{notice}</Alert> : null}

      {rows.length === 0 ? (
        <EmptyState variant="plain" title="No integration sources registered">
          Register the external systems this organization may exchange data with. A source records
          the credentials owner, the allowed operations and whether its terms are approved; nothing
          is published yet.
        </EmptyState>
      ) : (
        <DataTable
          caption="Integration sources for this organization, with direction, allowed operations and per-source terms status."
          columns={[
            { key: "name", header: "Name · system" },
            { key: "direction", header: "Direction" },
            { key: "operations", header: "Allowed operations" },
            { key: "owner", header: "Credentials owner" },
            { key: "terms", header: "Terms" },
            { key: "active", header: "Active" },
            ...(canWrite ? [{ key: "actions", header: "Actions" }] : []),
          ]}
          rows={rows.map((row) => ({
            name: (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                <span style={{ fontWeight: typography.fontWeight.medium }}>{row.name}</span>
                <Badge>{systemTypeLabel(row.systemType)}</Badge>
              </div>
            ),
            direction: directionLabel(row.direction),
            operations: allowedOperationsLabel(row.allowedOperations),
            owner: row.credentialsOwner,
            terms: (
              <StatusPill tone={termsTone(row.termsStatus)}>
                {termsStatusLabel(row.termsStatus)}
              </StatusPill>
            ),
            active: row.active ? (
              <StatusPill tone="success">active</StatusPill>
            ) : (
              <StatusPill tone="neutral">inactive</StatusPill>
            ),
            ...(canWrite
              ? {
                  actions: (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                  ),
                }
              : {}),
          }))}
          emptyMessage="No integration sources registered."
        />
      )}

      {canWrite ? (
        <div style={{ marginTop: spacing[4] }}>
          <Button onClick={() => setCreating(true)}>Register source</Button>
        </div>
      ) : null}

      <Modal title="Register source" open={creating} onClose={() => setCreating(false)}>
        <IntegrationForm key="create" source={null} onSaved={saved} />
      </Modal>

      <Modal
        title={editing === null ? "" : `Edit integration source ${editing.name}`}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing === null ? null : (
          <IntegrationForm key={editing.id} source={editing} onSaved={saved} />
        )}
      </Modal>

      <SuccessToast
        open={notice !== null}
        onDismiss={() => setNotice(null)}
        message={notice ?? ""}
      />
    </>
  );
}
