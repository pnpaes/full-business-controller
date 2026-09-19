"use client";

import { Alert, Button, Card, TextField } from "@aquarela/ui";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Something went wrong. Please try again.";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Always shows the same neutral confirmation, matching the endpoint's neutral
 * "if the account exists" behaviour — the UI must not become an enumeration
 * oracle either.
 */
export function ResetBeginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = field(new FormData(event.currentTarget), "identifier");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/password-reset/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSubmitted(true);
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <Card>
        <Alert tone="success">
          If the account exists, reset instructions have been started. Continue with your reset code
          on the{" "}
          <a href="/reset/complete" style={{ color: "inherit", fontWeight: 600 }}>
            complete reset
          </a>{" "}
          page.
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <TextField name="identifier" label="Email or username" required disabled={busy} />
        <Button type="submit" loading={busy} disabled={busy}>
          Start reset
        </Button>
        <p style={{ margin: 0, fontSize: 13 }}>
          <a href="/login">Back to sign in</a>
        </p>
      </form>
    </Card>
  );
}
