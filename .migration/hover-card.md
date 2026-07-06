# hover-card

2026-07-06 · transformation engine · **migrated**: Radix HoverCard → Base UI PreviewCard (Portal>Positioner>Popup).

## Changed

- `src/components/ui/hover-card.tsx`: `@radix-ui/react-hover-card` → `@base-ui/react/preview-card` (primitive renamed `PreviewCard`; public wrapper names stay `HoverCard*`). `HoverCardContent` restructured to `Portal > Positioner > Popup` with positioning props Pick'd + forwarded. Animation classes → starting/ending-style idiom; `origin-(--radix-hover-card-content-transform-origin)` → `origin-(--transform-origin)`.
  - leftover scan: clean.
- No consumer changes: HoverCard is not used anywhere in the app.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- `openDelay`/`closeDelay` (Radix Root) would move to the Trigger as `delay`/`closeDelay` — not used here.

## Verify by hand

- Not currently rendered anywhere; no QA target. Structurally verified (typecheck + build).
