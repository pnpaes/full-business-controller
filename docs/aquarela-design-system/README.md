# Aquarela backoffice design system

Version 0.1.0 · 24 September 2026 · Proposed theme, ready for integration review.

For Aquarela, a coffee shop with a backoffice already under development. This package applies a visual language to that existing application. It does not define a replacement application or new business requirements.

## Open the guide

Open `index.html` in a browser. No installation or build is needed. The guide is an offline HTML visual specification; its interactive specimens are native HTML, not a second React component library. Production implementation must retain the app's shadcn/ui components. `tokens.css`, `components.css`, `guide.css`, and `guide.js` support this guide only; do not import them into the backoffice.

## Files to apply

| File | Purpose |
|---|---|
| `shadcn-theme.css` | Canonical semantic colors, font stack, motion and base radius. Merge into the existing app global CSS. |
| `tailwind-v4.css` | Merge into the existing `@theme inline` block for Tailwind 4. |
| `tailwind-v3.cjs` | Alternative theme extension for Tailwind 3. Do not apply both versions. |
| `component-recipes.ts` | Merge styling into existing shared component sources and CVA variants, once. |
| `tokens.json` | Machine-readable reference of semantic tokens and foundation values. |
| `DESIGN-SYSTEM.md` | Full visual, component, coffee-shop pattern and accessibility contract. |
| `INTEGRATION.md` | Adaptation instructions and composition examples for the developer/agent. |
| `VALIDATION.md` | What was checked and what needs the real application. |

## Integration sequence

1. Work from the Aquarela repository, not the unrelated Kongsberg Agenda workspace. Check its `AGENTS.md`, package manager, `components.json`, installed primitives and current modifications. Use its package runner to run `shadcn@latest info --json`. Record `tailwindVersion`, `base`, `aliases`, `tailwindCssFile`, `iconLibrary`, and `isRSC` before editing.
2. Save the current theme as a commit or patch. Merge `shadcn-theme.css` declarations into the **existing** `tailwindCssFile`. Preserve imports, unrelated variables and application styles. Do not run init, apply a preset, reinstall components, or change primitive libraries for this task.
3. Choose the matching Tailwind mapping. These colors are full CSS values (hex); remove any existing `hsl(var(--token))` or `oklch(var(--token))` wrappers for these tokens. Retain the app's content paths, plugins and unrelated theme extensions.
4. This release specifies light mode only. Apply to the app's light theme first. Do not let existing `.dark` variables partially combine with these custom light-only status tokens. If the app requires dark mode, define and verify all foreground/background pairs before rollout.
5. Merge the recipe values into the owned shared components. Replace conflicting color/radius/size utilities in those sources; do not append a second competing recipe. Preserve behavior, refs, event handlers and state selectors. Add `brand-soft` Button and semantic Badge variants to CVA. Screens then use variants, not ad-hoc color overrides.
6. Match the typography and geometry in the specification. Load Inter using the app's existing font pipeline with its license, preferably self-hosted. Apply `font-sans` at the app root. No font files are bundled; the offline guide falls back to system sans.
7. Verify one existing sales screen, one inventory table and one form before rolling across the app. Confirm locale, currency, stock units, permissions and transaction behavior against the existing product.

The app repository was not supplied or inspected. The package is not installed into the running backoffice, and the React recipes have not been compiled against its dependency versions. Brand palette and wordmark are proposed; no existing Aquarela brand assets were supplied.

## Provenance

- User brief, 24 September 2026: coffee-shop backoffice already under construction; shadcn/ui foundation; reference-led customization; deliver an applicable design system.
- [Visual reference: Dashboard UX/UI for AI Health Platform Website Branding](https://www.behance.net/gallery/251598713/Dashboard-UXUI-for-AI-Health-Platform-Website-Branding), Gudrix Agency and collaborators. Inspected visually. Aquarela's exact colors, spacing and type sizes are new design decisions, not extracted source tokens.
- [shadcn/ui theming](https://ui.shadcn.com/docs/theming) and [components](https://ui.shadcn.com/docs/components), checked 24 September 2026.
- Global shadcn skill read from `/Users/pauloniciolipaes/.agents/skills/shadcn/SKILL.md`, with customization, styling, forms and composition rules.

## Change policy

Keep `shadcn-theme.css` authoritative for application colors. Update `tokens.json`, the visual guide and contrast evidence whenever colors change. A semantic meaning change requires reviewing every consumer. A new primitive or business workflow belongs in the app, not in this theme package.
