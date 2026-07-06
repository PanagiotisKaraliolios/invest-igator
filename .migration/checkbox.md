# checkbox

2026-07-06 · transformation engine · **migrated**: Radix Checkbox → Base UI Checkbox.

## Changed

- `src/components/ui/checkbox.tsx`: `@radix-ui/react-checkbox` → `@base-ui/react/checkbox`. `Root`/`Indicator` unchanged. Class rewrites: `data-[state=checked]:` → `data-checked:` (×4); `disabled:*` → `data-disabled:*` (Root renders a `<span>`).
  - leftover scan: clean.
- Consumer change — `src/app/(dashboard)/transactions/_components/columns.tsx`: the "select all" header checkbox used Radix's `checked={... || (some && 'indeterminate')}`. Base UI splits indeterminate into its own boolean prop: now `checked={table.getIsAllPageRowsSelected()}` + `indeterminate={table.getIsSomePageRowsSelected()}`.

## Left alone

- Row-level checkbox `checked={row.getIsSelected()}` / `onCheckedChange={(v) => row.toggleSelected(!!v)}` — value is now always boolean; `!!v` unaffected.
- Radix deps removed in the final sweep.

## Behavior changes

- `onCheckedChange` no longer emits `'indeterminate'` as a checked value (always boolean); the mixed state is driven by the `indeterminate` prop. Behavior preserved at the one call site.

## Verify by hand

- Transactions table: select some rows → header checkbox shows the indeterminate (dash) state; select all → checked; clear → unchecked. Toggling the header selects/clears all page rows.
