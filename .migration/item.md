# item

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` → `useRender` + `mergeProps` (Item only).

## Changed

- `src/components/ui/item.tsx`: replaced `@radix-ui/react-slot` with `@base-ui/react/use-render` + `@base-ui/react/merge-props`. Only `Item` used Slot; it now takes `useRender.ComponentProps<'div'> & VariantProps<typeof itemVariants>` and calls `useRender({ defaultTagName: 'div', render, props: mergeProps<'div'>(...) })`. `className` flows into `itemVariants({ className, size, variant })` (useRender's `className` is native `string | undefined`, compatible with cva). `data-size`/`data-slot`/`data-variant` literal cast `as React.ComponentProps<'div'>`. All other Item* parts are plain elements — untouched.
  - leftover scan: clean.
- No consumer changes: no call site used `<Item asChild>`.

## Left alone

- `ItemSeparator` renders `<Separator>` (still Radix until its own migration).
- `@radix-ui/react-slot` stays until the final dep-removal sweep.

## Behavior changes

- None.

## Verify by hand

- Item is a layout primitive; render an item list and confirm size/variant data-attributes still drive styling. If used as a link/button, pass `render`.
