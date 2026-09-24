"use client";

import { Button, DateField, SectionCard, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

export interface RosterFilterLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RosterFilterProps {
  readonly locations: readonly RosterFilterLocation[];
  readonly locationId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The roster window/location filter: navigates the same page with
 * `?from=&to=&location=` so the server re-reads the window. UTC days — the
 * shift windows are stored and read as UTC instants.
 */
export function RosterFilter({ locations, locationId, from, to }: RosterFilterProps) {
  const router = useRouter();
  const [nextLocation, setNextLocation] = useState(locationId);
  const [nextFrom, setNextFrom] = useState(from);
  const [nextTo, setNextTo] = useState(to);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const search = new URLSearchParams();
    if (nextFrom.trim().length > 0) {
      search.set("from", nextFrom.trim());
    }
    if (nextTo.trim().length > 0) {
      search.set("to", nextTo.trim());
    }
    if (nextLocation.length > 0) {
      search.set("location", nextLocation);
    }
    router.push(`/workforce/shifts?${search.toString()}`);
  }

  return (
    <SectionCard title="Window and location" meta="UTC days">
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          gap: spacing[3],
          alignItems: "flex-end",
          flexWrap: "wrap",
          maxWidth: 860,
        }}
      >
        <div style={{ flex: "1 1 160px" }}>
          <DateField
            name="from"
            label="From"
            required
            value={nextFrom}
            onChange={(event) => setNextFrom(event.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <DateField
            name="to"
            label="To"
            required
            value={nextTo}
            onChange={(event) => setNextTo(event.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <SelectField
            name="location"
            label="Location"
            value={nextLocation}
            onChange={(event) => setNextLocation(event.target.value)}
            options={[
              { value: "", label: "All locations" },
              ...locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.name}`,
              })),
            ]}
          />
        </div>
        <Button type="submit">Apply</Button>
      </form>
    </SectionCard>
  );
}
