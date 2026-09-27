"use client";

import { Alert, Button, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not complete the action. Please try again.";

export interface AssignableEmployeeOption {
  readonly id: string;
  readonly name: string;
  readonly roleCode: string;
  readonly primaryLocationId: string | null;
}

export interface ShiftActionsProps {
  readonly shiftId: string;
  readonly shiftState: string;
  readonly shiftLocationId: string;
  readonly shiftRoleCode: string | null;
  /** Active employees the caller can read (empty when the caller lacks employee-record access). */
  readonly employees: readonly AssignableEmployeeOption[];
  readonly canWrite: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

/**
 * The roster row actions (`WF-002`/`WF-003`, `DEC-037`/`DEC-102`): publish,
 * complete and cancel a shift, and **manager assignment** — employee
 * self-assignment is the separate `My shifts` view (`DEC-146`), so there is no
 * self-assign control here. The employee selector is pre-filtered to the shift's
 * location and role (the server enforces the same rules and stays the
 * authority).
 */
export function ShiftActions({
  shiftId,
  shiftState,
  shiftLocationId,
  shiftRoleCode,
  employees,
  canWrite,
}: ShiftActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");

  if (!canWrite) {
    return null;
  }

  async function post(path: string, init?: { method?: string; body?: unknown }): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(path);
    try {
      const response = await fetch(`/api/v1/workforce/shifts/${shiftId}${path}`, {
        method: init?.method ?? "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init?.body ?? {}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(FALLBACK_ERROR);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (employeeId.length === 0) {
      setError("Choose an employee to assign.");
      return;
    }
    if (await post("/assignments", { body: { employeeId } })) {
      setSuccess("Assigned. Withdraw the assignment to free the shift again.");
      setEmployeeId("");
    }
  }

  const assignable = employees.filter(
    (employee) =>
      employee.primaryLocationId === shiftLocationId &&
      (shiftRoleCode === null || employee.roleCode === shiftRoleCode),
  );

  const canPublish = shiftState === "open";
  const canComplete = shiftState === "published" || shiftState === "assigned";
  const canCancel = shiftState === "open" || shiftState === "published";
  const canAssign = (shiftState === "open" || shiftState === "published") && assignable.length > 0;

  if (!canPublish && !canComplete && !canCancel) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 200 }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}

      <div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
        {canPublish ? (
          <Button
            type="button"
            size="sm"
            loading={busy === "publish"}
            disabled={busy !== null}
            onClick={() => {
              void post("/publish").then((ok) => {
                if (ok) {
                  setSuccess("Published.");
                }
              });
            }}
          >
            Publish
          </Button>
        ) : null}
        {canComplete ? (
          <Button
            type="button"
            size="sm"
            loading={busy === "complete"}
            disabled={busy !== null}
            onClick={() => {
              void post("/complete").then((ok) => {
                if (ok) {
                  setSuccess("Completed.");
                }
              });
            }}
          >
            Complete
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={busy === "cancel"}
            disabled={busy !== null}
            onClick={() => {
              void post("/cancel").then((ok) => {
                if (ok) {
                  setSuccess("Cancelled.");
                }
              });
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      {canAssign ? (
        <form
          onSubmit={assign}
          style={{ display: "flex", gap: spacing[2], alignItems: "flex-end" }}
        >
          <div style={{ flex: "1 1 200px" }}>
            <SelectField
              name={`employee-${shiftId}`}
              label="Assign"
              placeholder="Select an employee"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              options={assignable.map((employee) => ({
                value: employee.id,
                label: `${employee.name} (${employee.roleCode})`,
              }))}
            />
          </div>
          <Button type="submit" size="sm" loading={busy === "assign"} disabled={busy !== null}>
            Assign
          </Button>
        </form>
      ) : null}
    </div>
  );
}
