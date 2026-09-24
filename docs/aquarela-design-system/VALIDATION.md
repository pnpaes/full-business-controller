# Validation record

24 September 2026 · Aquarela 0.1.0

## Static color checks

Calculated using sRGB relative luminance. Normal text threshold: 4.5:1.

| Foreground | Background | Ratio | Result |
|---|---|---|---|
| foreground | card | 17.25:1 | Pass |
| foreground | background | 15.54:1 | Pass |
| muted-foreground | card | 5.35:1 | Pass |
| muted-foreground | background | 4.82:1 | Pass |
| muted-foreground | accent | 4.61:1 | Pass |
| primary-foreground | primary | 17.25:1 | Pass |
| accent-foreground | accent | 6.25:1 | Pass |
| success-foreground | success | 6.22:1 | Pass |
| warning-foreground | warning | 5.92:1 | Pass |
| danger-foreground | danger | 5.74:1 | Pass |
| info-foreground | info | 5.53:1 | Pass |
| destructive-foreground | destructive | 6.49:1 | Pass |
| input (control/focus) | card | 3.33:1 | Pass ≥3:1 |
| ring (control/focus) | card | 7.26:1 | Pass ≥3:1 |
| ring (control/focus) | background | 6.54:1 | Pass ≥3:1 |

## Browser and file checks

- Desktop at 1280 × 720 and mobile at 390 × 844 visually inspected.
- Document scroll width equals viewport at both widths; table has its own labeled horizontal scroll region.
- Search “oat” returns Oat milk; out-of-stock filter returns one of five rows, Takeaway lids.
- Search with no match reveals the empty state; clearing filters restores the list.
- Compact density changes its pressed state and table density attribute.
- Product dialog receives initial focus; adding Decaf blend appends a sixth row and displays confirmation. Reload resets illustrative data.
- ArrowRight from Details selects Stock history and reveals its panel.
- Primary link-button computed text color verified white after correcting selector specificity.
- No captured browser console errors in the final guide.
- JavaScript syntax, unique HTML IDs, local asset/link existence and JSON/theme color consistency checked.
- Official shadcn CLI documentation command completed using Node 24; Button, Badge, Card, Field, Input and Table documentation inspected.

## Scope of evidence

This is a design-system handoff, not a deployed application. The static visual guide uses native HTML specimens. React integration recipes are merge instructions, not compiled or integration-tested components. Tailwind 3/4 mappings have not been built against the unknown Aquarela app. No full assistive-technology audit, production browser matrix, dark-theme validation, localization review, or POS/accounting integration test was performed. Check those in the receiving app before rollout.
