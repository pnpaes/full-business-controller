"use client";

import {
  Alert,
  Button,
  SectionCard,
  TextField,
  TextareaField,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { LEGACY_I19_DEMO_TEXT, parseLegacyI19Rows } from "../legacy-i19";

const REGISTER_FALLBACK = "Could not register the import run. Please try again.";
const STAGE_FALLBACK = "The run was registered but staging its rows failed.";
const CRYPTO_FALLBACK =
  "This browser cannot compute the file hash (Web Crypto unavailable), so the run cannot be registered.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/** SHA-256 hex of the pasted content; this is the run's replay guard. */
async function sha256Hex(text: string): Promise<string | null> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    return null;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Registers a sales export and stages its rows (08_UI_UX.md §8.3:
 * upload/history). The pasted block is parsed with the legacy `I19` reference
 * shape (`../legacy-i19`) and the content hash is computed in the browser, so
 * re-uploading identical content is rejected by the replay guard rather than
 * duplicating rows.
 *
 * The form stops after staging: validation and mapping are explicit actions on
 * the run screen. Nothing here posts — posting is row 12, owner-gated on
 * `ADR-0008`.
 */
export function NewRunForm() {
  const router = useRouter();
  const [source, setSource] = useState("zettle-legacy");
  const [profileVersion, setProfileVersion] = useState("i19-v1");
  const [periodStart, setPeriodStart] = useState("2026-08-01");
  const [periodEnd, setPeriodEnd] = useState("2026-08-31");
  const [text, setText] = useState(LEGACY_I19_DEMO_TEXT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (periodStart > periodEnd) {
      setError("The period start must not be after the period end.");
      return;
    }
    const parsed = parseLegacyI19Rows(text);
    if (parsed.errors.length > 0) {
      setError(parsed.errors[0]!);
      return;
    }
    if (parsed.rows.length === 0) {
      setError("Paste at least one row to import.");
      return;
    }

    setBusy(true);
    try {
      const fileHash = await sha256Hex(text);
      if (fileHash === null) {
        setError(CRYPTO_FALLBACK);
        return;
      }

      const createResponse = await fetch("/api/v1/imports/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: source.trim(),
          profileVersion: profileVersion.trim(),
          fileHash,
          periodStart,
          periodEnd,
        }),
      });
      if (!createResponse.ok) {
        setError(await errorMessage(createResponse, REGISTER_FALLBACK));
        return;
      }
      const created = (await createResponse.json()) as { importRunId?: string };
      if (typeof created.importRunId !== "string") {
        setError(REGISTER_FALLBACK);
        return;
      }

      const stageResponse = await fetch(`/api/v1/imports/runs/${created.importRunId}/rows`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.rows }),
      });
      if (!stageResponse.ok) {
        setError(await errorMessage(stageResponse, STAGE_FALLBACK));
        router.push(`/sales/import/${created.importRunId}`);
        return;
      }

      router.push(`/sales/import/${created.importRunId}`);
    } catch {
      setError(REGISTER_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register an import run" meta="upload · stage">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 860 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <TextField
            name="source"
            label="Source"
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
            help="The export's source system. The demo rows below are the legacy Zettle/PayPal reference shape (I19)."
          />
          <TextField
            name="profileVersion"
            label="Profile version"
            value={profileVersion}
            onChange={(event) => setProfileVersion(event.target.value)}
            help="Taken from the source's import profile when one exists — leave it blank then. Required only when no profile exists for the source."
          />
          <TextField
            name="periodStart"
            type="date"
            label="Period start"
            required
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
          <TextField
            name="periodEnd"
            type="date"
            label="Period end"
            required
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </div>

        <TextareaField
          name="rows"
          label="Rows (semicolon-separated)"
          required
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          help="Columns: date;time;receipt;staff;product;variant;quantity;gross_price;discount;line_total;location. Comma decimals are accepted. The content hash is the replay guard, so identical content cannot be imported twice."
          style={{ fontFamily: typography.fontFamily.mono }}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register and stage rows
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Staging retains every well-formed row. Validation, mapping and posting are explicit
          actions on the run screen, so nothing is written to sales until you review the run.
        </p>
      </form>
    </SectionCard>
  );
}
