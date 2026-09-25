"use client";

import { Alert, Button, color, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

const FALLBACK_ERROR = "Could not mark the report exported. Please try again.";

/**
 * Marks one payroll report as `exported` (`WF-005`, `DEC-104`) through
 * `POST /api/v1/workforce/payroll-reports/[id]/export`. The exported CSV/PDF
 * artefact is chosen here and uploaded as `multipart/form-data`, so the bytes
 * are stored through the `DEC-132` port and linked to the report (`DEC-133`);
 * the server records the `exported` status in the same request. Only a
 * generated report can be exported.
 */
export function MarkExportedButton({ reportId }: { readonly reportId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  async function markExported(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (file === null) {
      setError("Choose the exported CSV or PDF first.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/v1/workforce/payroll-reports/${reportId}/export`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={markExported}
      style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <span>Exported file (CSV or PDF)</span>
        <input
          type="file"
          name="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          onChange={onFileChange}
          disabled={busy}
        />
      </label>
      <p style={{ margin: 0, color: color.ink.tertiary, fontSize: typography.fontSize.sm }}>
        The file is stored privately and linked to the report; it can be downloaded once the report
        is exported. Only a generated report can be exported.
      </p>
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Upload &amp; mark exported
        </Button>
      </div>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}
