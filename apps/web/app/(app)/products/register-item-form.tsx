"use client";

import { Alert, Button, CheckboxField, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the item. Please try again.";

export interface RegisterItemFormProps {
  readonly itemTypes: readonly string[];
  readonly inventoryPolicies: readonly string[];
  /** `DEC-150`: `for_sale` / `for_use`. */
  readonly itemPurposes: readonly string[];
  /** Called after a successful registration, e.g. to close the modal. */
  readonly onSuccess?: () => void;
}

/** `DEC-150`: the derived purpose default — only `finished_good` is for sale. */
function derivePurpose(itemType: string): string {
  return itemType === "finished_good" ? "for_sale" : "for_use";
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** `cleaning_supply` → `Cleaning supply`, for a readable type option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Registers a catalogue item (`registerItem`, 08_UI_UX.md §8.3). The base unit
 * is entered as its code (no unit-picker read model exists yet); the server
 * resolves it and returns a clear error when the code is unknown. Registration
 * is idempotent on code, so a repeat submit is safe.
 */
export function RegisterItemForm({
  itemTypes,
  inventoryPolicies,
  itemPurposes,
  onSuccess,
}: RegisterItemFormProps) {
  const router = useRouter();
  const initialItemType = itemTypes[0] ?? "ingredient";
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState(initialItemType);
  const [purpose, setPurpose] = useState(derivePurpose(initialItemType));
  const [baseUnitCode, setBaseUnitCode] = useState("");
  const [inventoryPolicy, setInventoryPolicy] = useState(inventoryPolicies[0] ?? "stocked");
  const [lotTracked, setLotTracked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/products/items", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          sku,
          name,
          itemType,
          purpose,
          baseUnitCode,
          inventoryPolicy,
          lotTracked,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered ${code}.`);
      setCode("");
      setSku("");
      setName("");
      setBaseUnitCode("");
      setLotTracked(false);
      router.refresh();
      onSuccess?.();
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
        name="code"
        label="Code"
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. FLOUR-WHEAT"
        help="Unique within the organization; registering an existing code reopens it."
      />
      <TextField
        name="sku"
        label="SKU"
        required
        value={sku}
        onChange={(event) => setSku(event.target.value)}
        placeholder="e.g. SKU-0142"
        help="Unique within the organization."
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Wheat flour T65"
      />
      <SelectField
        name="itemType"
        label="Item type"
        required
        value={itemType}
        onChange={(event) => {
          const next = event.target.value;
          setItemType(next);
          setPurpose(derivePurpose(next));
        }}
        options={itemTypes.map((value) => ({ value, label: humanize(value) }))}
      />
      <SelectField
        name="purpose"
        label="Purpose"
        required
        value={purpose}
        onChange={(event) => setPurpose(event.target.value)}
        options={itemPurposes.map((value) => ({ value, label: humanize(value) }))}
        help="For sale = a sellable is fulfilled from it; for use = consumed by production or operations. Defaults from the item type; change it if needed."
      />
      <TextField
        name="baseUnitCode"
        label="Base unit code"
        required
        value={baseUnitCode}
        onChange={(event) => setBaseUnitCode(event.target.value)}
        placeholder="e.g. kg"
        help="The code of an existing unit, e.g. kg, l, unit."
        inputMode="text"
        autoCapitalize="none"
      />
      <SelectField
        name="inventoryPolicy"
        label="Inventory policy"
        required
        value={inventoryPolicy}
        onChange={(event) => setInventoryPolicy(event.target.value)}
        options={inventoryPolicies.map((value) => ({ value, label: humanize(value) }))}
      />
      <CheckboxField
        name="lotTracked"
        label="Lot tracked"
        checked={lotTracked}
        onChange={(event) => setLotTracked(event.target.checked)}
        help="Require a lot number on every stock movement for this item."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register item
        </Button>
      </div>
    </form>
  );
}
