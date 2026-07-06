# switch

2026-07-06 · transformation engine · **migrated**: Radix Switch → Base UI Switch (1:1 parts).

## Changed

- `src/components/ui/switch.tsx`: `@radix-ui/react-switch` → `@base-ui/react/switch`. `Root`/`Thumb` unchanged. Class rewrites: `data-[state=checked]:` → `data-checked:`, `data-[state=unchecked]:` → `data-unchecked:` (Root + Thumb). Base UI Root renders a `<span>`, so `disabled:*` variants are dead — replaced `disabled:cursor-not-allowed disabled:opacity-50` with `data-disabled:*`.
  - leftover scan: clean.
- No consumer changes: `onCheckedChange` gains a second `eventDetails` arg but existing single-arg handlers stay type-safe.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None functional. Disabled styling now keys off `data-disabled` instead of `:disabled` (Base UI renders a span, not a native input).

## Verify by hand

- Toggle any switch (settings/preferences); checked color, thumb slide, and disabled dimming must all still work.
