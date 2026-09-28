import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";
import {
  TOKENS,
  accentPolicy,
  breakpoint,
  borderWidth,
  color,
  containerWidth,
  elevation,
  elevationRole,
  focus,
  geometry,
  iconSize,
  motion,
  radius,
  radiusRole,
  space,
  spacing,
  typeScale,
  typography,
} from "./tokens";

const AA_NORMAL = 4.5;
const AA_LARGE_OR_UI = 3;

/** Every text/background pair actually used in the UI, with the WCAG level
 * it must meet. If a pair fails, fix the token value — never this test. */
const textPairs: Array<{
  name: string;
  fg: string;
  bg: string;
  min: number;
}> = [
  {
    name: "body text on page cream",
    fg: color.text.primary,
    bg: color.background.page,
    min: AA_NORMAL,
  },
  {
    name: "body text on surface",
    fg: color.text.primary,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "secondary text on surface",
    fg: color.text.secondary,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "secondary text on cream",
    fg: color.text.secondary,
    bg: color.background.page,
    min: AA_NORMAL,
  },
  {
    name: "muted text on surface",
    fg: color.text.muted,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "nav text on navy",
    fg: color.navigation.text,
    bg: color.navigation.background,
    min: AA_NORMAL,
  },
  {
    name: "nav muted text on navy",
    fg: color.navigation.textMuted,
    bg: color.navigation.background,
    min: AA_NORMAL,
  },
  {
    name: "berry emphasis on cream",
    fg: color.brand.berry,
    bg: color.background.page,
    min: AA_NORMAL,
  },
  {
    name: "green status text on cream",
    fg: color.brand.green,
    bg: color.background.page,
    min: AA_NORMAL,
  },
  {
    name: "gold review text on cream",
    fg: color.brand.gold,
    bg: color.background.page,
    min: AA_NORMAL,
  },
  {
    name: "success text on success wash",
    fg: color.status.success.fg,
    bg: color.status.success.bg,
    min: AA_NORMAL,
  },
  {
    name: "warning text on warning wash",
    fg: color.status.warning.fg,
    bg: color.status.warning.bg,
    min: AA_NORMAL,
  },
  {
    name: "danger text on danger wash",
    fg: color.status.danger.fg,
    bg: color.status.danger.bg,
    min: AA_NORMAL,
  },
  {
    name: "info text on info wash",
    fg: color.status.info.fg,
    bg: color.status.info.bg,
    min: AA_NORMAL,
  },
  {
    name: "success text on surface",
    fg: color.status.success.fg,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "warning text on surface",
    fg: color.status.warning.fg,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "danger text on surface",
    fg: color.status.danger.fg,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  {
    name: "info text on surface",
    fg: color.status.info.fg,
    bg: color.background.surface,
    min: AA_NORMAL,
  },
  // New semantic tiers (brief §3): ink on the surface tiers, accent pairings.
  ...(["canvas", "base", "strong"] as const).flatMap((tier) => [
    {
      name: `ink primary on surface.${tier}`,
      fg: color.ink.primary,
      bg: color.surface[tier],
      min: AA_NORMAL,
    },
    {
      name: `ink secondary on surface.${tier}`,
      fg: color.ink.secondary,
      bg: color.surface[tier],
      min: AA_NORMAL,
    },
  ]),
  // ink.tertiary is used as text at 11–13px (PageHeader scope, breadcrumbs,
  // description-list terms, progress percentage, axis labels), so it must
  // meet full AA (4.5:1) on every surface it appears on.
  ...(["canvas", "base", "strong"] as const).map((tier) => ({
    name: `ink tertiary (metadata text) on surface.${tier}`,
    fg: color.ink.tertiary,
    bg: color.surface[tier],
    min: AA_NORMAL,
  })),
  {
    name: "accent ink on accent",
    fg: color.accent.ink,
    bg: color.accent.accent,
    min: AA_NORMAL,
  },
  ...(["canvas", "base", "strong", "soft"] as const).map((tier) => ({
    name: `accent deep (text-safe accent) on surface.${tier}`,
    fg: color.accent.deep,
    bg: tier === "soft" ? color.accent.soft : color.surface[tier],
    min: AA_NORMAL,
  })),
  {
    name: "accent secondaryDeep on strong surface",
    fg: color.accent.secondaryDeep,
    bg: color.surface.strong,
    min: AA_NORMAL,
  },
];

/** Non-text UI elements (status borders, chart marks) against the surfaces
 * they sit on must meet WCAG 1.4.11 (3:1). */
const nonTextPairs: Array<{ name: string; fg: string; bg: string }> = [
  ...(["success", "warning", "danger", "info"] as const).flatMap((status) => [
    {
      name: `${status} border on surface`,
      fg: color.status[status].border,
      bg: color.background.surface,
    },
    {
      name: `${status} border on cream`,
      fg: color.status[status].border,
      bg: color.background.page,
    },
  ]),
  ...color.dataViz.categorical.map((c, i) => ({
    name: `categorical[${i}] on surface`,
    fg: c,
    bg: color.background.surface,
  })),
  ...color.dataViz.categorical.map((c, i) => ({
    name: `categorical[${i}] on cream`,
    fg: c,
    bg: color.background.page,
  })),
  {
    name: "accent mark on strong surface",
    fg: color.accent.deep,
    bg: color.surface.strong,
  },
  {
    name: "focus border on strong surface",
    fg: color.border.focus,
    bg: color.surface.strong,
  },
  // The comparison series carries real information (a second data series),
  // so it must meet 1.4.11 on every surface charts render on.
  ...(["canvas", "base", "strong"] as const).map((tier) => ({
    name: `dataViz comparison series on surface.${tier}`,
    fg: color.dataViz.comparison,
    bg: color.surface[tier],
  })),
];

/**
 * The Aquarela backoffice design system v0.1.0 (`docs/aquarela-design-system/`,
 * DEC-129) publishes its own static contrast evidence in `VALIDATION.md`.
 * These assertions re-derive each published pair from the merged token values
 * so the evidence and the code cannot drift apart: if a value is retuned, the
 * matching published ratio must be re-checked here.
 *
 * Additive only — the pairs above are unchanged.
 */
const designSystemPairs: Array<{ name: string; fg: string; bg: string; min: number }> = [
  { name: "foreground on card", fg: color.ink.primary, bg: color.surface.base, min: AA_NORMAL },
  {
    name: "foreground on background",
    fg: color.ink.primary,
    bg: color.surface.canvas,
    min: AA_NORMAL,
  },
  {
    name: "muted-foreground on card",
    fg: color.ink.tertiary,
    bg: color.surface.base,
    min: AA_NORMAL,
  },
  {
    name: "muted-foreground on background",
    fg: color.ink.tertiary,
    bg: color.surface.canvas,
    min: AA_NORMAL,
  },
  {
    name: "muted-foreground on accent",
    fg: color.ink.tertiary,
    bg: color.accent.soft,
    min: AA_NORMAL,
  },
  {
    name: "primary-foreground on primary",
    fg: color.text.onNavy,
    bg: color.brand.navy,
    min: AA_NORMAL,
  },
  {
    name: "accent-foreground on accent",
    fg: color.accent.deep,
    bg: color.accent.soft,
    min: AA_NORMAL,
  },
  {
    name: "success-foreground on success",
    fg: color.status.success.fg,
    bg: color.status.success.bg,
    min: AA_NORMAL,
  },
  {
    name: "warning-foreground on warning",
    fg: color.status.warning.fg,
    bg: color.status.warning.bg,
    min: AA_NORMAL,
  },
  {
    name: "danger-foreground on danger",
    fg: color.status.danger.fg,
    bg: color.status.danger.bg,
    min: AA_NORMAL,
  },
  {
    name: "info-foreground on info",
    fg: color.status.info.fg,
    bg: color.status.info.bg,
    min: AA_NORMAL,
  },
  {
    name: "destructive-foreground on destructive",
    fg: color.text.inverse,
    bg: color.status.danger.fg,
    min: AA_NORMAL,
  },
  // Non-text pairs (design system: ≥3:1 for meaningful control boundaries).
  {
    name: "input control boundary on card",
    fg: color.border.strong,
    bg: color.surface.base,
    min: AA_LARGE_OR_UI,
  },
  {
    name: "ring on card",
    fg: color.border.focus,
    bg: color.surface.base,
    min: AA_LARGE_OR_UI,
  },
  {
    name: "ring on background",
    fg: color.border.focus,
    bg: color.surface.canvas,
    min: AA_LARGE_OR_UI,
  },
];

describe("color tokens: Aquarela design system published evidence", () => {
  it.each(designSystemPairs)("$name meets >= $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("color tokens: WCAG AA text contrast", () => {
  it.each(textPairs)("$name meets >= $min:1", ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe("color tokens: WCAG 1.4.11 non-text contrast", () => {
  it.each(nonTextPairs)("$name meets >= 3:1", ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
  });
});

describe("color tokens: status distinguishability", () => {
  const statuses = ["success", "warning", "danger", "info"] as const;

  it("status foregrounds are pairwise distinguishable (>= 1.3:1 apart)", () => {
    for (let i = 0; i < statuses.length; i++) {
      for (let j = i + 1; j < statuses.length; j++) {
        const ratio = contrastRatio(color.status[statuses[i]!].fg, color.status[statuses[j]!].fg);
        expect(ratio).toBeGreaterThanOrEqual(1.3);
      }
    }
  });

  it("status washes differ from both page and surface backgrounds", () => {
    for (const status of statuses) {
      expect(contrastRatio(color.status[status].bg, color.background.page)).toBeGreaterThan(1.05);
      expect(contrastRatio(color.status[status].bg, color.background.surface)).toBeGreaterThan(
        1.05,
      );
    }
  });
});

describe("data-visualization palettes", () => {
  it("categorical colours are unique and pairwise distinguishable (>= 1.2:1)", () => {
    const palette = color.dataViz.categorical;
    expect(new Set(palette).size).toBe(palette.length);
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        expect(contrastRatio(palette[i]!, palette[j]!)).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it("sequential ramps are monotonic in luminance (dark → light or light → dark)", () => {
    for (const ramp of Object.values(color.dataViz.sequential)) {
      const luminances = ramp.map(relativeLuminance);
      const ascending = luminances.every((l, i) => i === 0 || l >= luminances[i - 1]!);
      const descending = luminances.every((l, i) => i === 0 || l <= luminances[i - 1]!);
      expect(ascending || descending).toBe(true);
      expect(new Set(luminances).size).toBe(ramp.length);
    }
  });
});

describe("structural token scales", () => {
  it("spacing is strictly increasing with the step key", () => {
    const steps = Object.keys(spacing).map(Number);
    for (let i = 1; i < steps.length; i++) {
      expect(spacing[steps[i] as keyof typeof spacing]).toBeGreaterThan(
        spacing[steps[i - 1] as keyof typeof spacing],
      );
    }
    expect(spacing[1]).toBe(4);
  });

  it("radius is non-decreasing across sm → md → lg → xl", () => {
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
    expect(radius.lg).toBeLessThan(radius.xl);
  });

  it("font sizes are strictly increasing across the scale", () => {
    const sizes = Object.values(typography.fontSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it("font stacks contain no webfont URLs (no downloads)", () => {
    for (const stack of Object.values(typography.fontFamily)) {
      expect(stack).not.toMatch(/https?:|url\(/);
    }
  });

  it("webfont stacks lead with an UNQUOTED var(--font-sans)", () => {
    // A quoted "var(--font-sans)" is a literal (non-existent) family name,
    // so the next/font webfont would silently never apply.
    for (const stack of [
      typography.fontFamily.display,
      typography.fontFamily.sans,
      typography.fontFamily.sansVar,
    ]) {
      expect(stack.startsWith("var(--font-sans),")).toBe(true);
    }
  });

  it("elevation shadows escalate in visual weight", () => {
    expect(elevation.none).toBe("none");
    expect(elevation.sm.length).toBeLessThan(elevation.md.length);
    expect(elevation.md.length).toBeLessThan(elevation.lg.length);
  });

  it("icon sizes ascend across the scale", () => {
    const sizes = Object.values(iconSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it("container widths are strictly increasing", () => {
    const widths = Object.values(containerWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
    }
  });

  it("breakpoints are strictly increasing", () => {
    const points = Object.values(breakpoint);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThan(points[i - 1]!);
    }
  });

  it("motion durations stay within the 120–220 ms band (brief §19)", () => {
    for (const duration of Object.values(motion.duration)) {
      expect(duration).toBeGreaterThanOrEqual(120);
      expect(duration).toBeLessThanOrEqual(220);
    }
  });

  it("border widths are positive and non-decreasing", () => {
    const widths = Object.values(borderWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]!);
    }
  });

  // Control geometry and focus treatment come from the design system's
  // "Component contract" and `component-recipes.ts` sizes.
  it("control heights ascend and match the 40px default", () => {
    expect(geometry.controlHeight.sm).toBeLessThan(geometry.controlHeight.md);
    expect(geometry.controlHeight.md).toBeLessThan(geometry.controlHeight.lg);
    expect(geometry.controlHeight.md).toBe(40);
    expect(geometry.controlHeight.sm).toBe(32);
    expect(geometry.controlHeight.lg).toBe(48);
  });

  it("table rows are 56px default with a 40px compact row and a 40px header", () => {
    expect(geometry.tableRowHeight.default).toBe(56);
    expect(geometry.tableRowHeight.compact).toBe(40);
    expect(geometry.tableHeaderHeight).toBe(40);
    expect(geometry.tableRowHeight.compact).toBeLessThan(geometry.tableRowHeight.default);
  });

  it("the touch target meets the 44px minimum", () => {
    expect(geometry.touchTarget).toBeGreaterThanOrEqual(44);
  });

  it("the focus ring is a solid 3px ring with a 2px offset", () => {
    expect(focus.ringWidth).toBe(3);
    expect(focus.ringOffset).toBe(2);
    // Never an opacity-modified ring: the token must be a complete colour.
    expect(focus.ringColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(focus.ringColor).toBe(color.border.focus);
  });

  it("motion durations match the design system's 120ms / 180ms pair", () => {
    expect(motion.duration.fast).toBe(120);
    expect(motion.duration.base).toBe(180);
  });
});

describe("Wave 0 semantic scale (2026-09-28)", () => {
  it("typeScale roles use existing font sizes and step down monotonically", () => {
    const sizes = Object.values(typeScale).map((role) => role.fontSize);
    const known = new Set(Object.values(typography.fontSize));
    for (const size of sizes) {
      expect(known.has(size)).toBe(true);
    }
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]!);
    }
    expect(typeScale.hero.fontSize).toBeGreaterThan(typeScale.body.fontSize);
  });

  it("space roles stay on the 4/8pt grid", () => {
    const values = Object.values(space);
    for (const value of values) {
      expect(value % 4).toBe(0);
      expect(value).toBeGreaterThanOrEqual(4);
    }
    expect(values).toContain(4);
    expect(values).toContain(8);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
    }
  });

  it("radius and elevation roles alias the existing scales", () => {
    expect(radiusRole.control).toBe(radius.md);
    expect(radiusRole.surface).toBe(radius.lg);
    expect(radiusRole.dialog).toBe(radius.xl);
    expect(radiusRole.pill).toBe(radius.pill);
    expect(elevationRole.resting).toBe(elevation.none);
    expect(elevationRole.panel).toBe(elevation.panel);
    expect(elevationRole.dialog).toBe(elevation.lg);
  });

  it("the accent policy carries one accent and its permitted companion", () => {
    expect(accentPolicy.accent).toBe(color.accent.accent);
    expect(accentPolicy.soft).toBe(color.accent.soft);
    expect(accentPolicy.ink).toBe(color.accent.ink);
    expect(accentPolicy.deep).toBe(color.accent.deep);
    expect(accentPolicy.secondary).toBe(color.accent.secondaryDeep);
  });
});

describe("TOKENS aggregate", () => {
  it("exposes every scale", () => {
    expect(Object.keys(TOKENS).sort()).toEqual([
      "borderWidth",
      "breakpoint",
      "color",
      "containerWidth",
      "elevation",
      "focus",
      "geometry",
      "grid",
      "iconSize",
      "motion",
      "radius",
      "spacing",
      "typography",
    ]);
  });

  it("re-exports the same object identity as the individual scales", () => {
    expect(TOKENS.color).toBe(color);
    expect(TOKENS.spacing).toBe(spacing);
    expect(TOKENS.typography).toBe(typography);
    expect(TOKENS.radius).toBe(radius);
    expect(TOKENS.elevation).toBe(elevation);
    expect(TOKENS.borderWidth).toBe(borderWidth);
    expect(TOKENS.iconSize).toBe(iconSize);
    expect(TOKENS.containerWidth).toBe(containerWidth);
    expect(TOKENS.breakpoint).toBe(breakpoint);
    expect(TOKENS.motion).toBe(motion);
    expect(TOKENS.geometry).toBe(geometry);
    expect(TOKENS.focus).toBe(focus);
  });
});
