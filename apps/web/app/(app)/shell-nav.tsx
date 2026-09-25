"use client";

/**
 * Client-side shell navigation for the Aquarela Business Controller
 * (08_UI_UX.md §8.1 navigation, §8.6 mobile operational behaviour, §8.7
 * visual direction).
 *
 * The desktop sidebar and the mobile drawer share one pathname-aware `ShellNav`,
 * built from the `NavList`/`NavItem` primitives (light DEC-129 sidebar
 * contract). Nothing here decides
 * authorisation: the server layout has already resolved the session and every
 * area page enforces its own access — the nav is a convenience, not a gate
 * (§8.1: authorization never depends on hidden links).
 */
import { NavItem, NavList, color, radius, spacing, typography } from "@aquarela/ui";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/* ------------------------------- Brand mark -------------------------------- */

/** Inline-SVG brand mark: three translucent watercolour washes under a serif A
 * (§8.7: watercolour accents, cream/navy/berry/green/gold palette). */
function BrandMark() {
  return (
    <svg width={34} height={34} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="12" fill={color.brand.berry} opacity={0.55} />
      <circle cx="25" cy="18" r="11" fill={color.brand.green} opacity={0.45} />
      <circle cx="20" cy="27" r="10" fill={color.brand.goldSoft} opacity={0.5} />
      <text
        x="20"
        y="27"
        textAnchor="middle"
        fontFamily={typography.fontFamily.display}
        fontSize="20"
        fontWeight={typography.fontWeight.semibold}
        fill={color.ink.primary}
      >
        A
      </text>
    </svg>
  );
}

/** Brand lockup used by the navy sidebar and the drawer header. */
export function AppBrand() {
  return (
    <a href="/" className="aq-brand" aria-label="Aquarela Business Control — home">
      <BrandMark />
      <span className="aq-brand-name">
        Aquarela
        <span className="aq-brand-sub">Business Control</span>
      </span>
    </a>
  );
}

/* ---------------------------------- Icons ---------------------------------- */

const glyphProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Shared inline-SVG icon frame; purely decorative (labels carry the meaning). */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg {...glyphProps} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface Area {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
}

/** The §8.1 primary areas plus the `DEC-119` Close register and the staff/
 * operations areas (Workforce, Documents, HMS), each with a line glyph. */
const AREAS: readonly Area[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <Glyph>
        <path d="M4 11l8-7 8 7" />
        <path d="M6 10v9h12v-9" />
      </Glyph>
    ),
  },
  {
    href: "/sales",
    label: "Sales",
    icon: (
      <Glyph>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-6" />
        <path d="M22 19H2" />
      </Glyph>
    ),
  },
  {
    href: "/products",
    label: "Products",
    icon: (
      <Glyph>
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </Glyph>
    ),
  },
  {
    href: "/production",
    label: "Production",
    icon: (
      <Glyph>
        <path d="M3 20h18" />
        <path d="M5 20V9l5 3V9l5 3V9l4 3v8" />
      </Glyph>
    ),
  },
  {
    href: "/workforce",
    label: "Workforce",
    icon: (
      <Glyph>
        <circle cx="9" cy="8" r="3" />
        <path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" />
        <circle cx="16.5" cy="9" r="2.4" />
        <path d="M15.5 14.2c2.6.4 4.5 2.4 4.5 4.8" />
      </Glyph>
    ),
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: (
      <Glyph>
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 13l9 5 9-5" />
      </Glyph>
    ),
  },
  {
    href: "/purchasing",
    label: "Purchasing",
    icon: (
      <Glyph>
        <path d="M3 5h2l2 10h11" />
        <path d="M7 9h12l-2 6H8" />
        <circle cx="9" cy="19" r="1.3" />
        <circle cx="17" cy="19" r="1.3" />
      </Glyph>
    ),
  },
  {
    href: "/costs",
    label: "Costs",
    icon: (
      <Glyph>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8" />
        <path d="M9 10h6" />
      </Glyph>
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: (
      <Glyph>
        <path d="M4 19h16" />
        <path d="M6 15l4-5 3 3 5-7" />
      </Glyph>
    ),
  },
  {
    href: "/close",
    label: "Close",
    icon: (
      <Glyph>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Glyph>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (
      <Glyph>
        <path d="M9 6h11" />
        <path d="M9 12h11" />
        <path d="M9 18h11" />
        <path d="M3 6l1.6 1.6L7.5 4.5" />
        <path d="M3 12l1.6 1.6L7.5 10.5" />
        <path d="M3 18l1.6 1.6L7.5 16.5" />
      </Glyph>
    ),
  },
  {
    href: "/documents",
    label: "Documents",
    icon: (
      <Glyph>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4" />
        <path d="M10 12h5" />
        <path d="M10 16h5" />
      </Glyph>
    ),
  },
  {
    href: "/hms",
    label: "HMS",
    icon: (
      <Glyph>
        <rect x="6" y="4" width="12" height="17" rx="2" />
        <path d="M9 10h6" />
        <path d="M9 14h6" />
        <path d="M9 18h3" />
      </Glyph>
    ),
  },
  {
    href: "/administration",
    label: "Administration",
    icon: (
      <Glyph>
        <path d="M4 7h8" />
        <path d="M16 7h4" />
        <circle cx="14" cy="7" r="2" />
        <path d="M4 17h4" />
        <path d="M12 17h8" />
        <circle cx="10" cy="17" r="2" />
      </Glyph>
    ),
  },
];

/**
 * An area is current when the pathname is the area root or sits beneath it;
 * Home (`/`) is current only at the root so it does not light up everywhere.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* -------------------------------- Shell nav -------------------------------- */

/**
 * The primary areas as a `NavList`. Rendered by the desktop sidebar and, for
 * smaller screens, inside the drawer. `onNavigate` lets the drawer close itself.
 */
export function ShellNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    // A wrapping element carries the click handler so activating any row (the
    // anchor bubbles) closes the drawer without modifying the NavItem primitive.
    <div onClick={onNavigate}>
      <NavList>
        {AREAS.map((area) => (
          <NavItem
            key={area.href}
            href={area.href}
            label={area.label}
            icon={area.icon}
            active={isActive(pathname, area.href)}
          />
        ))}
      </NavList>
    </div>
  );
}

/* ------------------------------- Mobile nav -------------------------------- */

// `display` is intentionally not set inline: the shell stylesheet hides this
// button at ≥1024px and shows it below, and inline styles would win.
const menuButtonStyle = {
  alignItems: "center",
  gap: spacing[2],
  minHeight: 44,
  minWidth: 44,
  padding: `${spacing[2]}px ${spacing[3]}px`,
  backgroundColor: color.background.surface,
  color: color.text.primary,
  border: `1px solid ${color.border.default}`,
  borderRadius: radius.sm,
  font: "inherit",
  fontFamily: typography.fontFamily.sans,
  fontWeight: typography.fontWeight.medium,
  cursor: "pointer",
} as const;

/**
 * Below 1024px the sidebar is hidden, so this renders the menu button and the
 * drawer it toggles (identical `NavList`). ≥44px targets (§8.6), Escape and
 * backdrop close, focus moves into the drawer, and it closes on navigation.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  // Navigation happened: close the drawer, but deliberately do not steal focus
  // back to the Menu button — the route change relocates focus on its own and
  // refocusing here would be a different defect.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The single close path for every dismissal that is not a navigation: close
  // the drawer and return focus to the control that opened it.
  const closeDrawer = useCallback(() => {
    setOpen(false);
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeDrawer]);

  return (
    <>
      <button
        ref={menuRef}
        type="button"
        className="aq-menu-button"
        style={menuButtonStyle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="aq-drawer"
        onClick={() => setOpen(true)}
      >
        <Glyph>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </Glyph>
        <span>Menu</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="aq-drawer-backdrop"
            aria-label="Close navigation"
            onClick={closeDrawer}
          />
          <div
            id="aq-drawer"
            className="aq-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
          >
            <div className="aq-drawer-head">
              <AppBrand />
              <button
                ref={closeRef}
                type="button"
                className="aq-close-button"
                aria-label="Close navigation"
                onClick={closeDrawer}
              >
                <Glyph>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </Glyph>
              </button>
            </div>
            <ShellNav onNavigate={() => setOpen(false)} />
          </div>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------- Bottom nav -------------------------------- */

/** The core sections for the compact mobile bottom navigation (brief §6
 * mobile, §17): Home (the operational entry), Sales and Inventory (the two
 * highest-frequency operational facts), Production (the daily workflow) and
 * Insights (the analytical entry). The lower-frequency or role-gated areas —
 * Purchasing, Costs, Close, Tasks, Workforce, Documents, HMS, Administration —
 * stay reachable through
 * the drawer, which carries the full set. */
const BOTTOM_NAV_HREFS: readonly string[] = [
  "/",
  "/sales",
  "/inventory",
  "/production",
  "/insights",
];

/**
 * Fixed, softly rounded floating container with the 3–5 most important
 * sections (brief §6 mobile). Hidden by the shell stylesheet at tablet width
 * and above; ≥44px targets, `aria-current="page"` on the active section.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="aq-bottomnav" aria-label="Primary sections">
      {AREAS.filter((area) => BOTTOM_NAV_HREFS.includes(area.href)).map((area) => (
        <a
          key={area.href}
          href={area.href}
          className="aq-bottomnav-item"
          aria-current={isActive(pathname, area.href) ? "page" : undefined}
        >
          {area.icon}
          <span>{area.label}</span>
        </a>
      ))}
    </nav>
  );
}

/* -------------------------------- User menu -------------------------------- */

function initials(display: string): string {
  const letters = display
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters.length > 0 ? letters : "?";
}

export interface UserMenuProps {
  /** Resolved profile label (email or username); null when only the session id
   * is known, in which case `fallback` is shown muted. */
  label: string | null;
  /** Session id — shown when no profile label could be resolved. */
  fallback: string;
}

/**
 * Native `<details>` disclosure: no JS needed to open it. "Account security"
 * links to the MFA screen; "Sign out" posts to the server logout route (which
 * revokes the session), then returns to sign-in.
 */
export function UserMenu({ label, fallback }: UserMenuProps) {
  const [busy, setBusy] = useState(false);
  const display = label ?? fallback;

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      // Even if the request fails the cookie is cleared server-side on retry;
      // still send the user to sign-in rather than trapping them here.
    }
    window.location.assign("/login");
  }

  return (
    <details className="aq-user">
      <summary className="aq-user-summary">
        <span className="aq-user-avatar" aria-hidden="true">
          {initials(display)}
        </span>
        <span className={label === null ? "aq-user-name aq-muted" : "aq-user-name"}>{display}</span>
      </summary>
      <div className="aq-user-menu">
        <p className="aq-user-meta">
          {label === null ? "Signed in · profile name not resolved" : "Signed in"}
        </p>
        <a className="aq-user-item" href="/account/security">
          Account security
        </a>
        <button type="button" className="aq-user-item" disabled={busy} onClick={signOut}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </details>
  );
}
