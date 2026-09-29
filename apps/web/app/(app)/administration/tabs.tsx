"use client";

import { color, radius, spacing, typography } from "@aquarela/ui";
import { usePathname } from "next/navigation";

/**
 * Link-based section tabs for the Administration area (08_UI_UX.md §8.1
 * navigation). A client component only to mark the active tab from the
 * pathname; each tab is a plain link, so the sections are independently
 * addressable and shareable.
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

function matches(pathname: string, href: string): boolean {
  return href === "/administration"
    ? pathname === "/administration"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Administration sections"
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
