"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextField,
  color,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not amend the document. Please try again.";

export interface EditEmployeeDocumentFormProps {
  readonly employeeName: string;
  readonly documentId: string;
  readonly kind: string;
  readonly title: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
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
 * Amends one personnel document's metadata (`WF-007`, `DEC-087`) through the
 * existing `PATCH /api/v1/workforce/employee-documents/[id]` route. The row is
 * amended in place (no revision model, `DEC-087`) and the audit fact carries
 * the before/after provenance. An attached file is set when the document is
 * created (`DEC-133`); this form does not replace it, so `fileObjectId` stays
 * untouched and the stored bytes remain downloadable from the list.
 */
export function EditEmployeeDocumentForm({
  employeeName,
  documentId,
  kind: initialKind,
  title: initialTitle,
  issuedAt: initialIssuedAt,
  expiresAt: initialExpiresAt,
  kinds,
}: EditEmployeeDocumentFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState(initialTitle);
  const [issuedAt, setIssuedAt] = useState(initialIssuedAt ?? "");
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt ?? "");
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
      const response = await fetch(`/api/v1/workforce/employee-documents/${documentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          issuedAt: issuedAt.trim().length === 0 ? null : issuedAt.trim(),
          expiresAt: expiresAt.trim().length === 0 ? null : expiresAt.trim(),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Document amended. The change is audit-logged.");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Amend a personnel document" meta={`metadata only · ${employeeName}`}>
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
          help="Leave empty to clear the issue date."
        />
        <DateField
          name="expiresAt"
          label="Expires"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          help="Leave empty to clear the expiry; must not precede the issue date."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Save document
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          Metadata amendment only: the file attached when the document was created is unchanged and
          stays downloadable from the list. Retention is not enforced.
        </p>
      </form>
    </SectionCard>
  );
}
