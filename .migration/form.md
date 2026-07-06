# form

2026-07-06 · transformation engine · **migrated**: Radix `Slot` (FormControl) + `@radix-ui/react-label` type → Base UI `useRender` + native label.

## Changed

- `src/components/ui/form.tsx`:
  - Removed `import { Slot } from '@radix-ui/react-slot'` and `import * as LabelPrimitive from '@radix-ui/react-label'`. Added `@base-ui/react/use-render` + `@base-ui/react/merge-props`.
  - `FormControl`: was a bare `<Slot>` that injected `aria-describedby`/`aria-invalid`/`id`/`data-slot` onto its single child. Rewritten with `useRender({ render: children as React.ReactElement, props: mergeProps<'div'>({ ...aria/id/data-slot } as React.ComponentProps<'div'>, props) })`. **Consumer API unchanged** — all 23 `<FormControl><Input/></FormControl>` sites keep the child-wrapping shape (the child becomes the `render` element). No call-site edits.
  - `FormLabel`: prop type changed from `React.ComponentProps<typeof LabelPrimitive.Root>` to `React.ComponentProps<typeof Label>` (Label is now the native-`<label>` wrapper). It already renders `<Label>`, unchanged.
  - leftover scan: `grep -n "radix-ui" src/components/ui/form.tsx` → clean.

## Left alone

- `react-hook-form` (Controller/FormProvider/useFormContext/useFormState) is not Radix — untouched.
- Depends on migrated `label` ([[label]]).

## Behavior changes

- None functional. `useRender` merges the same aria/id/data-slot props onto the field control that Slot did (className/style joined, handlers chained).

## Verify by hand

- Submit a form with a validation error (e.g. sign-up, 2FA password dialogs): the invalid input must get `aria-invalid`, the message must be linked via `aria-describedby`, and clicking the label must focus the input. Tab order and error text unchanged.
