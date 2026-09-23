/**
 * Design tokens for the Aquarela Business Controller.
 *
 * Direction: `designer-agent-modern-saas-ui-brief.md` (modern editorial SaaS),
 * superseding 08_UI_UX.md §8.7 (recorded as DEC-120). Framework-agnostic
 * values only: no components, no CSS, no fonts downloaded.
 *
 * Legacy names (`color.brand.*`, `color.background.*`, `color.text.*`,
 * `color.border.*`, `color.navigation.*`, `color.status.*`, `color.dataViz.*`)
 * remain exported because ~86 files consume them. Their values have been
 * re-tuned to the new palette; where the legacy name would be dishonest
 * (e.g. `brand.cream` is no longer cream) the name aliases the new semantic
 * token instead of keeping a stale value.
 */

/** Semantic surface tiers (brief §3, §7): airy neutral canvas, tonal
 * surfaces, and inset wells — no decorative gradients. */
export const color = {
  surface: {
    /** Page canvas. */
    canvas: "#F5F6F4",
    /** Default card/panel surface, one step above the canvas. */
    base: "#FAFAF8",
    /** Strongest surface (popovers, elevated panels). */
    strong: "#FFFFFF",
    /** Muted tonal surface for zebra rows and secondary zones. */
    muted: "#ECEFEC",
    /** Inset wells (inputs, code, table headers). */
    well: "#E7EBE8",
  },
  /** Text tiers (brief §3). */
  ink: {
    primary: "#171918",
    secondary: "#656A67",
    /** Metadata text tier. Darkened from #878C88 (3.2:1) so it meets WCAG
     * 1.4.3 (≥4.5:1) as text at 11–13px on every surface tier; the step
     * above `secondary` is now subtle — compliance was preferred over a
     * wide tonal gap. */
    tertiary: "#6C716D",
  },
  /** One acid/lime accent family used sparingly (brief §3, §22 item 6),
   * plus at most one secondary accent (pale blue). `accent`/`soft` are
   * surfaces and marks only — never text. `deep` is the text-safe accent
   * (AA on canvas/surface/strong); `ink` is legible on the accent. */
  accent: {
    accent: "#DFFF55",
    /** Active-surface tint (Tabs/SegmentedControl/FilterChip/nav). Darkened
     * from #F0F8C9, which sat at 1.06:1 on surface.base and made the active
     * state rest entirely on the 1px inset border. */
    soft: "#DCEF98",
    ink: "#20240F",
    deep: "#5A6B0A",
    secondary: "#A8CBE4",
    secondaryDeep: "#2E5E80",
  },
  brand: {
    /** Legacy name, now an alias of the warm-neutral canvas (§3 `--bg`). */
    cream: "#F5F6F4",
    /** Legacy name, now the dark neutral ink used for navigation and
     * high-contrast text (§3 `--text-primary`). */
    navy: "#171918",
    /** Deeper neutral for pressed/hover states on navigation. */
    navyDeep: "#0D0F0E",
    /** Muted berry for commercial/important data. */
    berry: "#8E2A4F",
    /** Muted green for healthy operational state. */
    green: "#134E30",
    /** Muted gold for review/attention — text-safe dark gold. */
    gold: "#8C6421",
    /** Lighter gold for accents, badges and backgrounds only (not text). */
    goldSoft: "#B07C1F",
  },
  background: {
    page: "#F5F6F4",
    surface: "#FAFAF8",
    /** Alternate surface for zebra rows and secondary cards. */
    surfaceAlt: "#ECEFEC",
    /** Inset wells (inputs, code, table headers). */
    inset: "#E7EBE8",
  },
  navigation: {
    background: "#171918",
    backgroundHover: "#0D0F0E",
    text: "#F5F6F4",
    textMuted: "#A8B0AB",
    /** Selected navigation accent: the lime accent on dark neutral. */
    active: "#DFFF55",
  },
  text: {
    primary: "#171918",
    secondary: "#656A67",
    muted: "#6B706C",
    onNavy: "#F5F6F4",
    onNavyMuted: "#A8B0AB",
    inverse: "#FFFFFF",
  },
  /** Thin subtle separators, no thick borders (brief §3, §7). */
  border: {
    subtle: "#E4E8E5",
    default: "#D6DAD7",
    strong: "#C3C9C5",
    focus: "#2E6FA3",
  },
  /** Semantic status: muted tints and small indicators, never saturated
   * blocks (brief §3). Structure `{fg,bg,border}` is load-bearing for
   * StatusPill. */
  status: {
    success: { fg: "#134e30", bg: "#e2f0e7", border: "#134e30" },
    warning: { fg: "#8c6421", bg: "#f6ecd4", border: "#b07c1f" },
    danger: { fg: "#620f17", bg: "#f9e3e1", border: "#620f17" },
    info: { fg: "#215a8b", bg: "#e2ecf7", border: "#215a8b" },
  },
  /** Data-visualization palettes (brief §10): muted, staggered in
   * luminance, no rainbow. Categorical colours are each ≥3:1 against the
   * surfaces (WCAG 1.4.11) and pairwise distinguishable. Sequential ramps
   * are monotonic in luminance. */
  dataViz: {
    /** Pale neutral for comparison series (brief §10). A dedicated token,
     * ≥3:1 against the surface tiers (WCAG 1.4.11) because the comparison
     * series carries real information; still clearly secondary to the
     * accent series. */
    comparison: "#838984",
    categorical: [
      "#1E2321", // dark neutral
      "#083A3A", // deep teal
      "#134E30", // green
      "#8E2A4F", // berry
      "#8F4A18", // muted terracotta
      "#7A5CA8", // muted plum
      "#647995", // slate blue
      "#B07C1F", // muted gold
    ],
    sequential: {
      /** Neutral ink ramp. */
      navy: ["#E9EBEA", "#C2C7C4", "#989E9A", "#676D69", "#343836"],
      berry: ["#f6e4ea", "#dca9b8", "#bc6e8b", "#93365c", "#5c1b36"],
    },
  },
} as const;

/** Spacing scale in pixels, 4px base unit. Keys are scale steps. */
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
 * Typography (brief §4): one geometric/humanist sans for everything,
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
    "3xl": 30,
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
    /** Tight display line-height for large statements (brief §4). */
    display: 1.1,
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.65,
  },
  /** Tabular-numeric affordance for figures (KPIs, tables). */
  fontVariantNumeric: {
    tabular: "tabular-nums",
  },
} as const;

/** Corner radius scale in pixels (brief §7: 16–24px modules). */
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
  "3xl": 24,
  pill: 999,
} as const;

/** Border widths (brief §7: thin, subtle). */
export const borderWidth = {
  none: 0,
  hairline: 1,
  medium: 2,
} as const;

/** Elevation: none or extremely soft (brief §7). */
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgba(23, 25, 24, 0.06)",
  /** Extremely soft panel elevation for feature modules. */
  panel: "0 1px 2px rgba(23, 25, 24, 0.05), 0 2px 8px rgba(23, 25, 24, 0.04)",
  md: "0 2px 6px rgba(23, 25, 24, 0.08), 0 1px 2px rgba(23, 25, 24, 0.05)",
  lg: "0 8px 24px rgba(23, 25, 24, 0.12), 0 2px 6px rgba(23, 25, 24, 0.06)",
} as const;

/** Icon sizes (brief §20: mostly 16–20px in UI). */
export const iconSize = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
} as const;

/** Container widths (brief §5). */
export const containerWidth = {
  /** Narrow form/working width. */
  narrow: 760,
  /** Default desktop working width. */
  default: 1440,
  /** Wide analytical width. */
  wide: 1600,
} as const;

/** 12-column grid definition (brief §5). */
export const grid = {
  columns: 12,
  gutter: 24,
  margin: 32,
} as const;

/** Responsive breakpoints (brief §18). */
export const breakpoint = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  large: 1600,
} as const;

/** Animation timing (brief §19: 120–220 ms, restrained). */
export const motion = {
  duration: {
    fast: 120,
    base: 160,
    slow: 220,
  },
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/** The full token set. */
export const TOKENS = {
  color,
  spacing,
  typography,
  radius,
  borderWidth,
  elevation,
  iconSize,
  containerWidth,
  grid,
  breakpoint,
  motion,
} as const;
