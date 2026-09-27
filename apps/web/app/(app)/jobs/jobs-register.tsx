"use client";

import {
  Alert,
  Button,
  EmptyState,
  Modal,
  StatusPill,
  Table,
  Td,
  Th,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatJobInstant, jobStatusView } from "./jobs-labels";

const RETRY_FALLBACK = "Could not retry the job. Please try again.";
const DISCARD_FALLBACK = "Could not discard the job. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface JobsRegisterRow {
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  readonly queue: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date | string;
  readonly finishedAt: Date | string | null;
}

const subLine = { opacity: 0.75, fontSize: typography.fontSize.xs } as const;

type Action = "retry" | "discard";

/**
 * The jobs register (`DEC-139`): the operator surface over the `job`
 * projection. It never renders `payload` or `error` — the projection's routing
 * data and failure text stay server-side (`GET /api/v1/jobs` omits them too).
 *
 * Retry and discard are offered only on `dead_lettered` rows and only to a
 * caller holding `JOBS_ADMIN_ROLES`; every action still carries a confirmation
 * step, and the API remains the authority (a rejected action surfaces its
 * message rather than being silently accepted).
 */
export function JobsRegister({
  rows,
  canAdmin,
}: {
  readonly rows: readonly JobsRegisterRow[];
  readonly canAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: JobsRegisterRow; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState title="No jobs for this filter">
        Jobs appear here once the worker or the scheduler enqueues work — the monthly payroll run,
        the outbox replay, or any producer. Dead-lettered jobs are the weekly review queue
        (DEC-139).
      </EmptyState>
    );
  }

  async function run(row: JobsRegisterRow, action: Action): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const fallback = action === "retry" ? RETRY_FALLBACK : DISCARD_FALLBACK;
    try {
      const response = await fetch(`/api/v1/jobs/${row.id}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, fallback));
        return;
      }
      setNotice(
        action === "retry"
          ? "Job re-queued — it will run again (deduped on the outbox event)."
          : "Job discarded — it stays failed and will not be replayed.",
      );
      setPending(null);
      router.refresh();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice !== null ? <Alert tone="success">{notice}</Alert> : null}
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Table caption="Jobs, newest first." columnCount={canAdmin ? 6 : 5}>
        <thead>
          <tr>
            <Th>Status</Th>
            <Th>Kind</Th>
            <Th>Queue</Th>
            <Th>Attempts</Th>
            <Th>Created</Th>
            {canAdmin ? <Th>Actions</Th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = jobStatusView(row.status);
            const actionable = canAdmin && row.status === "dead_lettered";
            return (
              <tr key={row.id}>
                <Td>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <br />
                  <span style={subLine}>{formatJobInstant(row.finishedAt)}</span>
                </Td>
                <Td>{row.kind}</Td>
                <Td>{row.queue}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {row.attempts}/{row.maxAttempts}
                </Td>
                <Td style={{ whiteSpace: "nowrap" }}>{formatJobInstant(row.createdAt)}</Td>
                {canAdmin ? (
                  <Td>
                    {actionable ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button onClick={() => setPending({ row, action: "retry" })}>Retry</Button>
                        <Button
                          variant="secondary"
                          onClick={() => setPending({ row, action: "discard" })}
                        >
                          Discard
                        </Button>
                      </div>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </Td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Modal
        title={
          pending === null
            ? ""
            : pending.action === "retry"
              ? "Retry this dead-lettered job?"
              : "Discard this dead-lettered job?"
        }
        open={pending !== null}
        onClose={() => (busy ? undefined : setPending(null))}
      >
        {pending === null ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0 }}>
              {pending.action === "retry"
                ? "The job is reset to pending and the event is re-sent; consumers dedup on the outbox event id, so a retry is safe to repeat."
                : "The job becomes terminally failed and is not replayed. Use this only when the event is not safe to re-apply."}
            </p>
            <p style={{ margin: 0, ...subLine }}>
              {pending.row.kind} · {pending.row.queue} · attempts {pending.row.attempts}/
              {pending.row.maxAttempts}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => run(pending.row, pending.action)}
                loading={busy}
                disabled={busy}
              >
                {pending.action === "retry" ? "Retry job" : "Discard job"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
