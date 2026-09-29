"use client";

import { FilterBar, SegmentedControl, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RegisterFilterLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegisterFiltersProps {
  /** The current status filter (`active` / `retired` / `all`). */
  readonly show: string;
  /** The current raw `location` query value, or null when none is set. */
  readonly locationId: string | null;
  /** The locations the caller may filter by; already filtered to scope. */
  readonly locations: readonly RegisterFilterLocation[];
}

/**
 * The register filter strip: one quiet `FilterBar` holding the retirement
 * status as a `SegmentedControl` and the primary location as a select. Both
 * navigate the same page and write the existing `?show=&location=` state — a
 * status change keeps the current location, a location change keeps the status,
 * and clearing the location drops the parameter exactly as the old chips did.
 */
export function RegisterFilters({ show, locationId, locations }: RegisterFiltersProps) {
  const router = useRouter();
  const [nextShow, setNextShow] = useState(show);
  const [nextLocation, setNextLocation] = useState(locationId ?? "");

  function navigate(nextShowValue: string, nextLocationValue: string): void {
    const search = new URLSearchParams();
    search.set("show", nextShowValue);
    if (nextLocationValue.length > 0) {
      search.set("location", nextLocationValue);
    }
    router.push(`/workforce?${search.toString()}`);
  }

  return (
    <FilterBar>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[3],
          width: "100%",
        }}
      >
        <SegmentedControl
          name="show"
          label="Retirement status"
          value={nextShow}
          options={[
            { value: "active", label: "Active" },
            { value: "retired", label: "Retired" },
            { value: "all", label: "All" },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setNextShow(value);
            navigate(value, nextLocation);
          }}
        />
        {locations.length > 1 ? (
          <div style={{ flex: "0 1 260px", minWidth: 220 }}>
            <SelectField
              name="location"
              label="Primary location"
              value={nextLocation}
              onChange={(event) => {
                const value = event.target.value;
                setNextLocation(value);
                navigate(nextShow, value);
              }}
              options={[
                { value: "", label: "All locations" },
                ...locations.map((location) => ({
                  value: location.id,
                  label: `${location.code} · ${location.name}`,
                })),
              ]}
            />
          </div>
        ) : null}
      </div>
    </FilterBar>
  );
}
