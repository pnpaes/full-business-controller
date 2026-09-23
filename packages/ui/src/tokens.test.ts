import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";
import {
  TOKENS,
  breakpoint,
  borderWidth,
  color,
  containerWidth,
  elevation,
  iconSize,
  motion,
  radius,
  spacing,
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
});

describe("TOKENS aggregate", () => {
  it("exposes every scale", () => {
    expect(Object.keys(TOKENS).sort()).toEqual([
      "borderWidth",
      "breakpoint",
      "color",
      "containerWidth",
      "elevation",
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
  });
});
