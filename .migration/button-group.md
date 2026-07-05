# button-group

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` → `useRender` + `mergeProps` (ButtonGroupText only).

## Changed

- `src/components/ui/button-group.tsx`: replaced `@radix-ui/react-slot` with `@base-ui/react/use-render` + `@base-ui/react/merge-props`. Only `ButtonGroupText` used Slot; it now takes `useRender.ComponentProps<'div'>` and calls `useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(...) })` with the `className` literal cast `as React.ComponentProps<'div'>`. `ButtonGroup`, `ButtonGroupSeparator` (uses migrated-later `Separator`), `buttonGroupVariants` untouched.
  - leftover scan: clean.
- No consumer changes: `button-group` has 0 consumer files.

## Left alone

- `ButtonGroupSeparator` renders `<Separator>` (still on Radix until its own migration) — coexists fine.
- `@radix-ui/react-slot` stays until the final dep-removal sweep.

## Behavior changes

- None.

## Verify by hand

- Not currently used in the app; no manual QA target.
