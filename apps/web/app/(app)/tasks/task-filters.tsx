"use client";

import { Button, DateField, FilterChip, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { taskStatusView } from "./task-labels";

const STATUS_FILTERS = ["open", "in_progress", "blocked", "resolved", "dismissed"] as const;

/**
 * The task register's filter bar (`DEC-122`): a status chip row, an assignee
 * selector and a `dueBefore` day. Every control is labelled and the status chips
 * are `aria-pressed` buttons, so the state is not conveyed by colour alone. The
 * filters are applied to the URL query, which the server page reads — no
 * client-side filtering, so the read stays bounded server-side.
 */
export function TaskFilters({
  owners,
  status,
  ownerId,
  dueBefore,
}: {
  readonly owners: readonly { readonly id: string; readonly label: string }[];
  readonly status: string;
  readonly ownerId: string;
  readonly dueBefore: string;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [nextOwnerId, setNextOwnerId] = useState(ownerId);
  const [nextDueBefore, setNextDueBefore] = useState(dueBefore);

  function push(next: { status: string; ownerId: string; dueBefore: string }): void {
    const params = new URLSearchParams();
    if (next.status.length > 0) params.set("status", next.status);
    if (next.ownerId.length > 0) params.set("ownerId", next.ownerId);
    if (next.dueBefore.length > 0) params.set("dueBefore", next.dueBefore);
    const query = params.toString();
    router.push(query.length > 0 ? `/tasks?${query}` : "/tasks");
  }

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    push({ status: nextStatus, ownerId: nextOwnerId, dueBefore: nextDueBefore });
  }

  return (
    <form
      onSubmit={apply}
      aria-label="Task filters"
      style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
    >
      <div
        role="group"
        aria-label="Filter by status"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}
      >
        <FilterChip
          active={nextStatus === ""}
          onClick={() => setNextStatus("")}
          style={{ minHeight: 44, padding: `${spacing[2]}px ${spacing[3]}px` }}
        >
          All
        </FilterChip>
        {STATUS_FILTERS.map((candidate) => (
          <FilterChip
            key={candidate}
            active={nextStatus === candidate}
            onClick={() => setNextStatus(candidate)}
            style={{ minHeight: 44, padding: `${spacing[2]}px ${spacing[3]}px` }}
          >
            {taskStatusView(candidate).label}
          </FilterChip>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[3],
          alignItems: "end",
        }}
      >
        <SelectField
          name="ownerId"
          label="Assignee"
          value={nextOwnerId}
          onChange={(event) => setNextOwnerId(event.target.value)}
          options={[
            { value: "", label: "Any assignee" },
            ...owners.map((owner) => ({ value: owner.id, label: owner.label })),
          ]}
        />
        <DateField
          name="dueBefore"
          label="Due on or before"
          value={nextDueBefore}
          onChange={(event) => setNextDueBefore(event.target.value)}
        />
        <div style={{ display: "flex", gap: spacing[2] }}>
          <Button type="submit" style={{ minHeight: 44 }}>
            Apply filters
          </Button>
          <Button
            type="button"
            variant="secondary"
            style={{ minHeight: 44 }}
            onClick={() => {
              setNextStatus("");
              setNextOwnerId("");
              setNextDueBefore("");
              push({ status: "", ownerId: "", dueBefore: "" });
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </form>
  );
}
