"use client";

import { Alert, Button, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the variant. Please try again.";

export interface ItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegisterVariantFormProps {
  /** The parent product; a variant is always created inside exactly one product. */
  readonly productId: string;
  readonly items: readonly ItemOption[];
  /** Called after a successful registration, e.g. to close the containing modal. */
  readonly onSuccess?: () => void;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers a variant of the product this form is opened from
 * (`registerProductVariant`, `DEC-128`) — the sellable identity (`DEC-030`).
 * The parent product is fixed: a variant is never created at the products
 * level, only from its own product. `sku` and `code` anchor identity; the
 * finished-good item is optional on purpose: a made-to-order variant has no
 * stocked item, so leaving it blank is legal. The recipe assignment is attached
 * to the variant afterwards, on the variant view. Idempotent on `(product, code)`.
 */
export function RegisterVariantForm({ productId, items, onSuccess }: RegisterVariantFormProps) {
  const router = useRouter();
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
        label="Variant code"
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. SMALL"
        help="Unique within this product; a repeat reopens the existing variant."
      />
      <TextField
        name="sku"
        label="SKU"
        required
        value={sku}
        onChange={(event) => setSku(event.target.value)}
        placeholder="e.g. CAKE-CHOC-S"
        help="The sellable identity code; unique within the organization."
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
        label="Stocked from"
        value={finishedGoodItemId}
        onChange={(event) => setFinishedGoodItemId(event.target.value)}
        placeholder="None — made to order"
        options={items.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
        }))}
        help="Only for a genuinely stocked variant: the for-sale item its output is stocked as. Leave blank for a made-to-order variant."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register variant
        </Button>
      </div>
    </form>
  );
}
