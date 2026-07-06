# aspect-ratio

2026-07-06 · native mapping · **migrated**: Radix AspectRatio → plain `<div>` + CSS `aspect-ratio`.

## Changed

- `src/components/ui/aspect-ratio.tsx`: removed `@radix-ui/react-aspect-ratio`. `AspectRatio` now renders `<div data-slot='aspect-ratio' style={{ aspectRatio: ratio, ...style }}>` — the same thing the Radix `ratio` prop mapped to. `ratio` defaults to `1`.
  - leftover scan: clean.
- No consumer changes (component has no real usages in the app).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None. `ratio={16/9}` → `aspect-ratio: 16/9` on the container. If a media child needs to fill, it should carry `size-full object-cover` (unchanged from Radix guidance).

## Verify by hand

- Not currently used; no QA target. If reintroduced, confirm the child fills the ratio box.
