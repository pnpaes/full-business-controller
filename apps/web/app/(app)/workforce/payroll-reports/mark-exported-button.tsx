"use client";

import { Button, FileField, FormModal, SuccessToast } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

const FALLBACK_ERROR = "Could not mark the report exported. Please try again.";

/**
 * Marks one payroll report as `exported` (`WF-005`, `DEC-104`) through
 * `POST /api/v1/workforce/payroll-reports/[id]/export`. The exported CSV/PDF
 * artefact is chosen in a `FormModal` and uploaded as `multipart/form-data`, so
 * the bytes are stored through the `DEC-132` port and linked to the report
 * (`DEC-133`); the server records the `exported` status in the same request.
 * Only a generated report can be exported.
 */
export function MarkExportedButton({ reportId }: { readonly reportId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function close(): void {
    if (!busy) {
      setOpen(false);
      setError(null);
    }
  }

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
      setSuccess("Report marked exported.");
      setOpen(false);
      setFile(null);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Mark exported</Button>
      <FormModal
        title="Mark report exported"
        description="Upload the exported CSV/PDF artefact. It is stored privately and linked to the report, which is then marked exported. Only a generated report can be exported."
        open={open}
        onClose={close}
        onSubmit={markExported}
        busy={busy}
        submitLabel="Upload & mark exported"
        error={error}
      >
        <FileField
          name="file"
          label="Exported file (CSV or PDF)"
          accept=".csv,.pdf,text/csv,application/pdf"
          required
          onChange={onFileChange}
          help="Stored privately and downloadable from this page once the report is exported."
        />
      </FormModal>
      <SuccessToast
        open={success !== null}
        onDismiss={() => setSuccess(null)}
        message={success ?? ""}
      />
    </>
  );
}
