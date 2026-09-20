"use client";

import { Alert, Button, SectionCard, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { SelectField } from "../form-controls";

const FALLBACK_ERROR = "Could not request the transfer. Please try again.";

export interface TransferLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface TransferAreaOption {
  readonly id: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
}

export interface NewTransferFormProps {
  readonly locations: readonly TransferLocationOption[];
  readonly areas: readonly TransferAreaOption[];
}

interface ErrorBody {
  readonly error?: string;
}

interface CreateResult {
  readonly transferId?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Requests a transfer (08_UI_UX.md §8.5, §8.6): the two physical endpoints are
 * chosen here; the items are chosen at dispatch. The actor and organization are
 * the server's. On success the list refreshes.
 */
export function NewTransferForm({ locations, areas }: NewTransferFormProps) {
  const router = useRouter();
  const [fromLocationId, setFromLocationId] = useState(locations[0]?.id ?? "");
  const [fromStorageAreaId, setFromStorageAreaId] = useState("");
  const [toLocationId, setToLocationId] = useState(locations[1]?.id ?? locations[0]?.id ?? "");
  const [toStorageAreaId, setToStorageAreaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromAreas = useMemo(
    () => areas.filter((area) => area.locationId === fromLocationId),
    [areas, fromLocationId],
  );
  const toAreas = useMemo(
    () => areas.filter((area) => area.locationId === toLocationId),
    [areas, toLocationId],
  );

  if (locations.length < 2) {
    return (
      <SectionCard title="Request a transfer" meta="two physical locations">
        <Alert tone="info">
          A transfer needs at least two operating locations. Seed the demo data or register another
          location first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/transfers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromLocationId,
          fromStorageAreaId,
          toLocationId,
          toStorageAreaId,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as CreateResult;
      setSuccess(
        body.transferId === undefined
          ? "Transfer requested."
          : `Transfer requested. Open it from the list to approve and dispatch it.`,
      );
      setFromStorageAreaId("");
      setToStorageAreaId("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: `${location.code} · ${location.name}`,
  }));

  return (
    <SectionCard title="Request a transfer" meta="two physical locations">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="fromLocationId"
          label="From location"
          required
          value={fromLocationId}
          onChange={(event) => {
            setFromLocationId(event.target.value);
            setFromStorageAreaId("");
          }}
          options={locationOptions}
        />
        <SelectField
          name="fromStorageAreaId"
          label="From storage area"
          required
          placeholder={
            fromAreas.length === 0 ? "No storage area at this location" : "Select a storage area"
          }
          value={fromStorageAreaId}
          onChange={(event) => setFromStorageAreaId(event.target.value)}
          options={fromAreas.map((area) => ({
            value: area.id,
            label: `${area.code} · ${area.name}`,
          }))}
          {...(fromAreas.length === 0 ? { help: "Register a storage area first." } : {})}
        />

        <SelectField
          name="toLocationId"
          label="To location"
          required
          value={toLocationId}
          onChange={(event) => {
            setToLocationId(event.target.value);
            setToStorageAreaId("");
          }}
          options={locationOptions}
        />
        <SelectField
          name="toStorageAreaId"
          label="To storage area"
          required
          placeholder={
            toAreas.length === 0 ? "No storage area at this location" : "Select a storage area"
          }
          value={toStorageAreaId}
          onChange={(event) => setToStorageAreaId(event.target.value)}
          options={toAreas.map((area) => ({
            value: area.id,
            label: `${area.code} · ${area.name}`,
          }))}
          {...(toAreas.length === 0 ? { help: "Register a storage area first." } : {})}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Request transfer
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
