# @aquarela/ui

Presentation primitives for the Business Controller screens (08_UI_UX.md §8.3–§8.9).
React server-component compatible: no hooks, no effects, no client state, no dependencies.

## Components (`src/components.tsx`)

- `Button` — variants `primary | secondary | danger | ghost`, sizes `sm | md | lg` (md is a 44px touch target, §8.6), `disabled`, `loading` (sets `aria-busy`, disables).
- `TextField` — label, `help`, `error` (sets `aria-invalid` and links messages via `aria-describedby`), optional `suffix` for unit/currency pairing (§8.5).
- `Card` / `Panel` — surface + elevation (`flat | raised | floating`); `Panel` adds a serif title and meta line.
- `Alert` — tones `info | success | warning | danger`; `role="status"` for info/success, `role="alert"` for warning/danger.
- `Badge`, `StatusPill` — `StatusPill` takes a tone and renders a filled/hollow dot as a non-color status cue (07 §7.8).
- `Table`, `Th`, `Td` — semantic table shell with `caption` and an `emptyMessage` empty state (§8.4).
- `PageHeader` — serif title, `scope` (breadcrumb/scope slot), `description`, `actions`.
- `cx` — classname join helper.

## Consuming tokens

All styling is inline and driven by `src/tokens.ts` (do not modify). Import tokens directly when composing screens:

```ts
import { TOKENS, color, spacing } from "@aquarela/ui";
```

The only CSS the components need is the focus ring, which inline styles cannot express. Render once in the app shell:

```tsx
import { uiGlobalCss } from "@aquarela/ui";
// <style>{uiGlobalCss}</style>
```
