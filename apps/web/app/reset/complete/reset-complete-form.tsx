"use client";

import { Alert, Button, Card, TextField } from "@aquarela/ui";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "The reset code is invalid or has expired.";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The reset token is typed or pasted here, never linked in a URL or query
 * string (ADR-0003): tokens travel in request bodies only.
 */
export function ResetCompleteForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = field(form, "token");
    const newPassword = field(form, "newPassword");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setDone(true);
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <Alert tone="success">
          Your password has been reset and every session has been signed out.{" "}
          <a href="/login" style={{ color: "inherit", fontWeight: 600 }}>
            Sign in
          </a>
          .
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          name="token"
          label="Reset code"
          required
          disabled={busy}
          help="Paste the reset code from your reset instructions."
        />
        <TextField
          name="newPassword"
          label="New password"
          type="password"
          required
          disabled={busy}
        />
        <Button type="submit" loading={busy} disabled={busy}>
          Set new password
        </Button>
      </form>
    </Card>
  );
}
