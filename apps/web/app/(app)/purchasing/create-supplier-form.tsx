"use client";

import { Alert, Button, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the supplier. Please try again.";

export interface CreateSupplierFormProps {
  /** The organization's display currency; the server default when omitted. */
  readonly defaultCurrency: string | null;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers a known supplier (`registerSupplier`, DEC-047). Idempotent on
 * `(organization, code)`: re-registering an existing code returns the existing
 * supplier rather than duplicating it. The currency defaults to the
 * organization's when left blank. A failed save keeps the entered values and
 * returns focus to the first invalid field.
 */
export function CreateSupplierForm({ defaultCurrency }: CreateSupplierFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [terms, setTerms] = useState("");
  const [currency, setCurrency] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setCodeError(null);
    setNameError(null);

    if (code.trim().length === 0) {
      setCodeError("Enter a code.");
      document.getElementById("field-code")?.focus();
      return;
    }
    if (name.trim().length === 0) {
      setNameError("Enter a name.");
      document.getElementById("field-name")?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/purchasing/suppliers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          ...(contact.trim() === "" ? {} : { contact }),
          ...(terms.trim() === "" ? {} : { terms }),
          ...(currency.trim() === "" ? {} : { currency }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered ${code}.`);
      setCode("");
      setName("");
      setContact("");
      setTerms("");
      setCurrency("");
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
        name="code"
        label="Code"
        required
        value={code}
        {...(codeError === null ? {} : { error: codeError })}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. SUP-01"
        help="Unique within the organization; re-registering an existing code reopens it."
        autoCapitalize="none"
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        {...(nameError === null ? {} : { error: nameError })}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Nordkaffe AS"
      />
      <TextField
        name="contact"
        label="Contact"
        value={contact}
        onChange={(event) => setContact(event.target.value)}
        placeholder="Optional — phone or email"
      />
      <TextField
        name="terms"
        label="Terms"
        value={terms}
        onChange={(event) => setTerms(event.target.value)}
        placeholder="Optional — e.g. net 30"
      />
      <TextField
        name="currency"
        label="Currency"
        value={currency}
        onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        maxLength={3}
        placeholder={defaultCurrency ?? "NOK"}
        help="3-letter ISO code; defaults to the organization currency."
        autoCapitalize="characters"
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register supplier
        </Button>
      </div>
    </form>
  );
}
