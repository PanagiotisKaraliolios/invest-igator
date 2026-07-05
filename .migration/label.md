# label

2026-07-06 · transformation engine (legacy `new-york` style, no `base-new-york` pair) · **migrated**: Radix Label → native `<label>`.

## Changed

- `src/components/ui/label.tsx`: replaced `@radix-ui/react-label` (`LabelPrimitive.Root`) with a native `<label>` element. Base UI ships no standalone Label primitive (there is `Field.Label` for forms, but our `Label` is used free-standing and inside `FormLabel`). Kept every Tailwind class and `data-slot='label'` verbatim; props typed `React.ComponentProps<'label'>`. Dropped `'use client'` — a native element has no client-only behavior and the file is safe to import from both server and client components.
  - leftover scan: `grep -n "radix-ui\|@radix-ui" src/components/ui/label.tsx` → clean.
- No consumer changes: the `Label` export name and its props (`htmlFor`, `className`, `children`) are unchanged, and no call site passed `asChild`.

## Left alone

- `@radix-ui/react-label` stays in `package.json` until the final dependency-removal sweep (progressive migration — nothing else imports it now, but removal happens once, after the last wrapper).

## Behavior changes

- Radix Label suppressed text selection on double-click (an internal `onMouseDown` guard). A native `<label>` does not, so double-clicking label text now selects it. Cosmetic only; the `htmlFor` → control focus association is native and unchanged.

## Verify by hand

- Click a field's label text (account settings, sign-up form): focus must move to the associated input. Double-clicking a label now selects its text (was suppressed) — expected and harmless.
