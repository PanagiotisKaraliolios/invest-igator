# scroll-area

2026-07-06 · transformation engine · **migrated**: Radix ScrollArea → Base UI ScrollArea (part renames).

## Changed

- `src/components/ui/scroll-area.tsx`: `@radix-ui/react-scroll-area` → `@base-ui/react/scroll-area`. `Root`/`Viewport`/`Corner` unchanged; `ScrollAreaScrollbar` → `Scrollbar`, `ScrollAreaThumb` → `Thumb`. Kept the Viewport→children structure (no `ScrollArea.Content` wrapper — only needed for horizontal-overflow measurement; the sole consumer scrolls vertically).
  - leftover scan: clean.
- No consumer changes: the only consumer (`transactions/data-table.tsx`, `<ScrollArea className='h-72 pr-4'>`) passes no `type` prop.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- Radix `type`/`scrollHideDelay` are dropped in Base UI (scrollbar visibility is CSS-driven via `data-hovering`/`data-scrolling`). Not used here — default mount behavior (scrollbar mounts when scrollable) applies.

## Verify by hand

- Transactions column-visibility / large-list popover (the `h-72` scroll area): content scrolls vertically and the scrollbar/thumb appear and drag correctly.
