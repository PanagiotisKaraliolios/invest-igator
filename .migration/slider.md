# slider

2026-07-06 · transformation engine · **migrated**: Radix Slider → Base UI Slider (adds Control; Range→Indicator).

## Changed

- `src/components/ui/slider.tsx`: `@radix-ui/react-slider` → `@base-ui/react/slider`. Structural change: anatomy is now `Root > Control > Track > (Indicator, Thumbs)`. Added the new `Slider.Control` (interactive surface) wrapping Track; `Range` → `Indicator`; thumbs moved inside Track and each gets the required `index` prop. Added `thumbAlignment='edge'` on Root to match Radix's within-track thumb positioning (Base UI defaults to `'center'`). `disabled:*` → `data-disabled:*` on the thumb. `data-[disabled]`/`data-[orientation]` selectors kept (unchanged in Base UI).
  - leftover scan: clean.
- No consumer changes (0 consumer files; no `onValueCommit`/`inverted` call sites).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- `onValueCommit` → `onValueCommitted`, `inverted` dropped, `minStepsBetweenThumbs` → `minStepsBetweenValues` — none used in the app. `onValueChange`/`onValueCommitted` gain `eventDetails`.

## Verify by hand

- **Not currently rendered anywhere** (no consumers), so this wrapper is structurally verified (typecheck + build) but not visually QA'd. If reintroduced: drag the thumb, confirm the filled Indicator tracks it and the value commits on release.
