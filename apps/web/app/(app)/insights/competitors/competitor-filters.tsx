"use client";

import { Button, DateField, FilterChip, SelectField, geometry, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { COMPETITOR_STATUS_FILTERS, statusFilterLabel } from "./competitor-labels";

/**
 * The observation register's filter bar (`DEC-126`). The status chips make the
 * pending-versus-reviewed distinction explicit — `Pending` is never folded into
 * the reviewed set — and the window (a day range) bounds the comparison read.
 * Filters are applied to the URL query, which the server page reads, so the
 * reads stay bounded server-side.
 */
export function CompetitorFilters({
  competitors,
  status,
  competitorId,
  from,
  to,
}: {
  readonly competitors: readonly { readonly id: string; readonly name: string }[];
  readonly status: string;
  readonly competitorId: string;
  readonly from: string;
  readonly to: string;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [nextCompetitorId, setNextCompetitorId] = useState(competitorId);
  const [nextFrom, setNextFrom] = useState(from);
  const [nextTo, setNextTo] = useState(to);

  function push(next: { status: string; competitorId: string; from: string; to: string }): void {
    const params = new URLSearchParams();
    if (next.status.length > 0 && next.status !== "all") params.set("status", next.status);
    if (next.competitorId.length > 0) params.set("competitorId", next.competitorId);
    if (next.from.length > 0) params.set("from", next.from);
    if (next.to.length > 0) params.set("to", next.to);
    const query = params.toString();
    router.push(query.length > 0 ? `/insights/competitors?${query}` : "/insights/competitors");
  }

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    push({ status: nextStatus, competitorId: nextCompetitorId, from: nextFrom, to: nextTo });
  }

  return (
    <form
      onSubmit={apply}
      aria-label="Competitor observation filters"
      style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
    >
      <div
        role="group"
        aria-label="Filter by review status"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}
      >
        {COMPETITOR_STATUS_FILTERS.map((candidate) => (
          <FilterChip
            key={candidate}
            active={nextStatus === candidate}
            onClick={() => setNextStatus(candidate)}
            style={{ minHeight: geometry.touchTarget, padding: `${spacing[2]}px ${spacing[3]}px` }}
          >
            {statusFilterLabel(candidate)}
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
          name="competitorId"
          label="Competitor"
          value={nextCompetitorId}
          onChange={(event) => setNextCompetitorId(event.target.value)}
          options={[
            { value: "", label: "Any competitor" },
            ...competitors.map((competitor) => ({
              value: competitor.id,
              label: competitor.name,
            })),
          ]}
        />
        <DateField
          name="from"
          label="Comparison window from"
          value={nextFrom}
          onChange={(event) => setNextFrom(event.target.value)}
        />
        <DateField
          name="to"
          label="Comparison window to (inclusive)"
          value={nextTo}
          onChange={(event) => setNextTo(event.target.value)}
        />
        <div style={{ display: "flex", gap: spacing[2] }}>
          <Button type="submit" style={{ minHeight: geometry.touchTarget }}>
            Apply
          </Button>
          <Button
            type="button"
            variant="secondary"
            style={{ minHeight: geometry.touchTarget }}
            onClick={() => {
              setNextStatus("all");
              setNextCompetitorId("");
              setNextFrom("");
              setNextTo("");
              push({ status: "all", competitorId: "", from: "", to: "" });
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </form>
  );
}
