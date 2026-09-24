"use client";

import {
  Alert,
  Button,
  CheckboxField,
  DateField,
  SectionCard,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not amend the equipment. Please try again.";

export interface AmendEquipmentFormProps {
  readonly equipmentId: string;
  readonly name: string;
  readonly kind: string;
  readonly serialNo: string | null;
  readonly installedAt: string | null;
  readonly warrantyUntil: string | null;
  readonly active: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Amends one equipment row (`HMS-006`, `DEC-092`, `DEC-097`) through the
 * existing `PATCH /api/v1/hms/equipment/[id]` route. `code` (the register key)
 * and the location are immutable after creation, so neither is offered. The
 * body sends only the changed fields; an empty optional field clears it.
 */
export function AmendEquipmentForm({
  equipmentId,
  name: initialName,
  kind: initialKind,
  serialNo: initialSerialNo,
  installedAt: initialInstalledAt,
  warrantyUntil: initialWarrantyUntil,
  active: initialActive,
}: AmendEquipmentFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState(initialKind);
  const [serialNo, setSerialNo] = useState(initialSerialNo ?? "");
  const [installedAt, setInstalledAt] = useState(initialInstalledAt ?? "");
  const [warrantyUntil, setWarrantyUntil] = useState(initialWarrantyUntil ?? "");
  const [active, setActive] = useState(initialActive);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (name.trim().length === 0 || kind.trim().length === 0) {
      setError("Name and kind are required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/equipment/${equipmentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind: kind.trim(),
          serialNo: serialNo.trim().length === 0 ? null : serialNo.trim(),
          installedAt: installedAt.trim().length === 0 ? null : installedAt.trim(),
          warrantyUntil: warrantyUntil.trim().length === 0 ? null : warrantyUntil.trim(),
          active,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Equipment amended. The change is audit-logged.");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Amend equipment" meta="code and location are immutable">
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
        <TextField
          name="kind"
          label="Kind"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          help="Free text (DEC-092 names no vocabulary) — e.g. oven, dishwasher, cold room."
        />
        <TextField
          name="serialNo"
          label="Serial number"
          value={serialNo}
          onChange={(event) => setSerialNo(event.target.value)}
          help="Leave empty to clear it."
        />
        <DateField
          name="installedAt"
          label="Installed at"
          value={installedAt}
          onChange={(event) => setInstalledAt(event.target.value)}
          help="Leave empty to clear it."
        />
        <DateField
          name="warrantyUntil"
          label="Warranty until"
          value={warrantyUntil}
          onChange={(event) => setWarrantyUntil(event.target.value)}
          help="Leave empty to clear it."
        />
        <CheckboxField
          name="active"
          label="Active in the register"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
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
