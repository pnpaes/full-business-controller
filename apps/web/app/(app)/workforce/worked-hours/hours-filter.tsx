"use client";

import {
  Button,
  color,
  DateField,
  FilterBar,
  SelectField,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

export interface HoursFilterLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface HoursFilterProps {
  readonly locations: readonly HoursFilterLocation[];
  readonly locationId: string;
  readonly from: string;
  readonly to: string;
  /** True when a location must be chosen (a multi-location scoped caller). */
  readonly locationRequired: boolean;
}

/**
 * The worked-hours period/location filter: a quiet `FilterBar` strip that
 * navigates the same page with `?from=&to=&location=`. The window is UTC days;
 * the report itself is the half-open instant window `[from T00:00Z, to+1
 * T00:00Z)` (DEC-103). The resolved ISO window is repeated as text so it is
 * readable without opening the native date pickers.
 */
export function HoursFilter({
  locations,
  locationId,
  from,
  to,
  locationRequired,
}: HoursFilterProps) {
  const router = useRouter();
  const [nextLocation, setNextLocation] = useState(locationId);
  const [nextFrom, setNextFrom] = useState(from);
  const [nextTo, setNextTo] = useState(to);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const search = new URLSearchParams();
    search.set("from", nextFrom.trim());
    search.set("to", nextTo.trim());
    if (nextLocation.length > 0) {
      search.set("location", nextLocation);
    }
    router.push(`/workforce/worked-hours?${search.toString()}`);
  }

  return (
    <FilterBar>
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: spacing[3],
          width: "100%",
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
            label={locationRequired ? "Location (required)" : "Location"}
            {...(locationRequired ? { required: true } : {})}
            value={nextLocation}
            onChange={(event) => setNextLocation(event.target.value)}
            options={[
              ...(locationRequired ? [] : [{ value: "", label: "Whole organization" }]),
              ...locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.name}`,
              })),
            ]}
            {...(locationRequired
              ? {
                  help: "A multi-location caller must choose one location — the report refuses to guess (fail-closed).",
                }
              : {})}
          />
        </div>
        <Button type="submit">Apply</Button>
        <span style={{ fontSize: typography.fontSize.sm, color: color.ink.tertiary }}>
          Window {from} → {to} (UTC days, period end day included)
        </span>
      </form>
    </FilterBar>
  );
}
