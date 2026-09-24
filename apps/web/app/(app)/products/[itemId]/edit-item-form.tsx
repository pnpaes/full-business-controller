"use client";

import { Alert, Button, CheckboxField, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not update the item. Please try again.";

export interface EditItemFormProps {
  readonly itemId: string;
  readonly name: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
  readonly inventoryPolicies: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** `non_stock` → `Non stock`, for a readable policy option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Edits the mutable fields of an item (`updateItem`, 08_UI_UX.md §8.3): name,
 * inventory policy and lot tracking. Code, SKU, base unit and item type are
 * immutable — they anchor history — so they are shown read-only on the page and
 * absent here. The form is pre-filled from the current values; a failed save
 * keeps the entered values and returns focus to the first invalid field.
 */
export function EditItemForm({
  itemId,
  name: initialName,
  inventoryPolicy: initialPolicy,
  lotTracked: initialLotTracked,
  inventoryPolicies,
}: EditItemFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [inventoryPolicy, setInventoryPolicy] = useState(initialPolicy);
  const [lotTracked, setLotTracked] = useState(initialLotTracked);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldError(null);

    if (name.trim().length === 0) {
      setFieldError("Enter a name.");
      document.getElementById("field-name")?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/products/items/${itemId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, inventoryPolicy, lotTracked }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Item updated.");
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
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}

      <TextField
        name="name"
        label="Name"
        required
        value={name}
        {...(fieldError === null ? {} : { error: fieldError })}
        onChange={(event) => setName(event.target.value)}
        help="The display name; changing it does not affect history."
      />
      <SelectField
        name="inventoryPolicy"
        label="Inventory policy"
        required
        value={inventoryPolicy}
        onChange={(event) => setInventoryPolicy(event.target.value)}
        options={inventoryPolicies.map((value) => ({ value, label: humanize(value) }))}
        help="Governs future stock movements only."
      />
      <CheckboxField
        name="lotTracked"
        label="Lot tracked"
        checked={lotTracked}
        onChange={(event) => setLotTracked(event.target.checked)}
        help="Require a lot number on future movements for this item."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
