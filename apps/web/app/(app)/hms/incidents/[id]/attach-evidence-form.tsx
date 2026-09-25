"use client";

import { Alert, Button, SectionCard, color, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not attach the evidence. Please try again.";

/** The evidence allow-list, mirrored from `HMS_INCIDENT_UPLOAD_POLICY` for the picker. */
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Attaches one evidence file to an existing incident (`DEC-134`). The file is
 * posted as `multipart/form-data` to the incident-update route (`PATCH`), which
 * stores it linked to the incident through the `DEC-132` port; the body carries
 * only the file, so the route treats it as a pure evidence attach. Evidence is
 * an amendment, so this form is offered only to the edit roles (owner, general
 * manager, location manager, admin — `DEC-095`); kitchen and front of house may
 * raise and read incidents but not attach.
 */
export function AttachEvidenceForm({ incidentId }: { readonly incidentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem("file");
    const file =
      input instanceof HTMLInputElement && input.files !== null ? input.files[0] : undefined;
    if (file === undefined) {
      setError("Choose a file to attach.");
      return;
    }

    const body = new FormData();
    body.append("file", file);

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/incidents/${incidentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        body,
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Evidence attached. It is listed above and downloadable.");
      formElement.reset();
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Attach evidence" meta="photo or report · editor roles only">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <label style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
          <span>Evidence file</span>
          <input type="file" name="file" accept={ACCEPT} required />
        </label>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Attach evidence
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          A scene photo (JPEG, PNG, WebP) or an attached report (PDF), up to 10 MiB. Each file is
          stored as an immutable attachment; attach a new file to add more.
        </p>
      </form>
    </SectionCard>
  );
}
