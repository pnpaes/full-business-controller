"use client";

import { Alert, Button, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the version. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

/**
 * Creates the next version of one document (`DEC-088`, `DOC-002`) through the
 * existing `POST /api/v1/documents/[id]/versions` route. The version number is
 * assigned by the command; the version starts unpublished.
 *
 * **No file attachment** (`DEC-085`, `DEC-099`): the route accepts an optional
 * `fileObjectId`, but there is no upload path to obtain one, so the form does
 * not offer a file field and says so.
 */
export function CreateVersionForm({ documentId }: { readonly documentId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/documents/${documentId}/versions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim().length === 0 ? null : notes.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess("Version created. Publish it to make it the current version.");
      setNotes("");
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
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Create version
        </Button>
      </div>
      <p style={{ margin: 0, opacity: 0.8 }}>
        File attachment is not available yet (DEC-085, DEC-099): a version records its number and
        notes only — no document bytes can be uploaded or downloaded.
      </p>
    </form>
  );
}
