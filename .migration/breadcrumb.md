# breadcrumb

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` → `useRender` + `mergeProps` (BreadcrumbLink only).

## Changed

- `src/components/ui/breadcrumb.tsx`: replaced `@radix-ui/react-slot` with `@base-ui/react/use-render` + `@base-ui/react/merge-props`. Only `BreadcrumbLink` used Slot; it now takes `useRender.ComponentProps<'a'>` and calls `useRender({ defaultTagName: 'a', render, props: mergeProps<'a'>(...) })` with the `data-slot`/`className` literal cast `as React.ComponentProps<'a'>`. All other parts (Breadcrumb, List, Item, Page, Separator, Ellipsis) were plain intrinsic elements — untouched.
  - leftover scan: clean.
- No consumer changes: no call site used `<BreadcrumbLink asChild>` (breadcrumb is used in 1 file).

## Left alone

- `@radix-ui/react-slot` stays until the final dep-removal sweep.

## Behavior changes

- None.

## Verify by hand

- Breadcrumb link hover color still applies; if a BreadcrumbLink wraps a router `<Link>`, use `render={<Link/>}`.
