import { DomainError } from "@aquarela/domain";

/**
 * The `task.status` state machine (`DEC-122`, superseding `DEC-101`'s "no
 * transition guard" for this slice only). Kept as a small **pure** module — no
 * store, no persistence, no I/O — so every legal and illegal transition is
 * testable in isolation, exactly like the import-run guard
 * (`packages/domain/src/sales-mapping.ts`).
 *
 * The vocabulary is the one the existing `task_status_check` constraint
 * (`0050_workflow_platform.sql`) already permits, so there is no second
 * vocabulary and no SQL translation anywhere in the slice:
 *
 * ```
 *   open ──► in_progress ──► resolved
 *     │           │
 *     └───────────┴────────► dismissed
 *                 ▲
 *       blocked ──┘ (blocked → in_progress)
 * ```
 *
 * `resolved` and `dismissed` are **terminal**; an unknown current status or an
 * unlisted transition is rejected with a message-only `DomainError`.
 */
export const TASK_STATUSES = ["open", "in_progress", "blocked", "resolved", "dismissed"] as const;

/** Narrow type for `task.status`, so comparisons cannot drift. */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Legal `from -> to` transitions. `resolved`/`dismissed` map to an empty list, so
 * they are terminal by construction. An unknown `from` is absent from the record
 * and therefore illegal (`canTransitionTaskStatus` returns `false`).
 */
export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  open: ["in_progress", "blocked", "dismissed"],
  in_progress: ["resolved", "blocked", "dismissed"],
  blocked: ["in_progress", "dismissed"],
  resolved: [],
  dismissed: [],
};

/** True when `from -> to` is a legal task transition (unknown statuses are illegal). */
export function canTransitionTaskStatus(from: string, to: string): boolean {
  const allowed = TASK_STATUS_TRANSITIONS[from as TaskStatus];
  return allowed !== undefined && allowed.includes(to as TaskStatus);
}

/** Throws `DomainError` on an illegal transition, so no command can skip a state. */
export function assertTaskStatusTransition(from: string, to: string): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new DomainError(`illegal task status transition: ${from} -> ${to}`);
  }
}

/** True when `status` is terminal (`resolved`/`dismissed`) and so may not change again. */
export function isTerminalTaskStatus(status: string): boolean {
  return status === "resolved" || status === "dismissed";
}
