# Base UI Migration — Trial Assessment

- **Date:** 2026-07-06
- **Branch:** `feat/base-ui-migration`
- **Trial slice:** `tooltip`, `dropdown-menu`, `dialog` — all migrated, independently verified green (tsc 0 errors · biome clean · `next build` OK), one commit each.

## How it went

The official shadcn `migrate-radix-to-base` skill + `@base-ui/react@1.6.0`, in
**transformation-engine mode** (our `new-york` style has no `base-<style>` golden
pair, so each component's own file is transformed in place, preserving its exact
Tailwind classes). Established, repeatable patterns:

- **Wrapper:** `Content → Portal > Positioner > Popup` (positioning props Pick'd
  from `Positioner.Props` and **forwarded**), `Overlay → Backdrop`, part renames
  (`Label→GroupLabel`, `ItemIndicator→Checkbox/RadioItemIndicator`,
  `Sub*→Submenu*`), `data-[state]→data-open/-closed` + `data-starting-style` /
  `data-ending-style` animations, `--radix-*` CSS vars → Base equivalents.
- **Call sites:** `asChild → render`, `onSelect → onClick`+`closeOnClick`,
  `textValue → label`.
- **One-time setup:** registered `data-starting-style`/`data-ending-style`
  Tailwind variants in `globals.css`.

Effort was tractable and mechanical once the pattern was set. Two of the three
were run by an agent driving the skill; **each was independently re-verified**
(tsc/biome/build) before commit — which caught an over-claim (a stale-diagnostic
false alarm) and confirmed the real state.

## Coverage audit of all 57 `src/components/ui` components

| Bucket | Count | Components | Action |
|---|--:|---|---|
| **Migrated** | 3 | dialog, dropdown-menu, tooltip | ✅ done |
| **Pure-styled (no primitive)** | 14 | alert, card, empty, field, file-upload, input, input-group, kbd, marquee, pagination, skeleton, spinner, table, textarea | **No migration** |
| **Third-party (not Radix — never touch)** | 9 | calendar & date-range-picker (react-day-picker), carousel (embla), chart (recharts), command (cmdk), drawer (vaul), input-otp, resizable (react-resizable-panels), sonner | **Leave on their libs** |
| **Radix `Slot`/`asChild` → Base `useRender` / Button** | 6 | badge, breadcrumb, button-group, **button**, item, sidebar | Migrate (button → real `@base-ui/react/button`) |
| **Radix primitive → Base UI** | ~21 | accordion, alert-dialog, avatar, checkbox, collapsible, context-menu, hover-card, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, **sheet**, slider, switch, tabs, toggle, toggle-group | Migrate (same pattern as the trial) |
| **No Base UI equivalent** | 2–3 | aspect-ratio → CSS `aspect-ratio` div; label → native `<label>`; form → split into Field/Fieldset + native label | Map to native/CSS, not a Base primitive |

**Net remaining Radix migration work: ~31 components** (~6 Slot-based, ~21
primitives, ~3 native-mapped). ~23 of 57 need nothing (pure-styled or third-party).

## Recommendation for the full migration

- **Feasible and low-drama, progressive & component-by-component** (both libraries
  coexist; project stays green/shippable throughout). The skill + independent
  verification per component is a reliable loop.
- **Order:** leaf/shared first — `label` (→ native), `button` (→ Base Button),
  then the other Slot components — because many others compose them. Then work by
  family (overlays: popover/hover-card; menus: context-menu/menubar/navigation-menu;
  form controls: checkbox/switch/radio-group/slider/toggle/toggle-group/tabs;
  misc: accordion/collapsible/avatar/progress/scroll-area/separator/select/alert-dialog).
- **Watch items:**
  - **`button`** (63 call sites) is the single biggest task — the `asChild` workhorse.
  - **`sheet`** must be migrated before `@radix-ui/react-dialog` can be uninstalled
    (it still imports it; that package stays until then).
  - `aspect-ratio`, `label`, `form` have **no** Base UI primitive — native/CSS mapping.
  - Do **not** touch the 9 third-party components.
  - **Behavior/visual deltas flagged in `.migration/*.md`** (animation feel via
    starting/ending-style, menu close-on-click defaults, tooltip arrow placement)
    need a browser eyeball — the build/e2e gate does not catch them.

## Verify by hand (this trial)

Run the worktree dev server and check: tooltips (account 2FA copy buttons; collapsed
sidebar), dropdown menus (transactions row actions, nav-user menu, admin tables),
and dialogs (regenerate recovery codes, email change, image cropper) — open/close,
positioning, focus return, and animation feel.
