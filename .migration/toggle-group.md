# toggle-group

2026-07-06 · transformation engine · **migrated**: Radix ToggleGroup → Base UI ToggleGroup (items use Toggle).

## Changed

- `src/components/ui/toggle-group.tsx`: `@radix-ui/react-toggle-group` → `@base-ui/react/toggle-group` (callable `ToggleGroup`). Items now render the `Toggle` primitive (`@base-ui/react/toggle`) with a `value` prop, per Base UI's anatomy. The `ToggleGroupContext` (size/variant/spacing) and all `data-*` styling hooks are unchanged; item classes use `toggleVariants` (already `data-pressed:`) plus custom `data-[spacing]`/`data-[variant]` selectors.
  - leftover scan: clean.
- Consumer change — `src/app/(dashboard)/portfolio/returns/page.tsx` (Base UI ToggleGroup value is ALWAYS an array; there is no `type` prop):
  - Single group: `type='single' value={mode}` → `value={[mode]}`, and `onValueChange={(v) => v && setMode(v as Mode)}` → `onValueChange={(v) => v[0] && setMode(v[0] as Mode)}`.
  - Multiple group: `type='multiple'` → `multiple`; `value={seriesShown}`/`onValueChange={(v) => v.length && setSeriesShown(v)}` already array-shaped, unchanged.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- Value model changed from Radix's string-or-array (by `type`) to Base UI's always-array + `multiple` boolean. Behavior preserved at the call site by wrapping/unwrapping the single value. `loop`→`loopFocus`, `rovingFocus` dropped — not used here.

## Verify by hand

- Return Analysis page: the MWR/TWR toggle (single) selects exactly one; the Yield/Net toggle (multiple) selects any combination and keeps at least one. Active items show the pressed style.
