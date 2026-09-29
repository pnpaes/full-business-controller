"use client";

import {
  Alert,
  Button,
  InfoTip,
  Modal,
  SectionCard,
  StatusPill,
  SuccessToast,
  TextField,
  color,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { closeScopeLabel, closeStatusView } from "./close-labels";

const LOCK_FALLBACK = "Could not lock the close. Please try again.";
const REOPEN_FALLBACK = "Could not reopen the close. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface CloseStateActionRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeLabel: string;
  readonly periodLabel: string;
  readonly status: string;
  /** True when the row is `closing` and the caller may lock it at this scope. */
  readonly canLock: boolean;
  /** True when the row is `locked` and the caller may reopen it at this scope. */
  readonly canReopen: boolean;
}

type Pending = { readonly row: CloseStateActionRow; readonly action: "lock" | "reopen" };

/**
 * The irreversible close state changes, kept **apart** from the read-only
 * register (`DEC-119`, `DEC-027`). A `closing` close is locked; a `locked` close
 * is reopened with a **required** reason (the audited, elevated-permission path).
 * Both actions open a confirmation that states the consequence above the confirm
 * button, because neither can be undone from this screen. The server remains the
 * authority on the transition and the scope, so a rejected action surfaces its
 * message rather than being silently accepted.
 */
export function CloseStateActions({ rows }: { readonly rows: readonly CloseStateActionRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const actionable = rows.filter((row) => row.canLock || row.canReopen);
  if (actionable.length === 0) {
    return null;
  }

  function closeModal(): void {
    if (!busy) {
      setPending(null);
      setReason("");
      setError(null);
    }
  }

  async function lock(closeId: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/period-closes/${closeId}/lock`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, LOCK_FALLBACK));
        return;
      }
      setToast("Period locked. Its figures are now frozen.");
      setPending(null);
      router.refresh();
    } catch {
      setError(LOCK_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  async function reopen(event: FormEvent<HTMLFormElement>, closeId: string): Promise<void> {
    event.preventDefault();
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reopen reason is required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/period-closes/${closeId}/reopen`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, REOPEN_FALLBACK));
        return;
      }
      setToast("Period reopened for correction.");
      setPending(null);
      setReason("");
      router.refresh();
    } catch {
      setError(REOPEN_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard title="Period state changes" meta="irreversible · recorded on the audit trail">
        <Alert tone="warning" title="These actions freeze or unfreeze a period">
          Locking a begun close freezes the period&rsquo;s figures; reopening a locked close
          unfreezes it for correction. Neither can be undone from this screen.
          <InfoTip
            content="Locking freezes the period, after which its figures cannot change. Reopening is the audited undo: it requires a reason and is recorded with your identity; the close must be begun and locked again afterwards."
            label="What lock and reopen do"
          />
        </Alert>

        <ul
          style={{
            listStyle: "none",
            margin: `${spacing[4]}px 0 0`,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: spacing[3],
          }}
        >
          {actionable.map((row) => {
            const status = closeStatusView(row.status);
            return (
              <li
                key={row.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: spacing[3],
                  padding: spacing[3],
                  border: `1px solid ${color.border.subtle}`,
                  borderRadius: radius.md,
                  backgroundColor: color.surface.base,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                  <span style={{ fontWeight: typography.fontWeight.semibold }}>
                    {row.scopeLabel}
                  </span>
                  <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
                    {row.periodLabel} · {closeScopeLabel(row.scopeType)}
                  </span>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </div>
                <div style={{ display: "flex", gap: spacing[2] }}>
                  {row.canLock ? (
                    <>
                      <Button onClick={() => setPending({ row, action: "lock" })}>
                        Lock close
                      </Button>
                      <InfoTip
                        content="Freezes the period’s figures once locked. Irreversible here — a correction needs an audited reopen."
                        label="What locking does"
                      />
                    </>
                  ) : null}
                  {row.canReopen ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setPending({ row, action: "reopen" })}
                      >
                        Reopen
                      </Button>
                      <InfoTip
                        content="Unfreezes a locked period for correction. Requires a reason and is recorded on the audit trail."
                        label="What reopening does"
                      />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <Modal
        title={
          pending === null
            ? ""
            : pending.action === "lock"
              ? "Lock this period?"
              : "Reopen this period?"
        }
        open={pending !== null}
        onClose={closeModal}
      >
        {pending === null ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            <p style={{ margin: 0, color: color.ink.secondary }}>
              {pending.action === "lock"
                ? "Locking freezes this period: its figures are frozen and cannot change. Locking cannot be reversed here — undoing it needs an audited reopen with a reason."
                : "Reopening unfreezes a locked period so it can be corrected. It is recorded on the audit trail with your reason, and the close must be begun and locked again afterwards."}
            </p>
            <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.ink.tertiary }}>
              {pending.row.scopeLabel} · {pending.row.periodLabel}
            </p>

            {error !== null ? <Alert tone="danger">{error}</Alert> : null}

            {pending.action === "lock" ? (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing[3] }}>
                <Button variant="secondary" onClick={closeModal} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => void lock(pending.row.id)} loading={busy} disabled={busy}>
                  Lock close
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(event) => void reopen(event, pending.row.id)}
                style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}
              >
                <TextField
                  name={`reopen-reason-${pending.row.id}`}
                  label="Reopen reason"
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. late settlement import"
                  help="Required and recorded on the audit trail."
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing[3] }}>
                  <Button type="button" variant="secondary" onClick={closeModal} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="danger" loading={busy} disabled={busy}>
                    Reopen close
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>

      <SuccessToast open={toast !== null} onDismiss={() => setToast(null)} message={toast ?? ""} />
    </>
  );
}
