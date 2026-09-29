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
import type { ChangeEvent, FormEvent } from "react";

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
 * Adds one personnel document (`DOC-001`…`DOC-004`, `DEC-087`) through
 * `POST /api/v1/workforce/employees/[id]/documents`. The file is optional: when
 * one is chosen the request is `multipart/form-data` and the bytes are stored
 * through the `DEC-132` port, linked to the employee and referenced by the new
 * document (`DEC-133`); with no file the form records metadata only. The
 * permitted types and the size cap are enforced server-side.
 */
export function EmployeeDocumentForm({ employeeId, kinds }: EmployeeDocumentFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [title, setTitle] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setSuccess(null);
    if (title.trim().length === 0) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("title", title.trim());
      if (issuedAt.trim().length > 0) {
        form.append("issuedAt", issuedAt.trim());
      }
      if (expiresAt.trim().length > 0) {
        form.append("expiresAt", expiresAt.trim());
      }
      if (file !== null) {
        form.append("file", file);
      }
      const response = await fetch(`/api/v1/workforce/employees/${employeeId}/documents`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(
        file === null
          ? "Document metadata recorded."
          : "Document recorded and file stored. Download it from the list below.",
      );
      setTitle("");
      setIssuedAt("");
      setExpiresAt("");
      setFile(null);
      formElement.reset();
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Add a personnel document" meta="metadata + optional file">
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
        <label style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
          <span>File (optional)</span>
          <input
            type="file"
            name="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*"
            onChange={onFileChange}
            disabled={busy}
          />
          <span style={{ color: color.ink.tertiary }}>
            A contract, certificate or ID scan (PDF, image or Word document, up to 10 MiB). The file
            is stored privately and download requires the personnel-document role set.
          </span>
        </label>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record document
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          Retention is not enforced and file contents are not scanned for malware; the type is
          checked against an allow-list only.
        </p>
      </form>
    </SectionCard>
  );
}
