# button

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` → the real `@base-ui/react/button` primitive (per SKILL.md hard rule: button migrates to the Button primitive, never a hand-rolled `useRender` wrapper).

## Changed

- `src/components/ui/button.tsx`: replaced `@radix-ui/react-slot` (`Slot`) with `@base-ui/react/button` (`ButtonPrimitive`). Removed the `asChild`/`Comp = asChild ? Slot : 'button'` logic; the Base UI primitive accepts a `render` prop natively. `buttonVariants` (cva) kept EXACTLY as-is and still exported — it is consumed as a class helper by `calendar.tsx`, `pagination.tsx`, and `alert-dialog.tsx`. The wrapper's `className` is typed as `string` because Base UI's `BaseUIComponentProps` types `className` as `string | ((state) => string | undefined)`, which cannot flow into `buttonVariants()` (expects `ClassValue`); no consumer used the function form. `data-slot='button'` preserved.
  - leftover scan: `grep -n "radix-ui\|@radix-ui" src/components/ui/button.tsx` → clean.
- **25 `<Button asChild>` call sites converted to `render`** across 13 files. Pattern: `<Button asChild ...><Link href>…children…</Link></Button>` → `<Button render={<Link href />} ...>…children…</Button>` (inner element becomes a self-closing `render` target; its children move onto `<Button>`). Files:
  - `src/app/(auth)/auth-error/page.tsx`, `src/app/error.tsx`, `src/app/(dashboard)/error.tsx`, `src/app/not-found.tsx`, `src/app/signout/page.tsx`, `src/app/privacy-policy/page.tsx`, `src/app/terms-of-service/page.tsx`, `src/app/email-change/error/page.tsx`, `src/app/email-change/confirmed/page.tsx`, `src/app/_components/landing/animated-hero.tsx`, `src/app/_components/landing/pricing.tsx`, `src/app/_components/landing/quickstart.tsx`, `src/app/_components/landing/trust-signals.tsx`.
- Verified: `grep -rn "<Button asChild" src` → empty; typecheck 0; biome clean; `next build` → 0.

## Left alone

- `buttonVariants` export unchanged. `calendar.tsx` / `pagination.tsx` / `alert-dialog.tsx` use it as a Tailwind class helper (not the component), so they need no change now.
- Non-Button `asChild` triggers left untouched (10 sites): `PopoverTrigger` (api-keys-card, portfolio/returns, goals-view ×2, DateRangePicker, transaction-form), `Collapsible` + `CollapsibleTrigger` (nav-main), `SidebarMenuButton` (nav-projects), `SidebarMenuSubButton` (nav-main). They belong to their own not-yet-migrated components (popover, collapsible, sidebar).
- `@radix-ui/react-slot` stays in `package.json` until the final dependency-removal sweep (still imported by other not-yet-migrated Slot users: badge, breadcrumb, button-group, item, sidebar).

## Behavior changes

- None observed. The Base UI Button renders a native `<button>`; when given `render={<Link/>}` it forwards props and merges classNames onto the anchor.

## Verify by hand

- Click link-buttons: landing hero ("Create your account" / "Go to Portfolio"), not-found ("Go home"), dashboard `error.tsx` ("Reload"/"Go home") — each must navigate. Confirm focus ring, hover, and `disabled` styling still apply. Icon+text buttons keep their icon.
