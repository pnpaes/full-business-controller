"use client";

import { Alert, Button, SectionCard, TextField, spacing, typography } from "@aquarela/ui";
import { formatDecimal, parseDecimal } from "@aquarela/domain/decimal";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { CheckboxField, SelectField } from "./form-controls";

const FALLBACK_ERROR = "Could not post the movement. Please try again.";

export interface MovementItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitCode: string | null;
}

export interface MovementLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

export interface MovementAreaOption {
  readonly id: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
}

export interface PostMovementFormProps {
  readonly items: readonly MovementItemOption[];
  readonly locations: readonly MovementLocationOption[];
  readonly areas: readonly MovementAreaOption[];
}

interface ErrorBody {
  readonly error?: string;
}

interface PostResult {
  readonly quantityOnHand?: string;
  readonly valueOnHand?: string;
  readonly replayed?: boolean;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Manual movement form (08_UI_UX.md §8.3, §8.5, §8.6): adjustment or waste, with
 * the item's base unit paired to the quantity and an explicit Post action. The
 * actor and organization are the server's, never this form's. On a server
 * rejection the entered values are preserved and the message shown; on success
 * the balances are refreshed.
 */
export function PostMovementForm({ items, locations, areas }: PostMovementFormProps) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [storageAreaId, setStorageAreaId] = useState("");
  const [movementType, setMovementType] = useState<"count_adjustment" | "correction" | "waste">(
    "count_adjustment",
  );
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [allowNegativeOverride, setAllowNegativeOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isWaste = movementType === "waste";
  const effectiveDirection = isWaste ? "remove" : direction;
  const selectedItem = items.find((item) => item.id === itemId);
  const quantityUnitCode = selectedItem?.unitCode ?? null;
  const visibleAreas = useMemo(
    () => areas.filter((area) => area.locationId === locationId),
    [areas, locationId],
  );

  if (items.length === 0 || locations.length === 0) {
    return (
      <SectionCard title="Post a movement" meta="adjustment or waste">
        <Alert tone="info">
          Posting needs at least one stocked item and one location. Seed the demo data or add master
          data first.
        </Alert>
      </SectionCard>
    );
  }

  function onLocationChange(next: string): void {
    setLocationId(next);
    setStorageAreaId("");
  }

  function buildQuantityDelta(): string | null {
    try {
      const magnitude = parseDecimal(quantity.trim(), QUANTITY_SCALE);
      if (magnitude <= 0n) {
        return null;
      }
      const signed = effectiveDirection === "remove" ? -magnitude : magnitude;
      return formatDecimal(signed, QUANTITY_SCALE);
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const quantityDelta = buildQuantityDelta();
    if (quantityDelta === null) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (effectiveDirection === "add" && unitCost.trim().length === 0) {
      setError("Adding stock needs a unit cost.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/inventory/movements", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          locationId,
          storageAreaId,
          movementType,
          quantityDelta,
          ...(unitCost.trim().length === 0 ? {} : { unitCost: unitCost.trim() }),
          reasonCode,
          allowNegativeOverride,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as PostResult;
      setSuccess(
        `Posted. On hand is now ${body.quantityOnHand ?? "—"}${selectedItem?.unitCode ? ` ${selectedItem.unitCode}` : ""}.`,
      );
      setQuantity("");
      setReasonCode("");
      setUnitCost("");
      setAllowNegativeOverride(false);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const itemOptions = items.map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
  }));
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: `${location.code} · ${location.name}`,
  }));
  const areaOptions = visibleAreas.map((area) => ({
    value: area.id,
    label: `${area.code} · ${area.name}`,
  }));

  return (
    <SectionCard title="Post a movement" meta="adjustment or waste">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="movementType"
          label="Movement"
          required
          value={movementType}
          onChange={(event) =>
            setMovementType(event.target.value as "count_adjustment" | "correction" | "waste")
          }
          options={[
            { value: "count_adjustment", label: "Adjustment — count correction" },
            { value: "correction", label: "Adjustment — general correction" },
            { value: "waste", label: "Waste" },
          ]}
        />

        <SelectField
          name="itemId"
          label="Item"
          required
          placeholder="Select an item"
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          options={itemOptions}
          help={
            selectedItem?.unitCode === null || selectedItem === undefined
              ? "Quantity is recorded in the item's base unit."
              : `Quantity is recorded in the item's base unit (${selectedItem.unitCode}).`
          }
        />

        <SelectField
          name="locationId"
          label="Location"
          required
          value={locationId}
          onChange={(event) => onLocationChange(event.target.value)}
          options={locationOptions}
        />

        <SelectField
          name="storageAreaId"
          label="Storage area"
          required
          placeholder={
            visibleAreas.length === 0 ? "No storage area at this location" : "Select a storage area"
          }
          value={storageAreaId}
          onChange={(event) => setStorageAreaId(event.target.value)}
          options={areaOptions}
          {...(visibleAreas.length === 0
            ? { help: "Register a storage area for this location first." }
            : {})}
        />

        {isWaste ? (
          <SelectField
            name="direction"
            label="Direction"
            value="remove"
            disabled
            onChange={() => undefined}
            options={[{ value: "remove", label: "Remove from stock (waste)" }]}
          />
        ) : (
          <SelectField
            name="direction"
            label="Direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as "add" | "remove")}
            options={[
              { value: "remove", label: "Remove from stock" },
              { value: "add", label: "Add to stock" },
            ]}
          />
        )}

        <TextField
          name="quantity"
          label="Quantity"
          required
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          {...(quantityUnitCode === null ? {} : { suffix: quantityUnitCode })}
          placeholder="0.000"
          help="Enter a positive amount; the direction above sets the sign."
        />

        {effectiveDirection === "add" ? (
          <TextField
            name="unitCost"
            label="Unit cost"
            required
            inputMode="decimal"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            placeholder="0.0000"
            help="Required when adding stock; the moving average is re-derived from it."
          />
        ) : null}

        <TextField
          name="reasonCode"
          label="Reason"
          required
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          placeholder="e.g. spoiled, miscount"
          help="Stored on the ledger row and the audit trail."
        />

        <CheckboxField
          name="allowNegativeOverride"
          label="Allow this movement to drive stock negative"
          checked={allowNegativeOverride}
          onChange={(event) => setAllowNegativeOverride(event.target.checked)}
          help="Restricted: requires an owner or manager role, and a reason. The server rejects it otherwise."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Post movement
          </Button>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: typography.fontSize.xs,
            color: "inherit",
            opacity: 0.8,
          }}
        >
          Posting is explicit and server-confirmed; the ledger is append-only, so a mistake is
          corrected by a reversal, never by editing the row.
        </p>
      </form>
    </SectionCard>
  );
}
