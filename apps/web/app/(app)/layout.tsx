import { ScopeBar, color, elevation, radius, spacing, typography } from "@aquarela/ui";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getAuthStore } from "../../lib/auth";
import { getServerSession } from "../../lib/server-session";

import { AppBrand, MobileNav, ShellNav, UserMenu } from "./shell-nav";

export const metadata = { title: "Aquarela Business Control" };

/**
 * Authenticated application shell (08_UI_UX.md §8.1 navigation and scope,
 * §8.7 visual direction). Server component: the session is resolved server-side
 * and an unauthenticated visitor is redirected before any shell chrome renders.
 *
 * Layout is cream canvas, dark-navy navigation, serif page titles and generous
 * whitespace; watercolour stays out of the operational chrome. Responsive split:
 * a sticky navy sidebar at ≥1024px, a drawer behind a menu button below that.
 */
export const dynamic = "force-dynamic";

/** The few rules inline styles cannot express: media queries, hover and the
 * `<details>`/`<summary>` reset. Token-derived, no external stylesheet. */
const shellCss = `
.aq-shell {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  min-height: 100vh;
  background-color: ${color.background.page};
  font-family: ${typography.fontFamily.sans};
}
.aq-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
/* ---------------------------- Navy left sidebar ---------------------------- */
.aq-sidebar {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: ${color.navigation.background};
  color: ${color.navigation.text};
  overflow: hidden;
}
.aq-sidebar-nav { flex: 1 1 auto; overflow-y: auto; }
.aq-sidebar nav a:hover { background-color: ${color.navigation.backgroundHover}; }
.aq-brand {
  display: flex;
  align-items: center;
  gap: ${spacing[3]}px;
  padding: ${spacing[5]}px ${spacing[4]}px;
  color: ${color.navigation.text};
  text-decoration: none;
}
.aq-brand-name {
  display: flex;
  flex-direction: column;
  font-family: ${typography.fontFamily.display};
  font-size: ${typography.fontSize.xl}px;
  font-weight: ${typography.fontWeight.semibold};
  line-height: ${typography.lineHeight.tight};
}
.aq-brand-sub {
  margin-top: 2px;
  font-family: ${typography.fontFamily.sans};
  font-size: 10px;
  font-weight: ${typography.fontWeight.medium};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${color.navigation.textMuted};
}
.aq-sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: ${spacing[1]}px;
  padding: ${spacing[4]}px;
  border-top: 1px solid rgba(250, 246, 239, 0.14);
  font-size: ${typography.fontSize.xs}px;
  color: ${color.navigation.textMuted};
  overflow-wrap: anywhere;
}
.aq-muted { color: ${color.text.muted}; }
/* -------------------------------- Top bar ---------------------------------- */
.aq-main { display: flex; flex-direction: column; min-width: 0; }
.aq-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${spacing[3]}px;
  padding: ${spacing[3]}px ${spacing[6]}px;
  background-color: ${color.background.page};
  border-bottom: 1px solid ${color.border.subtle};
}
.aq-menu-button { order: 1; display: none; }
.aq-scope { order: 2; flex: 1 1 340px; min-width: 0; }
.aq-topbar-end { order: 3; display: flex; align-items: center; gap: ${spacing[3]}px; margin-left: auto; }
.aq-search { position: relative; display: flex; align-items: center; }
.aq-search svg { position: absolute; left: 10px; color: ${color.text.muted}; pointer-events: none; }
.aq-search-input {
  min-height: 44px;
  width: 220px;
  padding: 0 ${spacing[3]}px 0 36px;
  border: 1px solid ${color.border.default};
  border-radius: ${radius.sm}px;
  background-color: ${color.background.surface};
  color: ${color.text.primary};
  font: inherit;
  font-size: ${typography.fontSize.md}px;
}
.aq-search-input::placeholder { color: ${color.text.muted}; }
/* ------------------------------- User menu --------------------------------- */
.aq-user { position: relative; }
.aq-user-summary:focus-visible,
.aq-user-item:focus-visible {
  outline: 2px solid ${color.border.focus};
  outline-offset: 2px;
}
.aq-user-summary {
  display: inline-flex;
  align-items: center;
  gap: ${spacing[2]}px;
  min-height: 44px;
  padding: ${spacing[1]}px ${spacing[3]}px ${spacing[1]}px ${spacing[1]}px;
  background-color: ${color.background.surface};
  border: 1px solid ${color.border.default};
  border-radius: ${radius.sm}px;
  color: ${color.text.primary};
  font-size: ${typography.fontSize.sm}px;
  cursor: pointer;
  list-style: none;
}
.aq-user-summary::-webkit-details-marker { display: none; }
.aq-user-summary::marker { content: ""; }
.aq-user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: ${radius.pill}px;
  background-color: ${color.brand.navy};
  color: ${color.text.onNavy};
  font-size: 11px;
  font-weight: ${typography.fontWeight.semibold};
}
.aq-user-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aq-user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + ${spacing[1]}px);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: ${spacing[1]}px;
  min-width: 220px;
  padding: ${spacing[2]}px;
  background-color: ${color.background.surface};
  border: 1px solid ${color.border.subtle};
  border-radius: ${radius.md}px;
  box-shadow: ${elevation.lg};
}
.aq-user-meta {
  margin: 0;
  padding: ${spacing[1]}px ${spacing[3]}px;
  font-size: ${typography.fontSize.xs}px;
  color: ${color.text.muted};
}
.aq-user-item {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 ${spacing[3]}px;
  border: 0;
  border-radius: ${radius.sm}px;
  background: transparent;
  color: ${color.text.primary};
  font: inherit;
  font-size: ${typography.fontSize.md}px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.aq-user-item:hover { background-color: ${color.background.surfaceAlt}; }
.aq-user-item:disabled { opacity: 0.6; cursor: not-allowed; }
/* --------------------------------- Canvas ---------------------------------- */
.aq-canvas {
  flex: 1 1 auto;
  width: 100%;
  padding: ${spacing[8]}px ${spacing[6]}px ${spacing[12]}px;
}
/* ------------------------------ Mobile drawer ------------------------------ */
.aq-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  padding: 0;
  border: 0;
  background-color: rgba(14, 24, 48, 0.55);
  cursor: pointer;
}
.aq-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  width: min(320px, 86vw);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background-color: ${color.navigation.background};
  color: ${color.navigation.text};
  box-shadow: ${elevation.lg};
}
.aq-drawer nav a:hover { background-color: ${color.navigation.backgroundHover}; }
.aq-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing[3]}px;
  padding: ${spacing[3]}px ${spacing[2]}px ${spacing[3]}px 0;
}
.aq-close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: ${radius.sm}px;
  background: transparent;
  color: ${color.navigation.text};
  cursor: pointer;
}
/* -------------------------------- Breakpoint ------------------------------- */
@media (max-width: 1023px) {
  .aq-shell { grid-template-columns: minmax(0, 1fr); }
  .aq-sidebar { display: none; }
  .aq-menu-button { display: inline-flex; }
  .aq-topbar-end { order: 2; }
  .aq-scope { order: 3; flex-basis: 100%; }
  .aq-topbar { padding: ${spacing[3]}px ${spacing[4]}px; }
  .aq-canvas { padding: ${spacing[6]}px ${spacing[4]}px ${spacing[10]}px; }
  .aq-search-input { width: 140px; }
}
`;

/** Search affordance: not wired to a query surface yet, so it is read-only and
 * marked as such rather than pretending to work. */
function SearchBox() {
  return (
    <div className="aq-search">
      <label className="aq-visually-hidden" htmlFor="app-search">
        Search
      </label>
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" />
      </svg>
      <input
        id="app-search"
        className="aq-search-input"
        type="search"
        placeholder="Search — not wired yet"
        readOnly
        aria-disabled="true"
        title="Search is not wired to data yet"
      />
    </div>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }
  // Resolve a display label where one exists; never invent a name. When only the
  // session id is available it is shown muted in the footer.
  const user = await getAuthStore().findUserById(session.userId);
  if (user === undefined) {
    redirect("/login");
  }
  const profileLabel = user.email ?? user.username;

  return (
    <div className="aq-shell">
      <style dangerouslySetInnerHTML={{ __html: shellCss }} />
      <aside className="aq-sidebar">
        <AppBrand />
        <div className="aq-sidebar-nav">
          <ShellNav />
        </div>
        <div className="aq-sidebar-footer">
          <span className={profileLabel === null ? "aq-muted" : undefined}>
            {profileLabel ?? session.id}
          </span>
          <span className="aq-muted">
            {profileLabel === null ? "Session (no profile name resolved)" : "Signed in"}
          </span>
        </div>
      </aside>
      <div className="aq-main">
        <header className="aq-topbar">
          <MobileNav />
          <div className="aq-scope">
            {/* Display-only scope placeholders (§8.1, §8.4): the real
                company/location/date controls are not wired yet. */}
            <ScopeBar
              company="Aquarela (placeholder)"
              location="All locations (placeholder)"
              dateLabel="Date scope: placeholder"
              onChangeHint="Company, location and date scope will be selectable here."
            />
          </div>
          <div className="aq-topbar-end">
            <SearchBox />
            <UserMenu label={profileLabel} fallback={session.id} />
          </div>
        </header>
        <main id="main-content" className="aq-canvas">
          {children}
        </main>
      </div>
    </div>
  );
}
