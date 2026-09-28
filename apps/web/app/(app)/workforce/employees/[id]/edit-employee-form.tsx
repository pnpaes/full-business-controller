"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { PositionPicker } from "../../position-picker";
import type { PositionOption } from "../../position-picker";

const FALLBACK_ERROR = "Could not save the employee. Please try again.";

export interface EditLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface EditRoleOption {
  readonly code: string;
  readonly name: string;
}

export interface EditEmployeeFormProps {
  readonly employeeId: string;
  readonly name: string;
  readonly roleCode: string;
  readonly employmentType: string;
  readonly baseHourlyRate: string;
  readonly primaryLocationId: string | null;
  readonly activeTo: string | null;
  /** `DEC-151`: the positions the employee currently holds. */
  readonly positionIds: readonly string[];
  /** Employment types from the application vocabulary (`EMPLOYMENT_TYPES`). */
  readonly employmentTypes: readonly string[];
  /** Locations the caller may set as primary; already filtered to scope. */
  readonly locations: readonly EditLocationOption[];
  /** The organization's roles (`DEC-151`). */
  readonly roles: readonly EditRoleOption[];
  /** The position catalogue (`DEC-151`). */
  readonly positions: readonly PositionOption[];
  /** False for a location-scoped caller: clearing the primary location is denied (fail-closed). */
  readonly canClearLocation: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Amends one employee (`WF-007`, `DEC-087`) through
 * `PATCH /api/v1/workforce/employees/[id]`. `activeFrom` and `userId` are
 * immutable after creation and are not offered; retirement is the separate
 * tombstone action. `baseHourlyRate` is sent as a decimal string (never a
 * float). A location-scoped caller sees only their own locations and cannot
 * clear the primary location (the API would 403).
 */
export function EditEmployeeForm({
  employeeId,
  name: initialName,
  roleCode: initialRoleCode,
  employmentType: initialEmploymentType,
  baseHourlyRate: initialBaseHourlyRate,
  primaryLocationId: initialPrimaryLocationId,
  activeTo: initialActiveTo,
  positionIds: initialPositionIds,
  employmentTypes,
  locations,
  roles,
  positions,
  canClearLocation,
}: EditEmployeeFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [roleCode, setRoleCode] = useState(initialRoleCode);
  const [positionIds, setPositionIds] = useState<readonly string[]>(initialPositionIds);
  const [employmentType, setEmploymentType] = useState(initialEmploymentType);
  const [baseHourlyRate, setBaseHourlyRate] = useState(initialBaseHourlyRate);
  const [primaryLocationId, setPrimaryLocationId] = useState(initialPrimaryLocationId ?? "");
  const [activeTo, setActiveTo] = useState(initialActiveTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!/^\d+(?:\.\d{1,4})?$/.test(baseHourlyRate.trim())) {
      setError("Hourly rate must be a decimal amount with at most four decimals (e.g. 185.50).");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/employees/${employeeId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          roleCode: roleCode.trim(),
          employmentType,
          baseHourlyRate: baseHourlyRate.trim(),
          primaryLocationId: primaryLocationId.length === 0 ? null : primaryLocationId,
          positionIds,
          activeTo: activeTo.trim().length === 0 ? null : activeTo.trim(),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Saved.");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const locationOptions = [
    ...(canClearLocation ? [{ value: "", label: "None" }] : []),
    ...locations.map((location) => ({
      value: location.id,
      label: `${location.code} · ${location.name}`,
    })),
  ];

  return (
    <SectionCard title="Amend profile" meta="activeFrom and login are immutable after creation">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextField
          name="name"
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          name="roleCode"
          label="Role"
          required
          value={roleCode}
          onChange={(event) => setRoleCode(event.target.value)}
          options={roles.map((role) => ({ value: role.code, label: role.name }))}
          help="The employee's access level (DEC-151) — one of the organization's fixed roles."
        />
        <SelectField
          name="employmentType"
          label="Employment type"
          required
          value={employmentType}
          onChange={(event) => setEmploymentType(event.target.value)}
          options={employmentTypes.map((value) => ({ value, label: value }))}
        />
        <TextField
          name="baseHourlyRate"
          label="Base hourly rate"
          required
          inputMode="decimal"
          suffix="NOK"
          value={baseHourlyRate}
          onChange={(event) => setBaseHourlyRate(event.target.value)}
          help="Decimal string, at most four decimals."
        />
        <SelectField
          name="primaryLocationId"
          label="Primary location"
          value={primaryLocationId}
          onChange={(event) => setPrimaryLocationId(event.target.value)}
          options={locationOptions}
          help="Shift assignment matches against this location (fail-closed)."
        />
        <DateField
          name="activeTo"
          label="Active to"
          value={activeTo}
          onChange={(event) => setActiveTo(event.target.value)}
          help="Optional; must stay after the immutable active-from date."
        />
        <PositionPicker
          positions={positions}
          selectedIds={positionIds}
          onChange={setPositionIds}
          canWrite
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
