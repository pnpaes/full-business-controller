# @aquarela/ui

Presentation primitives for the Business Controller screens (08_UI_UX.md §8.3–§8.9).
React server-component compatible: no hooks, no effects, no client state, no dependencies.

The UX contract that these primitives implement is `docs/ux/README.md`; the live
reference is `/styleguide`.

## Components (`src/components.tsx`)

- `Button` — variants `primary | secondary | danger | ghost`, sizes `sm | md | lg` (md is a 44px touch target, §8.6), `disabled`, `loading` (sets `aria-busy`, disables).
- `TextField` — label, `help`, `error` (sets `aria-invalid` and links messages via `aria-describedby`), optional `suffix` for unit/currency pairing (§8.5).
- `Card` / `Panel` — surface + elevation (`flat | raised | floating`); `Panel` adds a serif title and meta line.
- `Alert` — tones `info | success | warning | danger`; `role="status"` for info/success, `role="alert"` for warning/danger. **In-flow and persistent** (see `SuccessToast`).
- `Badge`, `StatusPill` — `StatusPill` takes a tone and renders a filled/hollow dot as a non-color status cue (07 §7.8).
- `Table`, `Th`, `Td` — semantic table shell with `caption` and an `emptyMessage` empty state (§8.4).
- `PageHeader` — serif title, `scope` (breadcrumb/scope slot), `description`, `actions`.
- `cx` — classname join helper.

## Patterns (`src/patterns.tsx`)

- `DataTable` — column-keyed lightweight table over `Table`/`Th`/`Td`.
- `FilterBar`, `Breadcrumbs`, `DescriptionList`, `FormSection`, `FormActions`, `Tabs`, `ProgressBar`.
- `SelectField`, `NumberField`, `DateField`, `TextareaField`, `CheckboxField` — the field family; all share label / `help` / `error` `aria-describedby` wiring.
- `FileField` — **Wave 0**: the same field wiring around a native file input, with the `::file-selector-button` dressed to match a small button.
- `Collapsible` — **Wave 0**: accessible progressive disclosure over native `<details>`/`<summary>`, with a `summary`, optional `badge` and `defaultOpen` (or native `open`/`onToggle`). Keyboard operable, no client state, no layout jump. Use for secondary sections; **never** for a create/edit form on a register.

## Client primitives

- `Modal` (`src/modal.tsx`) — the base dialog: `role="dialog"`/`aria-modal`, Escape and backdrop close, focus moved in on open and **returned to the trigger** on close.
- `FormModal` — **Wave 0**: the one create/edit modal shape around `Modal` — `title`, `description`, a `<form>` body, a danger `error` slot and a Cancel / submit row with a `busy` state (which suppresses Escape/backdrop/Cancel). Every "New …" uses this rather than bespoke markup.
- `InfoTip` (`src/info-tip.tsx`) — **Wave 0**: the standard (i) trigger wrapping `Tooltip`; a focusable `<button>` with `aria-describedby` to the bubble. The one affordance for explainability (domain terms, formulas, statuses, consequences). Short content only — never required instructions.
- `SuccessToast` (`src/toast.tsx`) — **Wave 0**: the single **transient** post-mutation success pattern (`role="status"`, auto-dismiss, one at a time). Use it after a completed mutation; use `Alert` for persistent, in-flow status.

## Wave 0 additions to `shell.tsx`

- `EmptyState` — `variant="plain"` (**Wave 0**) drops the border/surface for use _inside_ a panel; the default `bordered` is unchanged.
- `MetricHero` / `MetricSecondary` / `MetricBand` — **Wave 0**: the one ranked hero metric plus a quiet secondary row, separated by a hairline band (not a card wall). Replaces walls of equal `KpiCard`s.

## Formatting (`src/format.ts`)

Decimal-string only — **never floats** (a presentation mirror of the domain's `HALF_UP` rules):

- `groupDecimal(value)` — grouping only.
- `formatNumber(value, { decimals, groupSeparator, decimalSeparator })` — grouped, fixed-decimal.
- `formatMoney(value, { currency, ... })` — the above with the currency appended (`"12,345.60 NOK"`).
- `formatAxisValue(value, unit)` / `axisLabel(subject, unit)` — the chart-axis convention: every tick names its unit, every axis names its subject and unit.

## Wave 0 semantic tokens (`src/tokens.ts`)

Additive, so every legacy token and value keeps working: `typeScale` (roles → size/line-height/weight), `space` (4/8pt rhythm roles), `radiusRole`, `elevationRole`, and `accentPolicy` (one accent per screen).

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
