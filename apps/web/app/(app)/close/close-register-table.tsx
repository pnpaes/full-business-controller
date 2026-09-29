import { EmptyState, StatusPill, Table, Td, Th, typography } from "@aquarela/ui";

import { closeScopeLabel, closeStatusView } from "./close-labels";

/**
 * Presentational, **read-only** close register for the `/close` screen
 * (`DEC-119`). Server component: no hooks, no state. The page owns the reads and
 * maps each close into a `CloseRegisterRow`; the irreversible lock/reopen
 * actions live in the separate `CloseStateActions` section so they are not
 * mixed into the register's routine reading surface.
 */

export interface CloseRegisterRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeLabel: string;
  readonly periodLabel: string;
  readonly status: string;
  /** Resolved actor label, or the raw id when no profile could be resolved. */
  readonly lockedByLabel: string | null;
  readonly lockedAtLabel: string | null;
  readonly reopenReason: string | null;
  readonly canLock: boolean;
  readonly canReopen: boolean;
}

const subLine = { opacity: 0.75, fontSize: typography.fontSize.xs } as const;

export function CloseRegisterTable({ rows }: { readonly rows: readonly CloseRegisterRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState variant="plain" title="No closes yet">
        A close appears once one is begun for a location day or the company month. Beginning
        evaluates the prerequisites and freezes the snapshot; locking then freezes the period.
      </EmptyState>
    );
  }
  return (
    <Table caption="Period closes, newest period first." columnCount={5}>
      <thead>
        <tr>
          <Th>Scope</Th>
          <Th>Period</Th>
          <Th>Status</Th>
          <Th>Locked</Th>
          <Th>Reopen reason</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = closeStatusView(row.status);
          return (
            <tr key={row.id}>
              <Td>
                <span style={{ fontWeight: typography.fontWeight.semibold }}>{row.scopeLabel}</span>
                <br />
                <span style={subLine}>{closeScopeLabel(row.scopeType)}</span>
              </Td>
              <Td style={{ whiteSpace: "nowrap" }}>{row.periodLabel}</Td>
              <Td>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </Td>
              <Td style={{ whiteSpace: "nowrap" }}>
                {row.lockedByLabel === null ? (
                  "—"
                ) : (
                  <>
                    {row.lockedByLabel}
                    <br />
                    <span style={subLine}>{row.lockedAtLabel ?? "—"}</span>
                  </>
                )}
              </Td>
              <Td style={{ maxWidth: 260 }}>{row.reopenReason ?? "—"}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
