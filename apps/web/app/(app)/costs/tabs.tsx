"use client";

import { color, radius, spacing, typography } from "@aquarela/ui";
import { usePathname } from "next/navigation";

/**
 * Link-based section tabs for the Costs area (08_UI_UX.md §8.1 navigation).
 * A client component only to mark the active tab from the pathname; each tab is
 * a plain link, so the sections are independently addressable and shareable.
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

function matches(pathname: string, href: string): boolean {
  return href === "/costs"
    ? pathname === "/costs"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function CostsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Costs sections"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: spacing[2],
        paddingBottom: spacing[2],
        borderBottom: `1px solid ${color.border.subtle}`,
      }}
    >
      {TABS.map((tab) => {
        const active = matches(pathname, tab.href);
        return (
          <a
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 40,
              padding: `${spacing[1]}px ${spacing[3]}px`,
              borderRadius: radius.sm,
              fontFamily: typography.fontFamily.sans,
              fontSize: typography.fontSize.sm,
              fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.regular,
              color: active ? color.text.onNavy : color.text.secondary,
              backgroundColor: active ? color.brand.navy : color.background.surface,
              border: `1px solid ${active ? color.brand.navy : color.border.subtle}`,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
