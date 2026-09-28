"use client";

import {
  Alert,
  Button,
  CheckboxField,
  FormModal,
  TextField,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";

const FALLBACK_ERROR = "Could not add the position. Please try again.";

export interface PositionOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface PositionPickerProps {
  /** The catalogue positions the caller may select; already filtered to scope. */
  readonly positions: readonly PositionOption[];
  /** The currently selected position ids (controlled). */
  readonly selectedIds: readonly string[];
  readonly onChange: (positionIds: readonly string[]) => void;
  /** True when the caller holds the workforce write roles (can add a position). */
  readonly canWrite: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The employee position set (`DEC-151`): a checkbox list from the open catalogue
 * plus an **add-position modal** (`docs/ux/README.md`: creation happens in a
 * modal, never an inline form). The selection is controlled by the parent form
 * and submitted with the employee as `positionIds`; a position is matched to
 * shifts, so the roster only offers an employee the shifts they hold.
 */
export function PositionPicker({
  positions,
  selectedIds,
  onChange,
  canWrite,
}: PositionPickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The picker sits inside the employee `<form>`; the add-position modal renders
  // through a portal so its own `<form>` is not nested in the outer one (nested
  // forms are invalid HTML and make the submit fall through to a native GET).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedIds, id])]
      : selectedIds.filter((current) => current !== id);
    onChange(next);
  };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (code.trim().length === 0 || name.trim().length === 0 || activeFrom.trim().length === 0) {
      setError("Code, name and active-from date are required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workforce/positions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          activeFrom: activeFrom.trim(),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setCode("");
      setName("");
      setActiveFrom("");
      setOpen(false);
      // The catalogue is a server read; refresh so the new position appears in
      // the checkbox list (the modal closes and the list repopulates).
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset
      style={{
        margin: 0,
        padding: 0,
        border: "none",
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
      }}
    >
      <legend style={{ fontWeight: typography.fontWeight.semibold, marginBottom: spacing[1] }}>
        Positions
      </legend>
      <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.ink.tertiary }}>
        The jobs this employee holds. Only shifts staffed for one of these positions are offered to
        them (DEC-151).
      </p>
      {positions.length === 0 ? (
        <Alert tone="info">
          No positions yet. Add one below — a position is a job (barista, cook, helper, cleaner)
          that shifts are matched against.
        </Alert>
      ) : (
        positions.map((position) => (
          <CheckboxField
            key={position.id}
            name="positionIds"
            label={position.name}
            value={position.id}
            checked={selectedIds.includes(position.id)}
            onChange={(event) => toggle(position.id, event.target.checked)}
          />
        ))
      )}
      {canWrite ? (
        <div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Add position
          </Button>
        </div>
      ) : null}

      {mounted && canWrite
        ? createPortal(
            <FormModal
              title="Add position"
              description="A position is an open catalogue entry — add as many as the business needs."
              open={open}
              onClose={() => setOpen(false)}
              onSubmit={submit}
              busy={busy}
              submitLabel="Add position"
              error={error}
            >
              <TextField
                name="positionCode"
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="barista"
              />
              <TextField
                name="positionName"
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Barista"
              />
              <TextField
                name="positionActiveFrom"
                label="Active from"
                type="date"
                required
                value={activeFrom}
                onChange={(event) => setActiveFrom(event.target.value)}
              />
            </FormModal>,
            document.body,
          )
        : null}
    </fieldset>
  );
}
