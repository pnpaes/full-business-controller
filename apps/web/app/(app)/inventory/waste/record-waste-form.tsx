"use client";

import {
  Alert,
  Button,
  SectionCard,
  SelectField,
  NumberField,
  TextField,
  TextareaField,
  spacing,
  typography,
} from "@aquarela/ui";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import { parseDecimal } from "@aquarela/domain/decimal";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not record the waste. Please try again.";

export interface WasteItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitCode: string | null;
}

export interface WasteLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface WasteAreaOption {
  readonly id: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
}

export interface WasteStageOption {
  readonly value: string;
  readonly label: string;
}

export interface RecordWasteFormProps {
  readonly items: readonly WasteItemOption[];
  readonly locations: readonly WasteLocationOption[];
  readonly areas: readonly WasteAreaOption[];
  readonly stages: readonly WasteStageOption[];
}

interface ErrorBody {
  readonly error?: string;
}

interface RecordResult {
  readonly quantity?: string;
  readonly value?: string;
  readonly currency?: string | null;
  readonly replayed?: boolean;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Fast waste entry (08_UI_UX.md §8.3/§8.6): item search, quantity with the
 * item's unit, the DEC-018 stage, a reason and an optional note, with large
 * targets and a decimal keyboard. The actor and organization are the server's,
 * never this form's. On success the entry fields clear for rapid repeat entry
 * and the list refreshes; the calculated value is shown from the server.
 */
export function RecordWasteForm({ items, locations, areas, stages }: RecordWasteFormProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [storageAreaId, setStorageAreaId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stage, setStage] = useState(stages[0]?.value ?? "");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleAreas = useMemo(
    () => areas.filter((area) => area.locationId === locationId),
    [areas, locationId],
  );
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) {
      return items;
    }
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
    );
  }, [items, search]);
  const selectedItem = items.find((item) => item.id === itemId);

  if (items.length === 0 || locations.length === 0 || stages.length === 0) {
    return (
      <SectionCard title="Record waste" meta="fast entry">
        <Alert tone="info">
          Recording waste needs at least one stocked item and one location. Seed the demo data or
          add master data first.
        </Alert>
      </SectionCard>
    );
  }

  function onLocationChange(next: string): void {
    setLocationId(next);
    setStorageAreaId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    let magnitude: bigint;
    try {
      magnitude = parseDecimal(quantity.trim(), QUANTITY_SCALE);
    } catch {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (magnitude <= 0n) {
      setError("Enter a quantity greater than zero.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/waste", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          locationId,
          storageAreaId,
          quantity: quantity.trim(),
          stage,
          reasonCode,
          ...(note.trim().length === 0 ? {} : { correctiveAction: note.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as RecordResult;
      const valueLabel = `${body.value ?? "—"}${body.currency ? ` ${body.currency}` : ""}`;
      setSuccess(
        `Recorded ${body.quantity ?? quantity.trim()}${
          selectedItem?.unitCode ? ` ${selectedItem.unitCode}` : ""
        } · value ${valueLabel}${body.replayed ? " (already recorded)" : ""}.`,
      );
      setQuantity("");
      setReasonCode("");
      setNote("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const itemOptions = filteredItems.map((item) => ({
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
    <SectionCard title="Record waste" meta="fast entry">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextField
          name="itemSearch"
          label="Search items"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Type a code or name"
          help="Narrows the item list below. Leave empty to show every stocked item."
        />

        <SelectField
          name="itemId"
          label="Item"
          required
          placeholder={itemOptions.length === 0 ? "No items match the search" : "Select an item"}
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          options={itemOptions}
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

        <NumberField
          name="quantity"
          label="Quantity"
          required
          min="0"
          step="0.001"
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          {...(selectedItem?.unitCode ? { unit: selectedItem.unitCode } : {})}
          placeholder="0.000"
          help="Enter the wasted amount in the item's base unit."
        />

        <SelectField
          name="stage"
          label="Stage"
          required
          value={stage}
          onChange={(event) => setStage(event.target.value)}
          options={stages}
          help="Where the waste happened. The wording is neutral and blame-free (DEC-018)."
        />

        <TextField
          name="reasonCode"
          label="Reason"
          required
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          placeholder="e.g. expired, dropped"
          help="Stored as the event's reason and on the ledger movement."
        />

        <TextareaField
          name="correctiveAction"
          label="Note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          help="Optional context for follow-up. Stored on the event as the corrective action."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record waste
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
          Recording posts a negative waste movement to the append-only ledger at the locked moving
          weighted average (DEC-008); a mistake is corrected by a reversal, never by editing a row.
        </p>
      </form>
    </SectionCard>
  );
}
