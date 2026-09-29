"use client";

import { AreaTabs } from "@aquarela/ui";
import { usePathname } from "next/navigation";

/**
 * Link-based section tabs for the Costs area (08_UI_UX.md §8.1 navigation),
 * rendered from the shared `AreaTabs`. A client component only to supply the
 * current pathname; the strip, its styling and the active-state logic live in
 * `@aquarela/ui`, so every section stays an independently addressable,
 * shareable link.
 */

interface CostsTab {
  readonly href: string;
  readonly label: string;
}

const TABS: readonly CostsTab[] = [
  { href: "/costs", label: "Overview" },
  { href: "/costs/cost-cards", label: "Cost cards" },
  { href: "/costs/price-scenarios", label: "Price scenarios" },
  { href: "/costs/price-versions", label: "Price versions" },
  { href: "/costs/operating-costs", label: "Operating costs" },
  { href: "/costs/labor-rates", label: "Labour rates" },
  { href: "/costs/cost-pools", label: "Cost pools" },
  { href: "/costs/allocation-rules", label: "Allocation rules" },
  { href: "/costs/channel-fee-rules", label: "Channel fees" },
];

export function CostsTabs() {
  const pathname = usePathname();
  return <AreaTabs pathname={pathname} ariaLabel="Costs sections" items={TABS} />;
}
