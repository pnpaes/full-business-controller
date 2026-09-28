/**
 * Design tokens for the Aquarela Business Controller.
 *
 * Direction: the Aquarela backoffice design system v0.1.0
 * (`docs/aquarela-design-system/`), recorded as DEC-129. It supersedes the
 * palette and typography of `designer-agent-modern-saas-ui-brief.md`
 * (DEC-120) but NOT that brief's intent or any accessibility rule: the
 * WCAG 2.2 AA acceptance, the 44px touch targets and the token architecture
 * all carry over unchanged.
 *
 * The design system ships Tailwind class recipes and a shadcn theme block.
 * Neither applies here — this repository has no Tailwind, no CSS files and
 * no shadcn, by DEC-120 — so the *values* were merged instead:
 * `docs/aquarela-design-system/shadcn-theme.css` (its canonical colour
 * authority), `tokens.json` and `component-recipes.ts`. The structure of
 * this file is unchanged, which is what keeps ~86 consumer files and
 * `tokens.test.ts` working.
 *
 * Framework-agnostic values only: no components, no CSS, no fonts
 * downloaded.
 *
 * Font: the design system's prose says Inter, but the package itself ships
 * `fonts/manrope-*.ttf` with `fonts.css` declaring Manrope, and this app
 * already self-hosts Manrope through `next/font`. Manrope is retained until
 * the prose/assets contradiction is resolved — see DEC-129.
 *
 * Legacy names (`color.brand.*`, `color.background.*`, `color.text.*`,
 * `color.border.*`, `color.navigation.*`, `color.status.*`, `color.dataViz.*`)
 * remain exported because ~86 files consume them. Their values have been
 * re-tuned to the new palette; where the legacy name would be dishonest
 * (e.g. `brand.cream` is no longer cream) the name aliases the new semantic
 * token instead of keeping a stale value.
 *
 * Two values are derived rather than taken from the design system, because
 * it supplies only the decorative `border` and the control border:
 * `border.default` (the middle separator tier) and `brand.navyDeep` (a
 * pressed/hover step below `primary`). Both are marked inline.
 *
 * Correction (2026-09-24, after DEC-129 was first recorded): the live shell
 * is ALREADY a light rail. `apps/web/app/(app)/layout.tsx` re-seats the
 * frozen `NavList`/`NavItem` primitives onto it with
 * `background-color: transparent !important`, so `navigation.background`
 * and `navigation.backgroundHover` are dead for the rail and
 * `brand.navyDeep` has no live consumer there. The design system's light
 * sidebar is therefore already satisfied structurally; the remaining shell
 * work is token alignment and retiring those frozen primitives, not a
 * dark-to-light conversion.
 */

/** Semantic surface tiers (design system "Color contract"): a cool neutral
 * canvas, white panels, and quiet muted fills — no decorative gradients. */
export const color = {
  surface: {
    /** Page canvas — design system `background` #F1F3F8. */
    canvas: "#F1F3F8",
    /** Default card/panel surface — design system `card` #FFFFFF. */
    base: "#FFFFFF",
    /** Strongest surface (popovers, elevated panels) — `popover` #FFFFFF. */
    strong: "#FFFFFF",
    /** Muted tonal surface for zebra rows and secondary zones — `muted` #F8F9FC. */
    muted: "#F8F9FC",
    /** Inset wells (table headers, code) — the `muted` tier, which the
     * component recipes use for `tableHead` (`bg-muted`). Inputs are white
     * now (`bg-card`), not wells. */
    well: "#F8F9FC",
  },
  /** Text tiers (design system "Color contract"). */
  ink: {
    /** Main text — design system `foreground` #151A2D. */
    primary: "#151A2D",
    /** Secondary text — design system `secondary-foreground` #353C50. */
    secondary: "#353C50",
    /** Metadata text tier — design system `muted-foreground` #626B7E,
     * certified by the package at 5.35:1 on card, 4.82:1 on background and
     * 4.61:1 on accent, so it holds AA (4.5:1) at 11–13px on every surface
     * tier. */
    tertiary: "#626B7E",
  },
  /** Brand accent family (design system "Iris"): a saturated violet for
   * focus, selection and the primary chart series, with its lavender soft
   * surface. `accent`/`soft` are surfaces and marks only — never text.
   * `deep` is the text-safe violet (certified 7.26:1 on card, 6.54:1 on
   * background); `ink` is legible on the violet. */
  accent: {
    accent: "#5742BA",
    /** Active-surface tint (Tabs/SegmentedControl/FilterChip/nav) —
     * design system `accent` / `brand-soft` #EEECFF. */
    soft: "#EEECFF",
    /** Text on the violet — design system `brand-foreground` #FFFFFF. */
    ink: "#FFFFFF",
    /** Text-safe violet — the same iris, certified AA as text on the
     * surface tiers. */
    deep: "#5742BA",
    /** Secondary accent, pale surface — design system `info` #EAF1FF. */
    secondary: "#EAF1FF",
    /** Text-safe secondary accent — design system `info-foreground` #315FAA. */
    secondaryDeep: "#315FAA",
  },
  brand: {
    /** Legacy name, now an alias of the cool neutral canvas. */
    cream: "#F1F3F8",
    /** Legacy name, now the dark neutral ink used for navigation and
     * high-contrast text — design system `primary` #151A2D. */
    navy: "#151A2D",
    /** Deeper neutral for pressed/hover states on navigation.
     * ponytail: DERIVED (not in the design system). Effectively dead for the
     * live rail, which is light and CSS-overridden — see the file header. */
    navyDeep: "#0C0F1C",
    /** Muted plum for commercial/important data — design system `chart-5`. */
    berry: "#80518F",
    /** Muted green for healthy operational state — `success-foreground`. */
    green: "#256442",
    /** Muted gold for review/attention, text-safe — `warning-foreground`. */
    gold: "#80550C",
    /** Lighter gold for accents, badges and backgrounds only (not text) —
     * design system `warning` surface #FFF3D9. */
    goldSoft: "#FFF3D9",
  },
  background: {
    page: "#F1F3F8",
    surface: "#FFFFFF",
    /** Alternate surface for zebra rows and secondary cards. */
    surfaceAlt: "#F8F9FC",
    /** Inset wells (table headers, code). */
    inset: "#F8F9FC",
  },
  navigation: {
    /** DEAD for the live rail: the shell is already light, and
     * `apps/web/app/(app)/layout.tsx` overrides this background with
     * `transparent !important` when it re-seats the frozen nav primitives.
     * Retained only for those frozen primitives and the styleguide. The
     * design system's own sidebar is white with a lavender active surface,
     * which the live shell already matches — see the file header. */
    background: "#151A2D",
    backgroundHover: "#0C0F1C",
    text: "#FFFFFF",
    textMuted: "#858DA0",
    /** Selected navigation accent — design system `brand-soft` #EEECFF,
     * which stays legible on the dark shell (the saturated iris would not). */
    active: "#EEECFF",
  },
  text: {
    primary: "#151A2D",
    secondary: "#353C50",
    muted: "#626B7E",
    onNavy: "#FFFFFF",
    onNavyMuted: "#858DA0",
    inverse: "#FFFFFF",
  },
  /** Thin subtle separators, no thick borders. `subtle` is the design
   * system's decorative `border` #E5E8F0; `strong` is its control boundary
   * `input` #858DA0 ("use the stronger input border where the boundary
   * identifies a control"). */
  border: {
    subtle: "#E5E8F0",
    /** ponytail: DERIVED middle tier — the design system supplies only the
     * decorative border and the control border. */
    default: "#D6DAE4",
    strong: "#858DA0",
    /** Focus ring — design system `ring` #5742BA, certified 7.26:1 on card
     * and 6.54:1 on background. */
    focus: "#5742BA",
  },
  /** Semantic status: the design system's four hue families, retuned in
   * lightness only. Structure `{fg,bg,border}` is load-bearing for
   * StatusPill.
   *
   * DEVIATION from the design system's exact values, driven by gates this
   * repo already enforced before DEC-129: its four status foregrounds sit
   * within 1.005–1.12:1 of each other, failing the pairwise
   * distinguishability assertion (≥1.3:1), and its washes sit 1.008–1.021
   * from its own page canvas, failing the wash-separation assertion
   * (>1.05:1). Both gates protect legibility, so the values below keep each
   * hue and spread the luminances instead. Every pair is re-derived in
   * `tokens.test.ts` and each is AA on its wash and on white. */
  status: {
    success: { fg: "#102B1C", bg: "#E2EFE9", border: "#102B1C" },
    warning: { fg: "#523608", bg: "#F6EBD5", border: "#523608" },
    danger: { fg: "#922931", bg: "#F8E8E9", border: "#922931" },
    info: { fg: "#3865AD", bg: "#E5ECFB", border: "#3865AD" },
  },
  /** Data-visualization palettes: the product's established 8-colour ladder
   * with the design system's neutral comparison grey.
   *
   * DEVIATION: the design system's `chart-1`..`chart-5` are retained as
   * `accent.*`/`border.focus` (selection, focus, brand) but are NOT adopted
   * as the categorical series. Two independent reasons: no 8-colour set
   * containing the iris satisfies the pairwise ≥1.2:1 assertion (the best
   * achievable is 1.115, and the package's own chart-1 vs chart-3 is
   * 1.030), and `shell.tsx` indexes this array positionally with semantic
   * names (`navy`=0, `teal`=1, `green`=2, `berry`=3, `gold`=7), so its
   * length and order are load-bearing. Reordering or shortening it would
   * silently recolour named chart series.
   *
   * Categorical colours are each ≥3:1 against the surfaces (WCAG 1.4.11)
   * and pairwise distinguishable. Sequential ramps are monotonic in
   * luminance. */
  dataViz: {
    /** Pale neutral for comparison series — design system
     * `muted-foreground` #626B7E, ≥3:1 on the surface tiers because the
     * comparison series carries real information. */
    comparison: "#626B7E",
    categorical: [
      "#1E2321", // dark neutral (`navy` in shell.tsx)
      "#083A3A", // deep teal (`teal`)
      "#134E30", // green (`green`)
      "#8E2A4F", // berry (`berry`)
      "#8F4A18", // muted terracotta
      "#7A5CA8", // muted plum (`plum`)
      "#647995", // slate blue (`slate`)
      "#B07C1F", // muted gold (`gold`)
    ],
    sequential: {
      /** Cool neutral ink ramp. */
      navy: ["#EEF1F7", "#D3D8E4", "#A9B0C4", "#626B7E", "#353C50"],
      /** Violet ramp (legacy `berry` key, re-tinted to the iris family). */
      berry: ["#F0EDFF", "#CFC4F5", "#A695E8", "#7A63D0", "#4A3596"],
    },
  },
} as const;

/** Spacing scale in pixels, 4px base unit. Keys are scale steps. Matches the
 * design system's 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 scale. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/**
 * Typography (design system "Typography"): one sans for everything,
 * hierarchy from size/position/spacing rather than heavy bold.
 *
 * Font decision: the app layout defines `--font-sans` via `next/font`
 * (Manrope) on `<html>`, so `sans` and `display` use the `sansVar` stack and
 * fall back to the system stack if the variable is absent.
 */
export const typography = {
  fontFamily: {
    display:
      'var(--font-sans), system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    sans: 'var(--font-sans), system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    /** Webfont-ready stack: the app layout defines `--font-sans` via
     * `next/font` (see the file comment). No URL, so it stays
     * download-free at the token level. `var()` must stay UNQUOTED —
     * inside quotes it is a literal (non-existent) family name and the
     * webfont silently never applies. */
    sansVar:
      'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  fontSize: {
    "2xs": 11,
    xs: 12,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 20,
    "2xl": 24,
    /** Page heading — design system "Page heading" 32 / 38. */
    "3xl": 32,
    "4xl": 40,
    "5xl": 48,
    "6xl": 56,
  },
  fontWeight: {
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    /** Tight display line-height for large statements. */
    display: 1.1,
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.65,
  },
  /** Tabular-numeric affordance for figures (KPIs, tables, money). The
   * design system requires tabular figures for money, stock and aligned
   * metrics. */
  fontVariantNumeric: {
    tabular: "tabular-nums",
  },
} as const;

/** Corner radius scale in pixels (design system "Radii": 6px small nested
 * surface, 10px button/input/popover, 16px card, 24px dialog). */
export const radius = {
  none: 0,
  /** Small nested surface — 6px. */
  sm: 6,
  /** Button / input / popover — 10px. */
  md: 10,
  /** Card — 16px. */
  lg: 16,
  /** Dialog — 24px. */
  xl: 24,
  "2xl": 20,
  "3xl": 24,
  pill: 999,
} as const;

/** Border widths (thin, subtle). */
export const borderWidth = {
  none: 0,
  hairline: 1,
  medium: 2,
} as const;

/** Control geometry (design system "Component contract" and
 * `component-recipes.ts` sizes): 40px default control, 32px compact, 48px
 * large, 56px table row with a 40px compact row, and a 44px minimum touch
 * target for the counter-tablet context. */
export const geometry = {
  controlHeight: {
    sm: 32,
    md: 40,
    lg: 48,
  },
  tableRowHeight: {
    default: 56,
    compact: 40,
  },
  tableHeaderHeight: 40,
  /** WCAG 2.2 target size / design system tablet requirement. */
  touchTarget: 44,
} as const;

/** Focus treatment (design system "Accessibility acceptance"): a 3px solid
 * iris ring with a 2px gap, never an opacity-modified ring. */
export const focus = {
  ringWidth: 3,
  ringOffset: 2,
  ringColor: "#5742BA",
} as const;

/** Elevation: none or extremely soft. Resting panels have 1px borders and
 * no shadow; menus use a soft shadow and dialogs stronger elevation. */
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgba(21, 26, 45, 0.06)",
  /** Extremely soft panel elevation for feature modules. */
  panel: "0 1px 2px rgba(21, 26, 45, 0.05), 0 2px 8px rgba(21, 26, 45, 0.04)",
  md: "0 2px 6px rgba(21, 26, 45, 0.08), 0 1px 2px rgba(21, 26, 45, 0.05)",
  lg: "0 8px 24px rgba(21, 26, 45, 0.12), 0 2px 6px rgba(21, 26, 45, 0.06)",
} as const;

/** Icon sizes (mostly 16–20px in UI). */
export const iconSize = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
} as const;

/** Container widths. The design system proposes a sensible content max of
 * 1440px. */
export const containerWidth = {
  /** Narrow form/working width. */
  narrow: 760,
  /** Default desktop working width. */
  default: 1440,
  /** Wide analytical width. */
  wide: 1600,
} as const;

/** 12-column grid definition. */
export const grid = {
  columns: 12,
  gutter: 24,
  margin: 32,
} as const;

/** Responsive breakpoints. The design system's table adds 1024 (collapse
 * navigation) and 1280 (expanded, 3–4 metrics) to the existing set. */
export const breakpoint = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  large: 1600,
} as const;

/** Animation timing (design system: 120ms hover, 180ms panel transition;
 * no bouncing or dramatic scaling). */
export const motion = {
  duration: {
    fast: 120,
    base: 180,
    slow: 220,
  },
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/* ------------------------------------------------------------------------- *
 * Wave 0 semantic layer (2026-09-28, `docs/ux/README.md`).
 *
 * Additive only: every legacy token and value above is unchanged, so the ~86
 * consumer files and the contrast gates (`tokens.test.ts`) keep passing. The
 * tokens below name the *roles* the UX contract asks for — a precise type
 * scale, a 4/8pt spacing rhythm, radius/elevation roles and the single-accent
 * policy — so screens stop inventing one-off sizes and shadows.
 * ------------------------------------------------------------------------- */

/**
 * The type scale by role. Each role picks an existing `typography.fontSize`
 * step, so the scale can never drift from the raw tokens. Use these instead of
 * choosing a px size per screen:
 *
 * - `display` — a full-page statement (rare; never inside a table).
 * - `hero` — the one hero metric per screen (`MetricHero`).
 * - `title` — the page heading (`PageHeader`).
 * - `section` — a section/panel heading.
 * - `body` — body copy and table content.
 * - `label` — control labels, column headers, chips.
 * - `caption` — metadata, help text, axis labels.
 * - `micro` — the smallest metadata tier (timestamps, badges).
 */
export const typeScale = {
  display: {
    fontSize: typography.fontSize["5xl"],
    lineHeight: typography.lineHeight.display,
    fontWeight: typography.fontWeight.regular,
  },
  hero: {
    fontSize: typography.fontSize["4xl"],
    lineHeight: typography.lineHeight.display,
    fontWeight: typography.fontWeight.regular,
  },
  title: {
    fontSize: typography.fontSize["3xl"],
    lineHeight: typography.lineHeight.tight,
    fontWeight: typography.fontWeight.medium,
  },
  section: {
    fontSize: typography.fontSize.xl,
    lineHeight: typography.lineHeight.tight,
    fontWeight: typography.fontWeight.medium,
  },
  body: {
    fontSize: typography.fontSize.md,
    lineHeight: typography.lineHeight.normal,
    fontWeight: typography.fontWeight.regular,
  },
  label: {
    fontSize: typography.fontSize.sm,
    lineHeight: typography.lineHeight.normal,
    fontWeight: typography.fontWeight.medium,
  },
  caption: {
    fontSize: typography.fontSize.xs,
    lineHeight: typography.lineHeight.normal,
    fontWeight: typography.fontWeight.regular,
  },
  micro: {
    fontSize: typography.fontSize["2xs"],
    lineHeight: typography.lineHeight.normal,
    fontWeight: typography.fontWeight.regular,
  },
} as const;

/**
 * The spacing rhythm by role, in the 4/8pt grid (`spacing`). Every value is a
 * multiple of 4; adjacent steps pair 4 with 8. Prefer these names over raw
 * `spacing[n]` so the rhythm is reviewable:
 *
 * - `hairline` (4) — inside a control, between a label and its value.
 * - `base` (8) — between related inline items.
 * - `tight` (12) — between rows in a list.
 * - `stack` (16) — between fields in a group.
 * - `group` (24) — between groups inside a section.
 * - `section` (32) — between sections.
 * - `band` (40) — around an editorial section band.
 */
export const space = {
  hairline: spacing[1],
  base: spacing[2],
  tight: spacing[3],
  stack: spacing[4],
  group: spacing[6],
  section: spacing[8],
  band: spacing[10],
} as const;

/** Radius by role, aliasing the `radius` scale (control = 10, surface = 16, dialog = 24). */
export const radiusRole = {
  control: radius.md,
  surface: radius.lg,
  floating: radius.xl,
  dialog: radius.xl,
  pill: radius.pill,
} as const;

/** Elevation by role: resting panels are flat; only floating layers shadow. */
export const elevationRole = {
  resting: elevation.none,
  raised: elevation.sm,
  panel: elevation.panel,
  floating: elevation.md,
  dialog: elevation.lg,
} as const;

/**
 * Single-accent policy: the interface carries **one** accent (the iris), used
 * for focus, selection, active surfaces and the primary chart series. There is
 * no second brand hue — `secondary` is the lone permitted informational
 * companion, and semantic status colours are reserved for status only.
 */
export const accentPolicy = {
  accent: color.accent.accent,
  soft: color.accent.soft,
  ink: color.accent.ink,
  deep: color.accent.deep,
  /** The one permitted companion tint (informational, not a second brand). */
  secondary: color.accent.secondaryDeep,
  rule: "One accent per screen: iris for focus/selection/active; status colours for status only.",
} as const;

/** The full token set. */
export const TOKENS = {
  color,
  spacing,
  typography,
  radius,
  borderWidth,
  geometry,
  focus,
  elevation,
  iconSize,
  containerWidth,
  grid,
  breakpoint,
  motion,
} as const;
