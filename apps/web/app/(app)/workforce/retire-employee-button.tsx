"use client";

import { Alert, Button, InfoTip, Modal, color, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not retire the employee. Please try again.";

/**
 * Retires one employee (`WF-007`, `DEC-087`): the tombstone action — employees
 * are retired, never deleted, and retirement is idempotent server-side. The
 * consequence is stated in the confirmation **before** the confirm button
 * (the `jobs-register.tsx` precedent), and the action is offered only for a
 * not-yet-retired employee the caller may write.
 */
export function RetireEmployeeButton({ employeeId }: { readonly employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/employees/${employeeId}/retire`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="danger" onClick={() => setOpen(true)}>
        Retire employee
      </Button>

      <Modal
        title="Retire this employee?"
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <p style={{ margin: 0 }}>
            The employee is marked retired from today and stops appearing as active in the register
            and in shift assignment. The record and its history are kept — this is not a deletion.
          </p>
          <p
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: spacing[1],
              fontSize: typography.fontSize.sm,
              color: color.ink.tertiary,
            }}
          >
            What retirement means
            <InfoTip
              content="Retiring is the only way to take an employee off the active register: the row is tombstoned (retired at a timestamp), never deleted, and the action is idempotent. Shifts already assigned stay as history. Amend the profile instead if this was a mistake."
              label="What retiring an employee does"
            />
          </p>
          <div style={{ display: "flex", gap: spacing[2], justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={retire} loading={busy} disabled={busy}>
              Retire employee
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
