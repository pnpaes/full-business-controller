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

import { PositionPicker } from "./position-picker";
import type { PositionOption } from "./position-picker";

const FALLBACK_ERROR = "Could not register the employee. Please try again.";

export interface EmployeeLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** One of the organization's fixed roles (`DEC-151`). */
export interface EmployeeRoleOption {
  readonly code: string;
  readonly name: string;
}

export interface RegisterEmployeeFormProps {
  /** Employment types from the application vocabulary (`EMPLOYMENT_TYPES`). */
  readonly employmentTypes: readonly string[];
  /** Locations the caller may assign as primary; already filtered to scope. */
  readonly locations: readonly EmployeeLocationOption[];
  /** The organization's roles (`DEC-151`) — the employee's access level. */
  readonly roles: readonly EmployeeRoleOption[];
  /** The position catalogue the employee may be granted from (`DEC-151`). */
  readonly positions: readonly PositionOption[];
  /** True when the caller holds `WORKFORCE_EMPLOYEE_WRITE_ROLES`. */
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
 * Registers one employee (`WF-007`, `DEC-087`) through
 * `POST /api/v1/workforce/employees`. The actor and organization are the
 * server's. `baseHourlyRate` is sent as a decimal **string** (the API rejects a
 * JSON number — money is never a float). A location-scoped caller may only
 * register an employee whose primary location is in their scope (fail-closed).
 */
export function RegisterEmployeeForm({
  employmentTypes,
  locations,
  roles,
  positions,
  canWrite,
}: RegisterEmployeeFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [positionIds, setPositionIds] = useState<readonly string[]>([]);
  const [employmentType, setEmploymentType] = useState(employmentTypes[0] ?? "");
  const [baseHourlyRate, setBaseHourlyRate] = useState("");
  const [primaryLocationId, setPrimaryLocationId] = useState(
    locations.length === 1 ? locations[0]!.id : "",
  );
  const [activeFrom, setActiveFrom] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canWrite) {
    return (
      <SectionCard title="Register an employee" meta="owner / general manager / admin / finance">
        <Alert tone="info">
          Registering an employee needs an employee-write role (owner, general manager, location
          manager, finance or admin). You can still browse the register.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (name.trim().length === 0 || roleCode.trim().length === 0) {
      setError("Name and role are required.");
      return;
    }
    if (!/^\d+(?:\.\d{1,4})?$/.test(baseHourlyRate.trim())) {
      setError("Hourly rate must be a decimal amount with at most four decimals (e.g. 185.50).");
      return;
    }
    if (activeFrom.trim().length === 0) {
      setError("Choose the active-from date.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workforce/employees", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          roleCode: roleCode.trim(),
          employmentType,
          baseHourlyRate: baseHourlyRate.trim(),
          primaryLocationId: primaryLocationId.length === 0 ? null : primaryLocationId,
          activeFrom: activeFrom.trim(),
          positionIds,
          ...(activeTo.trim().length === 0 ? {} : { activeTo: activeTo.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Employee registered.");
      setName("");
      setRoleCode("");
      setPositionIds([]);
      setBaseHourlyRate("");
      setActiveFrom("");
      setActiveTo("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register an employee" meta="retired, never deleted (03.10)">
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
          placeholder="Select a role"
          help="The employee's access level (DEC-151): one of the organization's fixed roles, not free text."
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
          placeholder="185.50"
          help="Decimal string, at most four decimals — the payroll report prices hours at this rate."
        />
        <SelectField
          name="primaryLocationId"
          label="Primary location"
          value={primaryLocationId}
          onChange={(event) => setPrimaryLocationId(event.target.value)}
          options={[
            { value: "", label: "None" },
            ...locations.map((location) => ({
              value: location.id,
              label: `${location.code} · ${location.name}`,
            })),
          ]}
          help="Required for shift assignment: an employee can only be assigned to shifts at their primary location (fail-closed)."
        />
        <DateField
          name="activeFrom"
          label="Active from"
          required
          value={activeFrom}
          onChange={(event) => setActiveFrom(event.target.value)}
        />
        <DateField
          name="activeTo"
          label="Active to"
          value={activeTo}
          onChange={(event) => setActiveTo(event.target.value)}
          help="Optional; must be after the active-from date."
        />
        <PositionPicker
          positions={positions}
          selectedIds={positionIds}
          onChange={setPositionIds}
          canWrite={canWrite}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register employee
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
