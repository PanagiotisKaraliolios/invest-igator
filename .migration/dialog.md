# dialog

2026-07-06 · strategy: transformation engine (legacy `new-york` style has no `base-new-york` golden pair) · **verdict: migrated, green (typecheck 0 errors + biome "No fixes applied" + next build prints the full route table).**

## Changed

- `src/components/ui/dialog.tsx` — rewired `@radix-ui/react-dialog` → `@base-ui/react/dialog`.
  - Import: `import * as DialogPrimitive from '@radix-ui/react-dialog'` → `import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'`.
  - Part renames: `Overlay` → `Backdrop`; `Content` → `Popup`. `Root`/`Trigger`/`Portal`/`Close`/`Title`/`Description` keep their names (all exist in the `Dialog` namespace).
  - **Centered modal → NO Positioner.** Structure stays `Portal > Backdrop + Popup` (Backdrop and Popup are siblings inside the Portal, per overlays.md). The Popup keeps the original fixed-centering classes (`fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] …`); no Positioner part is introduced (unlike tooltip/dropdown).
  - `data-slot` dropped from `Dialog` (→ `Dialog.Root`): it renders no DOM and `DialogRootProps` is **not** `BaseUIComponentProps` (it has no `extends`), so it rejects `data-slot`. Mirrors the tooltip migration dropping `data-slot` from Provider/Root and the dropdown migration dropping it from Root. `data-slot` KEPT everywhere else — verified each part is `BaseUIComponentProps`: Trigger (`NativeButtonProps & BaseUIComponentProps<'button'>`), Portal (`FloatingPortal.Props extends BaseUIComponentProps<'div'>`), Backdrop (`<'div'>`), Popup (`<'div'>`), Title (`<'h2'>`), Description (`<'p'>`), Close (`NativeButtonProps & BaseUIComponentProps<'button'>`).
  - Animations: `data-[state=open]:*` → `data-starting-style:*`, `data-[state=closed]:*` → `data-ending-style:*` (1:1 token substitution, original order preserved). On `Backdrop`: `animate-in`/`animate-out` + `fade-in-0`/`fade-out-0`. On `Popup`: those plus `zoom-in-95`/`zoom-out-95`. Reuses the `data-starting-style` / `data-ending-style` custom variants already in `globals.css` (added by the tooltip migration) — none re-added.
  - Close button open-state: `data-[state=open]:bg-accent data-[state=open]:text-muted-foreground` → `data-[open]:bg-accent data-[open]:text-muted-foreground` (presence-attribute, bracket form per the repo's `data-[...]` convention — needs no new `globals.css` variant). This class is **vestigial**: the Close button never carries an open marker in Base UI (Close state exposes only `data-disabled`), exactly as in Radix (the Close never had `data-state`), so it was inert before and stays inert — no behavior delta.
  - CSS vars: dialog's classes contained no `--radix-*` variables (dialog has none documented), so nothing to rewrite.
  - `showCloseButton` prop and `DialogHeader`/`DialogFooter` plain-`<div>` wrappers unchanged.
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" dialog.tsx` → clean (0).
- Consumers — `asChild` → `render={<Child/>}` (repo's established idiom), 4 trigger conversions across 3 files:
  - `src/app/(dashboard)/watchlist/page.tsx` — 1 `DialogTrigger` (Add-to-watchlist `<Button>`).
  - `src/app/(dashboard)/account/_components/enabled-two-factor-section.tsx` — 2 `DialogTrigger` ("Regenerate recovery codes", "Disable two-factor").
  - `src/app/(dashboard)/account/_components/email-change-dialog.tsx` — 1 `DialogTrigger` ("Change email").
- `src/app/(dashboard)/account/_components/image-cropper.tsx` — two Radix-only props handled:
  - `<Dialog modal={true} …>` kept as-is: Base UI `Dialog.Root` has `modal?: boolean | 'trap-focus'` (default `true`), so `modal={true}` is valid.
  - `<DialogContent … onInteractOutside={(e) => e.preventDefault()}>` → removed the prop from `DialogContent` (Popup has no `onInteractOutside`) and added `disablePointerDismissal` to `<Dialog>` (Root). Per universal-patterns, Radix per-interaction dismiss callbacks have no 1:1 Base prop; `disablePointerDismissal` (Root, default `false`, "prevents closing on outside presses") is the documented replacement for "don't close on outside click" on a modal dialog. Escape still closes (unaffected) — matching Radix `onInteractOutside preventDefault`, which never blocked Escape. Behavior-equivalent.
- `src/components/ui/command.tsx` — `CommandDialog`'s prop type `React.ComponentProps<typeof Dialog>` → `Omit<React.ComponentProps<typeof Dialog>, 'children'> & { …; children?: React.ReactNode }`. Base UI's `DialogRootProps.children` is `ReactNode | PayloadChildRenderFunction<Payload>`; the render-function arm leaked through `ComponentProps` and broke `<Command>{children}</Command>` (cmdk expects `ReactNode`). Narrowed `children` back to `ReactNode`; all other Dialog props (`open`/`onOpenChange`/`modal`/…) are still forwarded via `{...props}`. No behavior change — `CommandDialog` always received `ReactNode`.
- Leftover scan on all changed consumer files (`image-cropper`, `watchlist/page`, `enabled-two-factor-section`, `email-change-dialog`, `command`): clean.
- `package.json` / `bun.lock` — **`@radix-ui/react-dialog` NOT removed.** `src/components/ui/sheet.tsx` still imports it directly (`import * as SheetPrimitive from '@radix-ui/react-dialog'`); sheet is out of this slice. Removing the package would break `sheet.tsx`, so it stays installed until sheet is migrated.

## Left alone

- `src/components/ui/sheet.tsx` — imports `@radix-ui/react-dialog` for its own sheet primitive; not part of this slice, stays on Radix, and is why the `@radix-ui/react-dialog` package must remain installed.
- `src/components/ui/alert-dialog.tsx` — separate primitive (`@radix-ui/react-alert-dialog`), not this slice.
- `src/components/ui/command.tsx` `cmdk` usage — `cmdk` is not Radix; only its `React.ComponentProps<typeof Dialog>` type needed the `children` narrowing (fixed above).
- `src/app/(dashboard)/tools/goals/_components/goals-view.tsx` lines 306, 490 `<PopoverTrigger asChild>` — that is Popover, not dialog; out of this slice.
- `src/styles/globals.css` — the `data-starting-style` / `data-ending-style` custom variants already existed (from the tooltip migration); reused, not re-added. No new variant registered (the Close open-state uses the bracket form `data-[open]:`).

## Behavior changes

- **Enter/exit animations** are now gated by `data-starting-style` / `data-ending-style` (transition hooks) instead of Radix `data-[state=open/closed]`. Compiles and animates (backdrop fade; popup fade + zoom); exact feel/timing may differ subtly.
- **`disablePointerDismissal` (image-cropper)** replaces `onInteractOutside preventDefault`. Outside-press no longer closes the cropper (as before); Escape still closes it (as before). Flagged as a mapped equivalent, not a silent patch.
- **Trigger open marker changed** from `data-state="open"` to `data-popup-open`. No consumer styles a dialog trigger on its open state (repo grep for `data-[state` across dialog consumers is clean), so no consumer CSS rewrite was needed.
- **Close button `data-[open]:*` is inert** in both Radix and Base UI (the Close never carries the open marker). Preserved faithfully; visually unchanged.
- **`modal` default** is `true` in Base UI `Dialog.Root`, matching Radix's default modal dialogs — no delta for the uncontrolled/plain `<Dialog>` consumers.

## Verify by hand

1. Watchlist → "Add to watchlist": click opens a centered dialog over a fade-in backdrop (popup fades + zooms in); the X button and Escape both close it; focus returns to the trigger button.
2. Account → 2FA (enabled): "Regenerate recovery codes" and "Disable two-factor" each open their dialog, the password form submits, and the dialog closes; focus returns to the trigger.
3. Account → "Change email": opens the dialog; on success it closes (`onOpenChange(false)` from `EmailChangeForm`).
4. Account → profile-picture cropper (image-cropper): open it, then click OUTSIDE the popup — it must NOT close (`disablePointerDismissal`); press Escape — it SHOULD close; confirm the crop/zoom controls work and Cancel/Save behave.
5. Command palette (`CommandDialog`, wherever it is mounted): opens with the sr-only title/description and renders the command list inside the dialog.
6. Eyeball the backdrop fade and popup zoom/fade on both open and close, plus the X close button's hover-opacity transition.

---

*Derived status: 30 UI wrappers under `src/components/ui` still import Radix (dialog is now off Radix). Note: `sheet.tsx` still imports `@radix-ui/react-dialog`, so that package stays installed until sheet is migrated.*
