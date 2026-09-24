"use client";

import { Alert, Button, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the recipe. Check the values and try again.";

export interface RecipeItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Minimal recipe-identity form: posts `{ code, name, outputItemId? }` to
 * `POST /api/v1/recipes`. The route is same-origin and session-guarded; the
 * command owns the domain rules, so this only collects values and refreshes the
 * list on success. Version lines are added on the recipe page.
 */
export function NewRecipeForm({ items }: { readonly items: readonly RecipeItemOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const code = String(data.get("code") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const outputItemId = String(data.get("outputItemId") ?? "").trim();

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          ...(outputItemId.length === 0 ? {} : { outputItemId }),
        }),
      });
      if (!response.ok) {
        setError(FALLBACK_ERROR);
        return;
      }
      formElement.reset();
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
      style={{ display: "flex", flexDirection: "column", gap: spacing[3], maxWidth: 560 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <TextField
        name="code"
        label="Code"
        required
        disabled={busy}
        help="Unique within the organization."
      />
      <TextField name="name" label="Name" required disabled={busy} />
      <SelectField
        name="outputItemId"
        label="Output item"
        disabled={busy}
        placeholder="None — made to order (DEC-030)"
        options={items.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
        }))}
        help={
          items.length === 0
            ? "No items registered yet; a made-to-order recipe needs no output item."
            : "Optional. The item one batch of this recipe produces."
        }
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register recipe
        </Button>
      </div>
    </form>
  );
}
