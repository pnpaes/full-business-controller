"use client";

import { Alert, Button, Card, TextField } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR =
  "The invite code is invalid, expired or already used. Ask a manager to send a new invite.";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Redeems an employee invite (`DEC-146`). The code is typed or pasted here,
 * never taken from the URL (`ADR-0003`); a successful accept sets a session
 * cookie, so the form then sends the employee into the app.
 */
export function InviteAcceptForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = field(form, "token").trim();
    const password = field(form, "password");
    const confirm = field(form, "confirm");
    setError(null);

    if (token.length === 0) {
      setError("Enter the invite code from your email.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/auth/invite/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        // The API answers a single generic error on every failure, so the page
        // shows its own neutral message rather than echoing a server string.
        setError(
          response.status === 429
            ? "Too many attempts. Please wait a moment and try again."
            : typeof body?.error === "string" && body.error.length > 0 && response.status === 400
              ? body.error
              : FALLBACK_ERROR,
        );
        return;
      }
      // A session cookie is set; go to the app.
      router.replace("/");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          name="token"
          label="Invite code"
          required
          disabled={busy}
          help="Paste the invite code from your email."
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          required
          disabled={busy}
          help="At least 12 characters."
        />
        <TextField
          name="confirm"
          label="Confirm password"
          type="password"
          required
          disabled={busy}
        />
        <Button type="submit" loading={busy} disabled={busy}>
          Set password and sign in
        </Button>
      </form>
    </Card>
  );
}
