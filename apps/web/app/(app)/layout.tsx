import {
  breakpoint,
  color,
  containerWidth,
  elevation,
  focus,
  motion,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getAuthStore } from "../../lib/auth";
import { getServerSession } from "../../lib/server-session";

import { AppBrand, BottomNav, MobileNav, ShellNav, UserMenu } from "./shell-nav";

export const metadata = { title: "Aquarela Business Control" };

/**
 * Authenticated application shell (DEC-120; brief §5 layout, §6 navigation,
 * §17 mobile, §18 responsive). Server component: the session is resolved
 * server-side and an unauthenticated visitor is redirected before any shell
 * chrome renders.
 *
 * Visual direction: a light, quiet application frame — no large dark block.
 * A slim light rail with hairline separation carries the primary navigation on
 * desktop; at tablet width it compresses to an icon-only rail; on phones the
 * rail gives way to a floating bottom navigation for the core sections while
 * the drawer keeps the full set. Shell-level search and scope controls are not
 * rendered: no real read exists for them yet (see the note above `AppLayout`).
 */
export const dynamic = "force-dynamic";

/** The few rules inline styles cannot express: media queries, hover/focus
 * states and the `<details>`/`<summary>` reset. Token-derived, no external
 * stylesheet. The `!important` flags on hover exist only because they must
 * beat the package's generic `.aquarela-nav-item:hover` rule (which is itself
 * `!important`); the nav rows themselves now carry the light DEC-129 sidebar
 * contract inline, so no surface re-seating is needed. */
const shellCss = `
.aq-shell {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
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
/* -------------------------------- Skip link -------------------------------- */
.aq-skip-link {
  position: fixed;
  top: ${spacing[3]}px;
  left: ${spacing[3]}px;
  z-index: 100;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 ${spacing[4]}px;
  background-color: ${color.surface.strong};
  border: 1px solid ${color.border.default};
  border-radius: ${radius.sm}px;
  color: ${color.text.primary};
  font-size: ${typography.fontSize.sm}px;
  font-weight: ${typography.fontWeight.medium};
  text-decoration: none;
  box-shadow: ${elevation.md};
  /* Hidden until focused; visible focus is mandatory (§19, audit fix). */
  transform: translateY(-200%);
}
.aq-skip-link:focus-visible {
  transform: none;
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: ${focus.ringOffset}px;
}
/* ------------------------------ Light left rail ----------------------------- */
.aq-sidebar {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: ${color.surface.base};
  border-right: 1px solid ${color.border.subtle};
  color: ${color.text.primary};
  overflow: hidden;
}
.aq-sidebar-nav { flex: 1 1 auto; overflow-y: auto; }
/* Nav rows carry the light sidebar contract inline (DEC-129: lavender active
 * surface, iris text and indicator); only hover/focus need CSS. Hover keeps
 * !important to beat the package's generic dark-surface hover rule. */
.aq-sidebar .aquarela-nav-item:hover:not([aria-current="page"]),
.aq-drawer .aquarela-nav-item:hover:not([aria-current="page"]) {
  color: ${color.ink.primary} !important;
  background-color: ${color.surface.muted} !important;
}
.aq-sidebar .aquarela-nav-item:focus-visible,
.aq-drawer .aquarela-nav-item:focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: -${focus.ringOffset}px;
}
.aq-brand {
  display: flex;
  align-items: center;
  gap: ${spacing[3]}px;
  padding: ${spacing[5]}px ${spacing[4]}px;
  color: ${color.text.primary};
  text-decoration: none;
}
.aq-brand:focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: -${focus.ringOffset}px;
}
.aq-brand-name {
  display: flex;
  flex-direction: column;
  font-family: ${typography.fontFamily.display};
  font-size: ${typography.fontSize.xl}px;
  font-weight: ${typography.fontWeight.semibold};
  line-height: ${typography.lineHeight.tight};
  color: ${color.text.primary};
}
.aq-brand-sub {
  margin-top: 2px;
  font-family: ${typography.fontFamily.sans};
  font-size: 10px;
  font-weight: ${typography.fontWeight.medium};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${color.text.muted};
}
.aq-sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: ${spacing[1]}px;
  padding: ${spacing[4]}px;
  border-top: 1px solid ${color.border.subtle};
  font-size: ${typography.fontSize.xs}px;
  color: ${color.text.secondary};
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
  padding: ${spacing[3]}px ${spacing[8]}px;
  background-color: ${color.background.page};
  border-bottom: 1px solid ${color.border.subtle};
}
.aq-menu-button { order: 1; display: none; }
.aq-topbar-end { order: 2; display: flex; align-items: center; gap: ${spacing[3]}px; margin-left: auto; }
/* ------------------------------- User menu --------------------------------- */
.aq-user { position: relative; }
.aq-user-summary:focus-visible,
.aq-user-item:focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: ${focus.ringOffset}px;
}
.aq-user-summary {
  display: inline-flex;
  align-items: center;
  gap: ${spacing[2]}px;
  min-height: 44px;
  padding: ${spacing[1]}px ${spacing[3]}px ${spacing[1]}px ${spacing[1]}px;
  background-color: ${color.surface.base};
  border: 1px solid ${color.border.subtle};
  border-radius: ${radius.md}px;
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
  background-color: ${color.surface.muted};
  border: 1px solid ${color.border.subtle};
  color: ${color.text.primary};
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
  background-color: ${color.surface.strong};
  border: 1px solid ${color.border.subtle};
  border-radius: ${radius.lg}px;
  box-shadow: ${elevation.lg};
}
.aq-user-meta {
  margin: 0;
  padding: ${spacing[1]}px ${spacing[3]}px;
  font-size: ${typography.fontSize.xs}px;
  color: ${color.text.secondary};
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
.aq-user-item:hover { background-color: ${color.surface.muted}; }
.aq-user-item:disabled { opacity: 0.6; cursor: not-allowed; }
/* --------------------------------- Canvas ---------------------------------- */
.aq-canvas {
  box-sizing: border-box;
  flex: 1 1 auto;
  width: 100%;
  max-width: ${containerWidth.default}px;
  margin: 0 auto;
  padding: ${spacing[10]}px ${spacing[8]}px ${spacing[16]}px;
}
/* The skip link moves focus to the canvas. A keyboard-initiated skip keeps the
 * 3px ring (the package's [tabindex]:focus-visible rule); a pointer click on
 * the skip target must not leave a ring artifact. */
.aq-canvas:focus:not(:focus-visible) { outline: none; }
/* --------------------------- Mobile bottom navigation ----------------------- */
/* Compact floating bottom navigation for the core sections (brief §6 mobile,
 * §17); the drawer keeps the full set. Hidden at tablet width and above. */
.aq-bottomnav {
  position: fixed;
  left: ${spacing[4]}px;
  right: ${spacing[4]}px;
  bottom: calc(${spacing[3]}px + env(safe-area-inset-bottom, 0px));
  z-index: 30;
  display: none;
  justify-content: space-around;
  padding: ${spacing[1]}px;
  background-color: ${color.surface.strong};
  border: 1px solid ${color.border.subtle};
  border-radius: ${radius["2xl"]}px;
  box-shadow: ${elevation.md};
}
.aq-bottomnav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1 1 0;
  min-height: 52px;
  min-width: 44px;
  padding: ${spacing[1]}px ${spacing[1]}px;
  border-radius: ${radius.xl}px;
  color: ${color.text.secondary};
  font-size: ${typography.fontSize["2xs"]}px;
  text-decoration: none;
  transition: color ${motion.duration.fast}ms ${motion.easing},
    background-color ${motion.duration.fast}ms ${motion.easing};
}
.aq-bottomnav-item[aria-current="page"] {
  color: ${color.accent.deep};
  background-color: ${color.accent.soft};
}
.aq-bottomnav-item:focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: -${focus.ringOffset}px;
}
/* ------------------------------ Mobile drawer ------------------------------ */
.aq-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  padding: 0;
  border: 0;
  background-color: rgba(23, 25, 24, 0.45);
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
  background-color: ${color.surface.base};
  border-right: 1px solid ${color.border.subtle};
  color: ${color.text.primary};
  box-shadow: ${elevation.lg};
  animation: aq-drawer-in ${motion.duration.base}ms ${motion.easing};
}
@keyframes aq-drawer-in {
  from { opacity: 0; transform: translateX(-${spacing[2]}px); }
  to { opacity: 1; transform: none; }
}
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
  color: ${color.text.primary};
  cursor: pointer;
}
.aq-close-button:focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: -${focus.ringOffset}px;
}
/* ------------------------------- Breakpoints ------------------------------- */
/* Composition changes at the token breakpoints (brief §18): labelled rail at
 * desktop, icon-only rail at tablet, bottom navigation + drawer on phones. */
@media (max-width: ${breakpoint.desktop - 1}px) {
  .aq-shell { grid-template-columns: 64px minmax(0, 1fr); }
  .aq-brand { justify-content: center; padding: ${spacing[4]}px 0; }
  .aq-brand-name { display: none; }
  .aq-sidebar-footer { display: none; }
  .aq-sidebar .aquarela-nav-item {
    justify-content: center;
    padding: ${spacing[2]}px 0 !important;
    border-left-color: transparent !important;
  }
  .aq-sidebar .aquarela-nav-item span:last-child { display: none; }
  .aq-topbar { padding: ${spacing[3]}px ${spacing[5]}px; }
  .aq-canvas { padding: ${spacing[8]}px ${spacing[6]}px ${spacing[12]}px; }
}
@media (max-width: ${breakpoint.tablet - 1}px) {
  .aq-shell { grid-template-columns: minmax(0, 1fr); }
  .aq-sidebar { display: none; }
  .aq-menu-button { display: inline-flex; }
  .aq-bottomnav { display: flex; }
  .aq-topbar { padding: ${spacing[3]}px ${spacing[4]}px; }
  .aq-canvas { padding: ${spacing[6]}px ${spacing[4]}px calc(${spacing[24]}px + env(safe-area-inset-bottom, 0px)); }
}
@media (prefers-reduced-motion: reduce) {
  .aq-drawer { animation: none; }
  .aq-skip-link { transition: none; }
}
`;

/** Search affordance removed (2026-09-25): no real query surface exists in
 * `packages/application`, so a read-only input would only pretend to work
 * (08_UI_UX.md §4: say honestly what is missing — by not offering it at all).
 * The shell scope placeholders were removed for the same reason: `listLocations`
 * is a per-slice option list, not a shell scope control, and no company/date
 * scope read or scope state exists that screens honour. Screens show their own
 * period and scope (§8.4); the `ScopeBar` primitive remains for screens and
 * the styleguide. */

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
      <a href="#main-content" className="aq-skip-link">
        Skip to content
      </a>
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
          <div className="aq-topbar-end">
            <UserMenu label={profileLabel} fallback={session.id} />
          </div>
        </header>
        <main id="main-content" className="aq-canvas" tabIndex={-1}>
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
