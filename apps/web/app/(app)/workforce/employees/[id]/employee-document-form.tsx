"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not add the document. Please try again.";

export interface EmployeeDocumentFormProps {
  readonly employeeId: string;
  /** Document kinds from the application vocabulary (`EMPLOYEE_DOCUMENT_KINDS`). */
  readonly kinds: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Adds one personnel document's **metadata** (`DOC-001`…`DOC-004`, `DEC-087`)
 * through `POST /api/v1/workforce/employees/[id]/documents`. There is no file
 * upload: the storage path is deferred (`DEC-085`/`DEC-099`), so the form
 * records kind, title and the validity window only and the section states that
 * upload/download/retention are unavailable.
 */
export function EmployeeDocumentForm({ employeeId, kinds }: EmployeeDocumentFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [title, setTitle] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (title.trim().length === 0) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/employees/${employeeId}/documents`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          fileObjectId: null,
          ...(issuedAt.trim().length === 0 ? {} : { issuedAt: issuedAt.trim() }),
          ...(expiresAt.trim().length === 0 ? {} : { expiresAt: expiresAt.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Document metadata recorded.");
      setTitle("");
      setIssuedAt("");
      setExpiresAt("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Add a personnel document" meta="metadata only — no file upload">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="kind"
          label="Kind"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={kinds.map((value) => ({ value, label: value }))}
        />
        <TextField
          name="title"
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <DateField
          name="issuedAt"
          label="Issued"
          value={issuedAt}
          onChange={(event) => setIssuedAt(event.target.value)}
          help="Optional validity window; expiry must not precede the issue date."
        />
        <DateField
          name="expiresAt"
          label="Expires"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record document
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Metadata only: no bytes are stored, uploaded or downloadable, and retention is not
          enforced (DEC-085, DEC-099 — the storage path is deferred).
        </p>
      </form>
    </SectionCard>
  );
}
