/**
 * The creatable-row rule for the model chooser's `Combobox`: the typed text becomes a
 * selectable row when it is not already a known model, so a custom/unlisted id can always be
 * added without a separate free-text field. Checked against BOTH `fetched` and `enabled` —
 * re-typing an already-added custom id (one that was never in `fetched`) would otherwise show
 * a duplicate row tagged "custom" alongside the real chip.
 *
 * Pulled out of `ModelSetField` so this one behaviour-carrying computation is reachable from
 * `bun test --isolate src` without a component-test harness.
 */
export function computeModelItems(query: string, fetched: string[], enabled: string[]): string[] {
	const trimmedQuery = query.trim();
	return trimmedQuery !== '' && !fetched.includes(trimmedQuery) && !enabled.includes(trimmedQuery)
		? [...fetched, trimmedQuery]
		: fetched;
}
