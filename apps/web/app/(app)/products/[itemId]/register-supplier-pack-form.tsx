"use client";

import {
  Alert,
  Button,
  CheckboxField,
  NumberField,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the supplier pack. Please try again.";

export interface SupplierPackSupplierOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegisterSupplierPackFormProps {
  readonly itemId: string;
  readonly baseUnitCode: string;
  readonly suppliers: readonly SupplierPackSupplierOption[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers a supplier pack for one item (`registerSupplierItem`, PROC-001):
 * 1 pack unit = factor × base unit. The supplier is chosen from the
 * organization's suppliers; the pack unit is entered as its code (no
 * unit-picker read model exists yet). Optional minimum order quantity and lead
 * time default to empty.
 */
export function RegisterSupplierPackForm({
  itemId,
  baseUnitCode,
  suppliers,
}: RegisterSupplierPackFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [supplierSku, setSupplierSku] = useState("");
  const [packUnitCode, setPackUnitCode] = useState("");
  const [factor, setFactor] = useState("");
  const [minOrderQty, setMinOrderQty] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [preferred, setPreferred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (suppliers.length === 0) {
    return (
      <Alert tone="info">
        Registering a supplier pack needs a supplier. No supplier is registered for the organization
        yet.
      </Alert>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/products/items/${itemId}/supplier-items`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          supplierSku,
          packUnitCode,
          packToBaseUnitFactor: factor,
          ...(minOrderQty === "" ? {} : { minOrderQty }),
          ...(leadTimeDays === "" ? {} : { leadTimeDays: Number(leadTimeDays) }),
          preferred,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered pack ${supplierSku}.`);
      setSupplierSku("");
      setPackUnitCode("");
      setFactor("");
      setMinOrderQty("");
      setLeadTimeDays("");
      setPreferred(false);
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

      <SelectField
        name="supplierId"
        label="Supplier"
        required
        value={supplierId}
        onChange={(event) => setSupplierId(event.target.value)}
        options={suppliers.map((supplier) => ({
          value: supplier.id,
          label: `${supplier.code} · ${supplier.name}`,
        }))}
      />
      <TextField
        name="supplierSku"
        label="Supplier SKU"
        required
        value={supplierSku}
        onChange={(event) => setSupplierSku(event.target.value)}
        placeholder="e.g. 40123"
        help="The supplier's own product code; unique per supplier."
      />
      <TextField
        name="packUnitCode"
        label="Pack unit code"
        required
        value={packUnitCode}
        onChange={(event) => setPackUnitCode(event.target.value)}
        placeholder="e.g. bag"
        help="The code of an existing unit, e.g. bag, box, kg."
        autoCapitalize="none"
      />
      <NumberField
        name="packToBaseUnitFactor"
        label="Pack factor"
        unit={baseUnitCode}
        required
        value={factor}
        onChange={(event) => setFactor(event.target.value)}
        placeholder="e.g. 25"
        inputMode="decimal"
        help={`1 pack = this many ${baseUnitCode}.`}
      />
      <NumberField
        name="minOrderQty"
        label="Minimum order quantity"
        unit="packs"
        value={minOrderQty}
        onChange={(event) => setMinOrderQty(event.target.value)}
        placeholder="Optional"
        inputMode="decimal"
      />
      <NumberField
        name="leadTimeDays"
        label="Lead time"
        unit="days"
        step={1}
        min={0}
        value={leadTimeDays}
        onChange={(event) => setLeadTimeDays(event.target.value)}
        placeholder="Optional"
        inputMode="numeric"
      />
      <CheckboxField
        name="preferred"
        label="Preferred supplier pack"
        checked={preferred}
        onChange={(event) => setPreferred(event.target.checked)}
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register supplier pack
        </Button>
      </div>
    </form>
  );
}
