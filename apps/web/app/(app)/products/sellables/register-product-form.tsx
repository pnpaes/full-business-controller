"use client";

import { Alert, Button, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the product. Please try again.";

export interface RegisterProductFormProps {
  readonly productKinds: readonly string[];
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

/** `add_on` → `Add on`, for a readable kind option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Registers a product (`registerProduct`, `DEC-128`). Idempotent on code, so a
 * repeat submit reopens the existing product rather than failing; `productKind`
 * is chosen from the schema vocabulary.
 */
export function RegisterProductForm({ productKinds, onSuccess }: RegisterProductFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [productKind, setProductKind] = useState(productKinds[0] ?? "base");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/products/sellables", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, productKind, ...(category === "" ? {} : { category }) }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered ${code}.`);
      setCode("");
      setName("");
      setCategory("");
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
        placeholder="e.g. CAKE-CHOC"
        help="Unique within the organization; a repeat reopens the existing product."
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Chocolate cake"
      />
      <SelectField
        name="productKind"
        label="Product kind"
        required
        value={productKind}
        onChange={(event) => setProductKind(event.target.value)}
        options={productKinds.map((value) => ({ value, label: humanize(value) }))}
      />
      <TextField
        name="category"
        label="Category (optional)"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        placeholder="e.g. Dessert"
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register product
        </Button>
      </div>
    </form>
  );
}
