"use client";

import { Alert, Button, Card, TextField } from "@aquarela/ui";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Sign-in failed. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

interface LoginBody extends ErrorBody {
  readonly mfaRequired?: boolean;
}

interface Credentials {
  readonly identifier: string;
  readonly password: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Two-step sign-in. The credentials are re-sent with the second factor so the
 * server proves the password again; they are held in component state only for
 * the duration of the flow and never placed in the URL or browser storage.
 */
export function LoginForm() {
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Credentials = {
      identifier: field(form, "identifier"),
      password: field(form, "password"),
    };
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as LoginBody;
      if (body.mfaRequired === true) {
        setCredentials(next);
        setStep("mfa");
        return;
      }
      window.location.assign("/");
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (credentials === null) {
      return;
    }
    const code = field(new FormData(event.currentTarget), "code");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials, code }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      window.location.assign("/");
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {step === "credentials" ? (
        <form
          onSubmit={submitCredentials}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <TextField
            name="identifier"
            label="Email or username"
            required
            disabled={busy}
            placeholder="you@aquarela.no"
          />
          <TextField name="password" label="Password" type="password" required disabled={busy} />
          <Button type="submit" loading={busy} disabled={busy}>
            Continue
          </Button>
        </form>
      ) : (
        <form
          onSubmit={submitMfa}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}
          <Alert tone="info">
            Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </Alert>
          <TextField name="code" label="Authentication code" required disabled={busy} />
          <Button type="submit" loading={busy} disabled={busy}>
            Verify
          </Button>
          <p style={{ margin: 0, fontSize: 13 }}>
            <a href="/login">Back</a>
          </p>
        </form>
      )}
    </Card>
  );
}
