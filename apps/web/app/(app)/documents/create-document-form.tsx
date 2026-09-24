"use client";

import { Alert, Button, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the document. Please try again.";

export interface CreateDocumentFormProps {
  /** The document categories with their display labels. */
  readonly categories: readonly { readonly value: string; readonly label: string }[];
  /** The document audiences with their display labels. */
  readonly audiences: readonly { readonly value: string; readonly label: string }[];
}

interface ErrorBody {
  readonly error?: string;
}

interface CreatedBody {
  readonly documentId?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Creates one staff document (`DEC-088`, `DOC-001`) through the existing
 * `POST /api/v1/documents` route. A new document always starts `draft` —
 * publication is a version-level fact, so there is no status choice here.
 * The actor and organization are the server's.
 */
export function CreateDocumentForm({ categories, audiences }: CreateDocumentFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]?.value ?? "");
  const [audience, setAudience] = useState(audiences[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (title.trim().length === 0) {
      setError("Give the document a title.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/documents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), category, audience }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json().catch(() => null)) as CreatedBody | null;
      router.refresh();
      if (typeof body?.documentId === "string") {
        router.push(`/documents/${body.documentId}`);
      }
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
      <TextField
        name="title"
        label="Title"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        help="What the document is called in the library."
      />
      <SelectField
        name="category"
        label="Category"
        required
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        options={categories}
      />
      <SelectField
        name="audience"
        label="Audience"
        required
        value={audience}
        onChange={(event) => setAudience(event.target.value)}
        options={audiences}
        help="“All staff” documents become visible to everyone once a version is published; “Managers” documents stay manager-only."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Create document
        </Button>
      </div>
      <p style={{ margin: 0, color: "inherit", opacity: 0.8 }}>
        The document starts as a draft. Add a version on its page, then publish the version to make
        it visible.
      </p>
    </form>
  );
}
