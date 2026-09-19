/**
 * Design tokens for the Aquarela Business Controller (08_UI_UX.md §8.7).
 * Framework-agnostic values only: no components, no CSS, no fonts downloaded.
 */

/** Brand palette: cream background, dark navy navigation, berry for
 * commercial/important data, green for healthy state, muted gold for review. */
export const color = {
  brand: {
    /** Page background cream (§8.7). */
    cream: "#faf6ef",
    /** Dark navy for navigation and high-contrast text (§8.7). */
    navy: "#16243d",
    /** Deeper navy for pressed/hover states on navigation. */
    navyDeep: "#0e1830",
    /** Berry for commercial/important data (§8.7). */
    berry: "#8e2a4f",
    /** Green for healthy operational state (§8.7). */
    green: "#134e30",
    /** Muted gold for review/attention (§8.7) — text-safe dark gold. */
    gold: "#8c6421",
    /** Lighter gold for accents, badges and backgrounds only (not text). */
    goldSoft: "#b07c1f",
  },
  background: {
    page: "#faf6ef",
    surface: "#ffffff",
    /** Alternate surface for zebra rows and secondary cards. */
    surfaceAlt: "#f3ede1",
    /** Inset wells (inputs, code, table headers). */
    inset: "#efe8db",
  },
  navigation: {
    background: "#16243d",
    backgroundHover: "#0e1830",
    text: "#faf6ef",
    textMuted: "#b9c3d6",
    active: "#b07c1f",
  },
  text: {
    primary: "#212b36",
    secondary: "#4a5568",
    muted: "#6b7280",
    onNavy: "#faf6ef",
    onNavyMuted: "#b9c3d6",
    inverse: "#ffffff",
  },
  border: {
    subtle: "#e5ddcd",
    default: "#d3c9b6",
    strong: "#a89c86",
    focus: "#1d5fa8",
  },
  /** Semantic status mapped onto the brand colours (§8.7: green healthy,
   * muted gold review, plus danger and info). Foregrounds meet AA as text
   * on cream and white; backgrounds are tinted washes. */
  status: {
    success: { fg: "#134e30", bg: "#e2f0e7", border: "#134e30" },
    warning: { fg: "#8c6421", bg: "#f6ecd4", border: "#b07c1f" },
    danger: { fg: "#620f17", bg: "#f9e3e1", border: "#620f17" },
    info: { fg: "#215a8b", bg: "#e2ecf7", border: "#215a8b" },
  },
  /** Data-visualization palettes. Categorical colours are each ≥3:1 against
   * white (WCAG non-text contrast for chart elements) and pairwise
   * distinguishable. Sequential ramps are monotonic in luminance. */
  dataViz: {
    categorical: [
      "#16243d", // navy
      "#8e2a4f", // berry
      "#134e30", // green
      "#b07c1f", // gold
      "#083a3a", // deep teal
      "#7a57b5", // plum
      "#647995", // slate blue
      "#944507", // burnt orange
    ],
    sequential: {
      navy: ["#e8eef7", "#b9cbe4", "#7c9cc6", "#43689b", "#1b3a63"],
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

/** Typography. Expressive serif for page titles, readable sans for
 * controls/tables (§8.7). System stacks only — no font downloads. */
export const typography = {
  fontFamily: {
    display: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
  fontSize: {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 38,
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.65,
  },
} as const;

/** Corner radius scale in pixels. */
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

/** Elevation shadows, tuned for cream surfaces. */
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgba(22, 36, 61, 0.08)",
  md: "0 2px 6px rgba(22, 36, 61, 0.10), 0 1px 2px rgba(22, 36, 61, 0.06)",
  lg: "0 8px 24px rgba(22, 36, 61, 0.14), 0 2px 6px rgba(22, 36, 61, 0.08)",
} as const;

/** The full token set. */
export const TOKENS = {
  color,
  spacing,
  typography,
  radius,
  elevation,
} as const;
