"use client";

import { Alert, Button, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the variant. Please try again.";

export interface ProductOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegisterVariantFormProps {
  readonly products: readonly ProductOption[];
  readonly items: readonly ItemOption[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers a variant of a chosen product (`registerProductVariant`, `DEC-128`)
 * — the sellable identity (`DEC-030`). The finished-good item is optional on
 * purpose: a made-to-order variant has no stocked item, so leaving it blank is
 * legal. Idempotent on `(product, code)`.
 */
export function RegisterVariantForm({ products, items }: RegisterVariantFormProps) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [finishedGoodItemId, setFinishedGoodItemId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (productId === "") {
      setError("Choose a product first.");
      document.getElementById("field-productId")?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/products/sellables/${productId}/variants`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          sku,
          name,
          ...(size === "" ? {} : { size }),
          ...(finishedGoodItemId === "" ? {} : { finishedGoodItemId }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered variant ${code}.`);
      setCode("");
      setSku("");
      setName("");
      setSize("");
      setFinishedGoodItemId("");
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
        name="productId"
        label="Product"
        required
        value={productId}
        onChange={(event) => setProductId(event.target.value)}
        placeholder="Select a product"
        options={products.map((product) => ({
          value: product.id,
          label: `${product.code} — ${product.name}`,
        }))}
      />
      <TextField
        name="code"
        label="Variant code"
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. SMALL"
        help="Unique within the product; a repeat reopens the existing variant."
      />
      <TextField
        name="sku"
        label="SKU"
        required
        value={sku}
        onChange={(event) => setSku(event.target.value)}
        placeholder="e.g. CAKE-CHOC-S"
        help="Unique within the organization."
        inputMode="text"
        autoCapitalize="none"
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Chocolate cake — small"
      />
      <TextField
        name="size"
        label="Size (optional)"
        value={size}
        onChange={(event) => setSize(event.target.value)}
        placeholder="e.g. 8 slices"
      />
      <SelectField
        name="finishedGoodItemId"
        label="Finished-good item"
        value={finishedGoodItemId}
        onChange={(event) => setFinishedGoodItemId(event.target.value)}
        placeholder="None — made to order"
        options={items.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
        }))}
        help="Optional. A stocked variant links the item its output is stocked as; leave blank for a made-to-order variant."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register variant
        </Button>
      </div>
    </form>
  );
}
