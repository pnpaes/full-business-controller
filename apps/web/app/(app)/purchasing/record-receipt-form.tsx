"use client";

import {
  Alert,
  Button,
  DateField,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { formatDecimal, parseDecimal } from "@aquarela/domain/decimal";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

/**
 * Mobile-first goods-receipt form (08_UI_UX.md §8.3 receiving: supplier, pack,
 * quantity, price, lot and expiry; §8.5 forms; §8.6 mobile operational: ≥44px
 * targets, numeric keyboards, unit-paired quantities, a default location).
 *
 * The actor, organization and cost computation are the server's. The form only
 * shapes the request and shows what came back: on success the `§8.3` variance
 * warnings the server computed (accepted/received shortfall and landed-cost
 * moves) are surfaced, not swallowed.
 */

const FALLBACK_ERROR = "Could not record the receipt. Please try again.";

type TaxBasis = "exclusive" | "inclusive";

export interface ReceiptLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ReceiptSupplierOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly currency: string;
}

export interface ReceiptPackOption {
  readonly id: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly packUnitId: string;
  readonly packUnitCode: string;
  readonly packToBaseUnitFactor: string;
}

export interface RecordReceiptFormProps {
  readonly locations: readonly ReceiptLocationOption[];
  readonly suppliers: readonly ReceiptSupplierOption[];
  readonly packs: readonly ReceiptPackOption[];
  /** The location of the most recent receipt, or the first available (§8.6). */
  readonly defaultLocationId: string;
  readonly currency: string | null;
  /** `yyyy-mm-dd`. */
  readonly today: string;
}

interface LineState {
  readonly key: number;
  readonly supplierItemId: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly price: string;
  readonly lotNumber: string;
  readonly expiryDate: string;
  readonly recoverableTax: string;
}

interface ReceiptWarning {
  readonly lineIndex: number;
  readonly kind: "price" | "quantity";
  readonly severity: "warning" | "info";
  readonly message: string;
}

interface RecordResult {
  readonly goodsReceiptId: string;
  readonly warnings: readonly ReceiptWarning[];
}

interface ErrorBody {
  readonly error?: string;
}

let lineKeySeq = 1;

function newLine(): LineState {
  lineKeySeq += 1;
  return {
    key: lineKeySeq,
    supplierItemId: "",
    receivedPackQty: "",
    acceptedPackQty: "",
    price: "",
    lotNumber: "",
    expiryDate: "",
    recoverableTax: "",
  };
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** Parses a user decimal; `null` when it is not a finite non-negative value. */
function parseQuantity(value: string): bigint | null {
  try {
    const parsed = parseDecimal(value.trim(), QUANTITY_SCALE);
    return parsed < 0n ? null : parsed;
  } catch {
    return null;
  }
}

export function RecordReceiptForm({
  locations,
  suppliers,
  packs,
  defaultLocationId,
  currency,
  today,
}: RecordReceiptFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [receivedOn, setReceivedOn] = useState(today);
  const [deliveryRef, setDeliveryRef] = useState("");
  const [taxBasis, setTaxBasis] = useState<TaxBasis>("exclusive");
  const [lines, setLines] = useState<LineState[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordResult | null>(null);
  const [busy, setBusy] = useState(false);

  const packOptions = useMemo(
    () => packs.filter((pack) => pack.supplierId === supplierId),
    [packs, supplierId],
  );
  const packById = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  function updateLine(key: number, patch: Partial<Omit<LineState, "key">>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function onSupplierChange(next: string): void {
    setSupplierId(next);
    // A pack belongs to exactly one supplier, so clear any pack that no longer fits.
    setLines((current) => current.map((line) => ({ ...line, supplierItemId: "" })));
    setResult(null);
  }

  /** Client-visible quantity variance: accepted below received (§8.3). */
  const quantityWarnings = lines.flatMap((line, index) => {
    const received = parseQuantity(line.receivedPackQty);
    const accepted = parseQuantity(line.acceptedPackQty);
    if (received === null || accepted === null || received === 0n || accepted >= received) {
      return [];
    }
    const pack = packById.get(line.supplierItemId);
    const unit = pack?.packUnitCode ?? "packs";
    const missing = formatDecimal(received - accepted, QUANTITY_SCALE);
    return [
      `Line ${index + 1}: ${Number(missing)} ${unit} of ${Number(
        formatDecimal(received, QUANTITY_SCALE),
      )} not accepted.`,
    ];
  });

  function buildBody(): Record<string, unknown> | string {
    if (supplierId === "") {
      return "Choose a supplier.";
    }
    if (locationId === "") {
      return "Choose a location.";
    }
    if (receivedOn === "") {
      return "Enter the received date.";
    }
    const built: Record<string, unknown>[] = [];
    for (const [index, line] of lines.entries()) {
      const pack = packById.get(line.supplierItemId);
      if (pack === undefined) {
        return `Line ${index + 1}: choose a pack.`;
      }
      const received = parseQuantity(line.receivedPackQty);
      const accepted = parseQuantity(line.acceptedPackQty);
      if (received === null || accepted === null) {
        return `Line ${index + 1}: enter valid received and accepted quantities.`;
      }
      if (received === 0n) {
        return `Line ${index + 1}: received quantity must be greater than zero.`;
      }
      if (accepted === 0n) {
        return `Line ${index + 1}: accepted quantity must be greater than zero.`;
      }
      if (accepted > received) {
        return `Line ${index + 1}: accepted quantity cannot exceed received.`;
      }
      if (line.price.trim().length === 0) {
        return `Line ${index + 1}: enter a pack price.`;
      }
      if (taxBasis === "inclusive" && line.recoverableTax.trim().length === 0) {
        return `Line ${index + 1}: an inclusive price needs its recoverable tax.`;
      }
      built.push({
        supplierItemId: pack.id,
        itemId: pack.itemId,
        unitId: pack.packUnitId,
        packToBaseFactor: pack.packToBaseUnitFactor,
        receivedPackQty: formatDecimal(received, QUANTITY_SCALE),
        acceptedPackQty: formatDecimal(accepted, QUANTITY_SCALE),
        rejectedPackQty: formatDecimal(received - accepted, QUANTITY_SCALE),
        price: line.price.trim(),
        taxBasis,
        ...(taxBasis === "inclusive" ? { recoverableTax: line.recoverableTax.trim() } : {}),
        ...(line.lotNumber.trim().length === 0 ? {} : { lotNumber: line.lotNumber.trim() }),
        ...(line.expiryDate.length === 0 ? {} : { expiryDate: line.expiryDate }),
      });
    }
    return {
      locationId,
      supplierId,
      receivedAt: `${receivedOn}T12:00:00.000Z`,
      ...(deliveryRef.trim().length === 0 ? {} : { deliveryRef: deliveryRef.trim() }),
      lines: built,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);

    const body = buildBody();
    if (typeof body === "string") {
      setError(body);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/receiving/receipts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const recorded = (await response.json()) as RecordResult;
      setResult(recorded);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const supplierOptions = suppliers.map((supplier) => ({
    value: supplier.id,
    label: `${supplier.code} · ${supplier.name}`,
  }));
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: `${location.code} · ${location.name}`,
  }));
  const packSelectOptions = packOptions.map((pack) => ({
    value: pack.id,
    label: `${pack.itemCode} · ${pack.itemName} — ${pack.packUnitCode}`,
  }));

  return (
    <SectionCard
      title="Record a goods receipt"
      meta="supplier pack · quantity · price · lot · expiry"
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {result !== null ? (
          <Alert tone="success" title="Receipt recorded">
            Recorded {result.goodsReceiptId}.{" "}
            <Link href={`/purchasing/receipts/${result.goodsReceiptId}`}>Open the receipt</Link>.
          </Alert>
        ) : null}
        {result !== null && result.warnings.length > 0 ? (
          <Alert tone="warning" title="Variance warnings">
            <ul style={{ margin: 0, paddingLeft: spacing[5] }}>
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <SelectField
          name="supplierId"
          label="Supplier"
          required
          value={supplierId}
          onChange={(event) => onSupplierChange(event.target.value)}
          options={supplierOptions}
          help="Only known suppliers can append effective-dated price history."
        />
        <SelectField
          name="locationId"
          label="Location"
          required
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={locationOptions}
          help="Defaults to the location of the most recent receipt."
        />
        <DateField
          name="receivedOn"
          label="Received on"
          required
          value={receivedOn}
          onChange={(event) => setReceivedOn(event.target.value)}
        />
        <TextField
          name="deliveryRef"
          label="Delivery reference"
          value={deliveryRef}
          onChange={(event) => setDeliveryRef(event.target.value)}
          placeholder="e.g. packing slip no."
          help="Optional; helps reconcile the receipt against the delivery note."
        />
        <SelectField
          name="taxBasis"
          label="Price tax basis"
          required
          value={taxBasis}
          onChange={(event) => setTaxBasis(event.target.value as TaxBasis)}
          options={[
            { value: "exclusive", label: "Exclusive — tax added on top" },
            { value: "inclusive", label: "Inclusive — tax contained in the price" },
          ]}
        />

        {quantityWarnings.length > 0 ? (
          <Alert tone="warning" title="Quantity variance">
            <ul style={{ margin: 0, paddingLeft: spacing[5] }}>
              {quantityWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
          {lines.map((line, index) => {
            const pack = packById.get(line.supplierItemId);
            const unit = pack?.packUnitCode ?? "pack";
            return (
              <fieldset
                key={line.key}
                style={{
                  border: `1px solid ${color.border.subtle}`,
                  borderRadius: 8,
                  padding: spacing[4],
                }}
              >
                <legend
                  style={{
                    fontSize: typography.fontSize.sm,
                    fontWeight: typography.fontWeight.medium,
                    color: color.text.secondary,
                  }}
                >
                  Line {index + 1}
                </legend>
                <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
                  <SelectField
                    name={`supplierItemId-${line.key}`}
                    label="Pack"
                    required
                    placeholder={
                      packSelectOptions.length === 0
                        ? "No packs for this supplier"
                        : "Select a pack"
                    }
                    value={line.supplierItemId}
                    onChange={(event) =>
                      updateLine(line.key, { supplierItemId: event.target.value })
                    }
                    options={packSelectOptions}
                    {...(packSelectOptions.length === 0
                      ? { help: "Add a supplier item (pack) for this supplier first." }
                      : {})}
                  />
                  <NumberField
                    name={`receivedPackQty-${line.key}`}
                    label="Received"
                    required
                    unit={unit}
                    min={0}
                    value={line.receivedPackQty}
                    onChange={(event) =>
                      updateLine(line.key, { receivedPackQty: event.target.value })
                    }
                    placeholder="0.000"
                  />
                  <NumberField
                    name={`acceptedPackQty-${line.key}`}
                    label="Accepted"
                    required
                    unit={unit}
                    min={0}
                    value={line.acceptedPackQty}
                    onChange={(event) =>
                      updateLine(line.key, { acceptedPackQty: event.target.value })
                    }
                    placeholder="0.000"
                    help="A shortfall against received raises a variance warning."
                  />
                  <NumberField
                    name={`price-${line.key}`}
                    label="Pack price"
                    required
                    min={0}
                    value={line.price}
                    onChange={(event) => updateLine(line.key, { price: event.target.value })}
                    placeholder="0.0000"
                    {...(currency === null ? {} : { unit: currency })}
                  />
                  {taxBasis === "inclusive" ? (
                    <NumberField
                      name={`recoverableTax-${line.key}`}
                      label="Recoverable tax in the price"
                      required
                      min={0}
                      value={line.recoverableTax}
                      onChange={(event) =>
                        updateLine(line.key, { recoverableTax: event.target.value })
                      }
                      placeholder="0.0000"
                      help="Subtracted from an inclusive price to reach the net pack price."
                    />
                  ) : null}
                  <TextField
                    name={`lotNumber-${line.key}`}
                    label="Lot number"
                    value={line.lotNumber}
                    onChange={(event) => updateLine(line.key, { lotNumber: event.target.value })}
                    placeholder="optional"
                  />
                  <DateField
                    name={`expiryDate-${line.key}`}
                    label="Expiry date"
                    value={line.expiryDate}
                    onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                  />
                  {lines.length > 1 ? (
                    <div>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          setLines((current) => current.filter((row) => row.key !== line.key))
                        }
                      >
                        Remove line {index + 1}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: spacing[3], flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            Add another line
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Record receipt
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
          Recording is explicit and server-confirmed: the receipt, its lines, the effective-dated
          price history and the audit fact commit together. The ledger is append-only, so a mistake
          is corrected by a reversal, never by editing a row.
        </p>
      </form>
    </SectionCard>
  );
}
