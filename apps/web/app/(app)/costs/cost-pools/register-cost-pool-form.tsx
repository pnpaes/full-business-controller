"use client";

import { Alert, Button, SectionCard, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the cost pool. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registers a cost pool through `POST /api/v1/costing/cost-pools` (COST-007).
 * A pool code is versioned, not unique: registering an existing code opens a
 * new version, so the effective window must not overlap the current one (the
 * server command is the authority).
 */
export function RegisterCostPoolForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/costing/cost-pools", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          effectiveFrom,
          ...(effectiveTo === "" ? {} : { effectiveTo }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      setSuccess(
        `Registered pool ${code.trim()}, effective from ${effectiveFrom}. Reusing an existing code opens a new version.`,
      );
      setCode("");
      setName("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register a cost pool" meta="versioned by code">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextField
          name="code"
          label="Code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="e.g. FACILITIES"
          help="Versioned, not unique: reusing a code opens a new non-overlapping version."
        />
        <TextField
          name="name"
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Premises and utilities"
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <TextField
            name="effectiveFrom"
            type="date"
            label="Effective from"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <TextField
            name="effectiveTo"
            type="date"
            label="Effective to"
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
            help="Optional. Must be after the effective-from date."
          />
        </div>
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register cost pool
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
