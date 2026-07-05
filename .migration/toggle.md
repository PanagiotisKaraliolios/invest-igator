# toggle

2026-07-06 · transformation engine · **migrated**: Radix `Toggle.Root` → Base UI callable `Toggle`.

## Changed

- `src/components/ui/toggle.tsx`: `@radix-ui/react-toggle` → `@base-ui/react/toggle` (callable single part, no `.Root`). Class rewrite in `toggleVariants`: `data-[state=on]:` → `data-pressed:`. `disabled:*` kept (Base UI Toggle renders a native `<button>`). `toggleVariants` still exported (reused by toggle-group).
  - leftover scan: clean.
- No consumer changes (0 direct consumers; used via toggle-group).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None. `pressed`/`defaultPressed`/`onPressedChange` pass through unchanged.

## Verify by hand

- Exercised through toggle-group ([[toggle-group]]); no standalone usage.
