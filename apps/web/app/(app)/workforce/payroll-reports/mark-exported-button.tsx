"use client";

import { Alert, Button, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not mark the report exported. Please try again.";

/**
 * Marks one payroll report as `exported` (`WF-005`, `DEC-104`) through
 * `POST /api/v1/workforce/payroll-reports/[id]/export` with no file link —
 * the exported-bytes path is deferred (`DEC-085`), so the action records the
 * status only and the UI says so.
 */
export function MarkExportedButton({ reportId }: { readonly reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markExported(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/payroll-reports/${reportId}/export`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      <Button type="button" loading={busy} disabled={busy} onClick={markExported}>
        Mark as exported
      </Button>
      <p style={{ margin: 0, opacity: 0.8, fontSize: typography.fontSize.sm }}>
        Records the exported status only — no file is produced or attached (the storage path is
        deferred, DEC-085). Only a generated report can be exported.
      </p>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
