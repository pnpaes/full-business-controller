"use client";

import { Alert, Button, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not update the variant. Please try again.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EditVariantFormProps {
  readonly productVariantId: string;
  readonly name: string;
  readonly size: string | null;
  readonly finishedGoodItemId: string | null;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Edits the genuinely mutable variant fields (`updateProductVariant`, `DEC-128`):
 * the display `name`, the display `size` and the nullable finished-good item
 * link. `code`, `sku` and the product are immutable — they anchor identity — so
 * they are shown read-only on the page and absent here. Pre-filled; a failed
 * save preserves the input and moves focus to the first invalid field.
 */
export function EditVariantForm({
  productVariantId,
  name: initialName,
  size: initialSize,
  finishedGoodItemId: initialFinishedGoodItemId,
}: EditVariantFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [size, setSize] = useState(initialSize ?? "");
  const [finishedGoodItemId, setFinishedGoodItemId] = useState(initialFinishedGoodItemId ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [finishedError, setFinishedError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setNameError(null);
    setFinishedError(null);

    let firstInvalid: string | null = null;
    if (name.trim().length === 0) {
      setNameError("Enter a name.");
      firstInvalid = "field-name";
    }
    if (finishedGoodItemId.trim().length > 0 && !UUID_PATTERN.test(finishedGoodItemId.trim())) {
      setFinishedError("Enter the item id as a UUID, or leave it blank.");
      firstInvalid ??= "field-finishedGoodItemId";
    }
    if (firstInvalid !== null) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/products/variants/${productVariantId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          size: size.trim() === "" ? null : size,
          finishedGoodItemId: finishedGoodItemId.trim() === "" ? null : finishedGoodItemId.trim(),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Variant updated.");
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
        {...(nameError === null ? {} : { error: nameError })}
        onChange={(event) => setName(event.target.value)}
        help="The display name; changing it does not affect history."
      />
      <TextField
        name="size"
        label="Size"
        value={size}
        onChange={(event) => setSize(event.target.value)}
        help="Display label only, e.g. 8 slices. Leave blank to clear it."
      />
      <TextField
        name="finishedGoodItemId"
        label="Finished-good item id"
        value={finishedGoodItemId}
        {...(finishedError === null ? {} : { error: finishedError })}
        onChange={(event) => setFinishedGoodItemId(event.target.value)}
        help="The stocked item this variant is fulfilled from. Blank is valid for a made-to-order variant."
        inputMode="text"
        autoCapitalize="none"
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
