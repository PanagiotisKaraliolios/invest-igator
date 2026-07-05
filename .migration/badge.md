# badge

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` → `useRender` + `mergeProps`.

## Changed

- `src/components/ui/badge.tsx`: replaced `@radix-ui/react-slot` with `@base-ui/react/use-render` + `@base-ui/react/merge-props`. Dropped `asChild`/`Comp`; the wrapper now takes `useRender.ComponentProps<'span'>` and calls `useRender({ defaultTagName: 'span', render, props: mergeProps<'span'>(...) })`. The `data-slot`/`className` literal is cast `as React.ComponentProps<'span'>` (mergeProps excess-property pitfall). `badgeVariants` (cva) kept and still exported. `[a&]:hover:*` classes still apply when rendered as an anchor via `render`.
  - leftover scan: `grep -n "radix-ui" src/components/ui/badge.tsx` → clean.
- No consumer changes: no call site used `<Badge asChild>` (Badge appears in 14 files, all as a plain element).

## Left alone

- `@radix-ui/react-slot` stays in `package.json` until the final dep-removal sweep (other Slot users already migrated in this batch; slot removed at the end).

## Behavior changes

- None. `useRender` replicates Slot's prop-merge onto the rendered element.

## Verify by hand

- Badges render across tables/cards (admin roles, watchlist, transactions). If any badge is later used as a link, pass `render={<a/>}` instead of the old `asChild`.
