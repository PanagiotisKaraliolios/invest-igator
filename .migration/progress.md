# progress

2026-07-06 · transformation engine · **migrated**: Radix Progress → Base UI Progress (adds Track).

## Changed

- `src/components/ui/progress.tsx`: `@radix-ui/react-progress` → `@base-ui/react/progress`. `value` now passed to `Progress.Root`. `Indicator` must nest inside the new `Progress.Track` — added `<Progress.Track className='size-full'>` around it. The Base UI primitive computes the fill width itself, so the Radix inline `style={{ transform: translateX(-(100-value)%) }}` on the Indicator was **deleted**, not ported.
  - leftover scan: clean.
- No consumer changes (consumers pass `value`).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- Fill is now driven by the primitive's computed width rather than a translateX transform. Visually equivalent for a determinate bar.

## Verify by hand

- Any progress bar (e.g. upload/import progress, password strength if used): the fill width should track `value` from 0→100%.
