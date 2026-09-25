"use client";

import { Alert, Button, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the version. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

/**
 * Creates the next version of one document (`DEC-088`, `DOC-002`) through the
 * existing `POST /api/v1/documents/[id]/versions` route, or — when a file is
 * chosen — through `POST /api/v1/documents/[id]/versions/upload` (`DEC-132`),
 * which stores the bytes and creates the version that references them in one
 * action. The version number is assigned by the command; the version starts
 * unpublished.
 *
 * The file field is optional: a version with no attachment is still a valid
 * version, and the plain JSON route is unchanged for that case.
 */
export function CreateVersionForm({ documentId }: { readonly documentId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
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
    setBusy(true);
    try {
      let response: Response;
      if (file === null) {
        response = await fetch(`/api/v1/documents/${documentId}/versions`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notes.trim().length === 0 ? null : notes.trim() }),
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        if (notes.trim().length > 0) {
          form.append("notes", notes.trim());
        }
        response = await fetch(`/api/v1/documents/${documentId}/versions/upload`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess(
        file === null
          ? "Version created. Publish it to make it the current version."
          : "File stored and version created. Publish it to make it the current version.",
      );
      setNotes("");
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
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}
      <TextareaField
        name="notes"
        label="Version notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        help="What changed in this version (optional)."
      />
      <label style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <span>File (optional)</span>
        <input type="file" name="file" onChange={onFileChange} disabled={busy} />
        <span style={{ opacity: 0.8 }}>
          The file is stored privately and linked to this version. Leave empty to record a version
          with notes only.
        </span>
      </label>
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Create version
        </Button>
      </div>
    </form>
  );
}
