"use client";

import { AreaTabs } from "@aquarela/ui";
import { usePathname } from "next/navigation";

/**
 * Link-based section tabs for the Administration area (08_UI_UX.md §8.1
 * navigation), rendered from the shared `AreaTabs`. A client component only to
 * supply the current pathname; the strip, its styling and the active-state
 * logic live in `@aquarela/ui`, so every section stays an independently
 * addressable, shareable link.
 */

interface AdminTab {
  readonly href: string;
  readonly label: string;
}

const TABS: readonly AdminTab[] = [
  { href: "/administration", label: "Overview" },
  { href: "/administration/users", label: "Users & access" },
  { href: "/administration/integrations", label: "Integrations" },
  { href: "/administration/tax-rules", label: "Tax rules" },
  { href: "/administration/units", label: "Units & conversions" },
  { href: "/administration/data-quality", label: "Data quality" },
  { href: "/administration/audit", label: "Audit log" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return <AreaTabs pathname={pathname} ariaLabel="Administration sections" items={TABS} />;
}
