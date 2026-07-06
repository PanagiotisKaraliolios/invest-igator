# Base UI Trial-Slice Migration — Design

- **Date:** 2026-07-05
- **Status:** Approved (design); pending spec review
- **Owner:** Panagiotis Karaliolios

## Context

`src/components/ui/` holds 57 shadcn components built on 26 `@radix-ui/*`
packages, consumed across every form and page. As of the July 2026 shadcn
release, **Base UI is the default primitive** for shadcn/ui; Radix remains fully
supported and shadcn explicitly recommends a **progressive, component-by-component**
migration rather than a big-bang replacement, because the two libraries have real
API differences.

We will de-risk with a **trial slice** first: migrate a small, representative,
actually-used set of components to Base UI, keep the project green throughout, and
produce a costed assessment before committing to the full migration.

## Approach

Use shadcn's **official migration path** — the `shadcn/ui` agent skill, installed
via the `skills` CLI:

```
bunx skills add shadcn/ui      # docs show: pnpm dlx skills add shadcn/ui
```

Drive it per component (e.g. "migrate dropdown-menu to base-ui"). It is progressive
by design: Radix and Base UI coexist while migrating; a `@radix-ui/*` package is
removed only once nothing imports it.

## Scope — the trial slice

Chosen to be *used* and to exercise the three biggest structural deltas at a
manageable blast radius (~25 call sites total):

| Order | Component | Call sites | Exercises |
|-------|-----------|-----------:|-----------|
| 1 | `tooltip` | 4 | Floating + `Positioner`; smallest radius (warm-up) |
| 2 | `dropdown-menu` | 7 | Menus + required `Positioner` wrapper + trigger `asChild`→`render` |
| 3 | `dialog` | 14 | Portal/overlay + trigger `asChild`→`render` |

`button` (63 call sites — the `asChild` workhorse) is **deliberately excluded** from
the trial; its `asChild`→`render` pattern is still exercised via the dialog/dropdown
triggers, without a 63-file blast radius.

## API deltas to handle

1. **`asChild` → `render`**: Radix `Slot`/`asChild` becomes Base UI `useRender` and a
   `render` prop. Triggers change from
   `<Trigger asChild><Button/></Trigger>` to `<Trigger render={<Button/>}>`.
2. **`Positioner` wrapper**: popup `side`/`align` move off `…Content` onto a new
   required `…Positioner` component that wraps `…Content`
   (tooltip, dropdown-menu, dialog/popover families).
3. **Prop renames / label-in-popup** differences per component, applied as the docs
   specify.

## Per-component migration loop

For each component, in order:

1. Regenerate the component as Base UI via the skill (Radix version coexists).
2. Update the component's call sites (`asChild`→`render`, add `Positioner`, prop
   renames).
3. Verify: `bun run typecheck`, `bun run check` (biome), `bun run build`.
4. Remove the corresponding `@radix-ui/*` package only once nothing imports it.

## Done bar

Before any push: `typecheck` + `biome` + local `next build` + the **Docker image
build** all green (our established gate). Only then push; CI (incl. e2e) + the
Docker Hub build provide the final confirmation. Never push a red build.

## Deliverables

1. `tooltip`, `dropdown-menu`, `dialog` migrated to Base UI + call sites updated,
   full pipeline green.
2. A written **assessment** (`docs/superpowers/specs/…-base-ui-assessment.md`):
   - real per-pattern effort/risk observed in the trial;
   - a **coverage audit** of the other 54 components — which have a Base UI
     equivalent and which do **not** (e.g. likely `aspect-ratio`);
   - a costed recommendation + ordering for the full migration.

## Out of scope (deferred, scoped after the trial)

- Migrating the remaining 54 components.
- The separate request: *"review all components/forms adhere to latest docs"* — a
  distinct audit best run against the Base UI docs once components are migrated.

## Risks

- **Positioner restructuring** changes JSX shape at call sites; highest chance of
  subtle layout/positioning regressions (visual, not caught by typecheck).
- **e2e coverage** does not render every component with data, so some visual/behavioral
  regressions can only be caught by manual review — flagged in the assessment.
- **Coverage gaps**: a Radix component with no Base UI equivalent stays on Radix; the
  audit will enumerate these so the full-migration plan is realistic.
