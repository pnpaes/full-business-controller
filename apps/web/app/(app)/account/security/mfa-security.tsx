"use client";

import {
  Alert,
  Button,
  Panel,
  StatusPill,
  TextField,
  color,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

const FALLBACK_ERROR = "Something went wrong. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

interface BeginBody extends ErrorBody {
  readonly secret?: string;
  readonly uri?: string;
  readonly issuer?: string;
  readonly account?: string;
}

interface RecoveryBody extends ErrorBody {
  readonly recoveryCodes?: readonly string[];
}

interface Enrolment {
  readonly secret: string;
  readonly uri: string;
  readonly issuer: string;
  readonly account: string;
}

type RecoveryReason = "enrolled" | "regenerated";

interface MfaSecurityPanelProps {
  readonly mfaEnabled: boolean;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const codeBlock: CSSProperties = {
  display: "block",
  padding: spacing[3],
  margin: `${spacing[2]}px 0`,
  backgroundColor: color.background.inset,
  border: `1px solid ${color.border.subtle}`,
  borderRadius: radius.sm,
  fontFamily: typography.fontFamily.mono,
  fontSize: typography.fontSize.sm,
  color: color.text.primary,
  wordBreak: "break-all",
};

function RecoveryCodes({ codes }: { codes: readonly string[] }) {
  return (
    <ul
      style={{
        margin: `${spacing[3]}px 0`,
        padding: 0,
        listStyle: "none",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: spacing[2],
      }}
    >
      {codes.map((code) => (
        <li key={code}>
          <code style={{ ...codeBlock, margin: 0, textAlign: "center", letterSpacing: 1 }}>
            {code}
          </code>
        </li>
      ))}
    </ul>
  );
}

/**
 * Client-side MFA management panel. All authority lives on the server: this only
 * drives the four `/api/v1/auth/mfa/*` routes. The secret, the `otpauth://` URI
 * and the recovery codes are held in component state for the duration of the
 * flow and are never written to storage, the URL or a log.
 */
export function MfaSecurityPanel({ mfaEnabled }: MfaSecurityPanelProps) {
  const [enabled, setEnabled] = useState(mfaEnabled);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [recoveryReason, setRecoveryReason] = useState<RecoveryReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: Record<string, unknown>): Promise<Response | null> {
    setBusy(true);
    setError(null);
    try {
      return await fetch(`/api/v1/auth/mfa/${path}`, {
        method: "POST",
        credentials: "same-origin",
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      setError(FALLBACK_ERROR);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startEnrolment(): Promise<void> {
    const response = await post("enrolment/begin");
    if (response === null) {
      return;
    }
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    const body = (await response.json()) as BeginBody;
    if (body.secret === undefined || body.uri === undefined) {
      setError(FALLBACK_ERROR);
      return;
    }
    setEnrolment({
      secret: body.secret,
      uri: body.uri,
      issuer: body.issuer ?? "",
      account: body.account ?? "",
    });
  }

  async function confirmEnrolment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response = await post("enrolment/confirm", {
      code: field(new FormData(event.currentTarget), "code"),
    });
    if (response === null) {
      return;
    }
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    const body = (await response.json()) as RecoveryBody;
    setEnrolment(null);
    setEnabled(true);
    setRecoveryReason("enrolled");
    setRecoveryCodes(body.recoveryCodes ?? []);
  }

  async function regenerate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response = await post("recovery-codes/regenerate", {
      code: field(new FormData(event.currentTarget), "code"),
    });
    if (response === null) {
      return;
    }
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    const body = (await response.json()) as RecoveryBody;
    setRecoveryReason("regenerated");
    setRecoveryCodes(body.recoveryCodes ?? []);
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response = await post("disable", {
      password: field(new FormData(event.currentTarget), "password"),
    });
    if (response === null) {
      return;
    }
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    // All sessions were revoked server-side; re-authenticate.
    window.location.assign("/login");
  }

  const feedback = error !== null ? <Alert tone="danger">{error}</Alert> : null;

  if (recoveryCodes !== null) {
    const enrolled = recoveryReason === "enrolled";
    return (
      <Panel
        title={enrolled ? "Two-factor authentication enabled" : "New recovery codes"}
        headingLevel={2}
        meta={enrolled ? <StatusPill tone="success">Enabled</StatusPill> : undefined}
      >
        <Alert tone="warning" title="Save these now">
          These recovery codes are shown only once. Each works once if you lose your authenticator.
          Store them somewhere safe and offline.
        </Alert>
        <RecoveryCodes codes={recoveryCodes} />
        <Button
          type="button"
          onClick={() => {
            setRecoveryCodes(null);
            setRecoveryReason(null);
          }}
        >
          {enrolled ? "I have saved my recovery codes" : "Done"}
        </Button>
      </Panel>
    );
  }

  if (enrolment !== null) {
    return (
      <Panel title="Set up your authenticator app" headingLevel={2}>
        {feedback}
        <p style={{ margin: `0 0 ${spacing[2]}px`, color: color.text.secondary }}>
          Add this account to your authenticator app (Google Authenticator, 1Password, …) by opening
          the link or entering the secret manually. The secret and link are shown only here.
        </p>
        <p style={{ margin: 0, color: color.text.secondary, fontSize: typography.fontSize.sm }}>
          {enrolment.issuer} — {enrolment.account}
        </p>
        <code style={codeBlock} aria-label="Authenticator setup secret">
          {enrolment.secret}
        </code>
        <a href={enrolment.uri} style={{ fontSize: typography.fontSize.sm }}>
          Open in authenticator app
        </a>
        <code style={{ ...codeBlock, fontSize: typography.fontSize.xs }}>{enrolment.uri}</code>
        <form
          onSubmit={confirmEnrolment}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing[4],
            marginTop: spacing[4],
          }}
        >
          <TextField
            name="code"
            label="Enter the 6-digit code from the app"
            required
            disabled={busy}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <div style={{ display: "flex", gap: spacing[2] }}>
            <Button type="submit" loading={busy} disabled={busy}>
              Confirm and enable
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEnrolment(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    );
  }

  if (!enabled) {
    return (
      <Panel
        title="Two-factor authentication"
        headingLevel={2}
        meta={<StatusPill tone="warning">Not enabled</StatusPill>}
      >
        {feedback}
        <Alert tone="info">
          Two-factor authentication is required for owner, finance and admin roles (ADR-0003) and
          recommended for everyone. You will need an authenticator app.
        </Alert>
        <div style={{ marginTop: spacing[4] }}>
          <Button type="button" loading={busy} disabled={busy} onClick={startEnrolment}>
            Set up authenticator
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
      <Panel
        title="Two-factor authentication"
        headingLevel={2}
        meta={<StatusPill tone="success">Enabled</StatusPill>}
      >
        {feedback}
        <form
          onSubmit={regenerate}
          style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}
        >
          <p style={{ margin: 0, color: color.text.secondary }}>
            Generate a new set of recovery codes. This invalidates the previous set. Confirm with a
            current code from your authenticator.
          </p>
          <TextField
            name="code"
            label="Current authenticator code"
            required
            disabled={busy}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <div>
            <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
              Regenerate recovery codes
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Disable two-factor authentication"
        headingLevel={2}
        meta={<StatusPill tone="danger">Security downgrade</StatusPill>}
      >
        <Alert tone="warning">
          Disabling MFA signs you out of every device and removes your recovery codes. If your role
          requires MFA you will be asked to set it up again.
        </Alert>
        <form
          onSubmit={disable}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing[4],
            marginTop: spacing[4],
          }}
        >
          <TextField
            name="password"
            label="Confirm your password"
            type="password"
            required
            disabled={busy}
            autoComplete="current-password"
          />
          <div>
            <Button type="submit" variant="danger" loading={busy} disabled={busy}>
              Disable MFA
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
