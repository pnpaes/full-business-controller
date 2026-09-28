"use client";

import { Alert, Button, NumberField, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not set the add-on applicability. Please try again.";
const DECIMAL = /^[+-]?\d{1,15}(\.\d{1,4})?$/;

export interface AddonApplicabilityFormProps {
  /** The product shown on this page; it is registered as the add-on. */
  readonly productId: string;
  readonly products: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  readonly currency: string | null;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Declares that the current product may be sold as an add-on to another product
 * (`setAddonApplicability`, `DEC-128`). The current product is the add-on and
 * the chosen product is the base; a product cannot be its own add-on, and the
 * price effect is a decimal (negative for a discount) paired with its currency.
 */
export function AddonApplicabilityForm({
  productId,
  products,
  currency,
}: AddonApplicabilityFormProps) {
  const router = useRouter();
  const [baseProductId, setBaseProductId] = useState(products[0]?.id ?? "");
  const [priceEffect, setPriceEffect] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setPriceError(null);

    if (baseProductId === "") {
      setError("Choose a base product.");
      document.getElementById("field-baseProductId")?.focus();
      return;
    }
    if (priceEffect.trim().length > 0 && !DECIMAL.test(priceEffect.trim())) {
      setPriceError("Enter the price effect as a decimal with at most 4 places.");
      document.getElementById("field-priceEffect")?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/products/sellables/${productId}/addon-applicability`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseProductId,
          ...(priceEffect.trim() === "" ? {} : { priceEffect: priceEffect.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Add-on applicability set.");
      setPriceEffect("");
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
        name="baseProductId"
        label="Base product"
        required
        value={baseProductId}
        onChange={(event) => setBaseProductId(event.target.value)}
        placeholder="Select a base product"
        options={products.map((product) => ({
          value: product.id,
          label: `${product.code} — ${product.name}`,
        }))}
        help="This product may attach to the base product as an add-on."
      />
      <NumberField
        name="priceEffect"
        label="Price effect (optional)"
        value={priceEffect}
        {...(priceError === null ? {} : { error: priceError })}
        onChange={(event) => setPriceEffect(event.target.value)}
        step="0.0001"
        {...(currency === null ? {} : { unit: currency })}
        help="A fixed surcharge, or negative for a discount."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Set applicability
        </Button>
      </div>
    </form>
  );
}
